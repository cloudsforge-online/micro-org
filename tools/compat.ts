// The contract compatibility checker — AD-02 item 4, and rule 10 of
// docs/ecosystem/03-repository-responsibilities.md §2.
//
// WHY this exists at all: with one repository per service, a contract package is consumed by
// repositories whose CI cannot see this one. A field removed here is a runtime failure over
// there, discovered in production, in a repository nobody was looking at. §3.7 of the
// current-state audit shows discipline already failed at this, so it is a check now.
//
// WHAT it does: reads the exported *type surface* of a package at two git refs and fails on a
// removed field, a narrowed type, or a renamed key. Additive change passes. That is the whole
// contract that lets a service lag a contract version by two minors safely.
//
//   node --import tsx tools/compat.ts <packageDir> <baseRef>
//
// Deliberately not a heavy AST differ. It uses the TypeScript compiler API to resolve the
// package's entry module, expands every export into a flat map of dotted paths, and compares
// two maps. A flat map is what makes 'renamed key' fall out for free: a rename is a removal at
// one path and an addition at another, and the removal is the part that breaks a consumer.
//
// INPUT vs OUTPUT types, which is the one judgement call in here. Adding a required field is
// safe on a type the platform *returns* (consumers gain a field) and breaking on a type a
// consumer must *construct* (every caller is now wrong). There is no way to read that off the
// type, so it is read off the name — a type whose name ends Request, Input, Params, Args, Body,
// Command or Query is an input — and any declaration may overrule that with a `@input` or
// `@output` JSDoc tag. Getting this wrong in the safe direction costs a false failure that a
// tag fixes; getting it wrong the other way ships a break, so the suffix list is generous.

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ts from 'typescript';

// ---------------------------------------------------------------------------------------------
// The surface model
// ---------------------------------------------------------------------------------------------

export type EntryKind = 'object' | 'union' | 'array' | 'function' | 'scalar';

export interface SurfaceEntry {
  // Dotted path from the exported name: 'JournalEntry', 'JournalEntry.postings', and an array
  // element is '[]', as in 'JournalEntry.postings[]'.
  readonly path: string;
  // The top-level export this path hangs off, so a finding can be judged against that export's
  // input/output role rather than against the leaf's name.
  readonly root: string;
  readonly kind: EntryKind;
  readonly optional: boolean;
  // Normalised type text. Meaningful for 'scalar' and 'function'; a label for the rest.
  readonly text: string;
  // Sorted member texts, for 'union' only.
  readonly union: readonly string[];
}

export type Role = 'input' | 'output';

export interface Surface {
  readonly entries: ReadonlyMap<string, SurfaceEntry>;
  readonly roles: ReadonlyMap<string, Role>;
  // Unresolved imports and other compiler complaints. Not fatal: a contract package archived out
  // of its repository cannot always resolve a sibling package, and the comparison stays sound as
  // long as both sides fail the same way. Reported so a lopsided failure is visible.
  readonly notes: readonly string[];
}

export type FindingKind =
  | 'removed'
  | 'removed-export'
  | 'added-required'
  | 'now-required'
  | 'weakened-guarantee'
  | 'narrowed-union'
  | 'changed-union'
  | 'widened-scalar'
  | 'widened-function'
  | 'type-changed'
  | 'kind-changed'
  | 'added';

export interface Finding {
  readonly kind: FindingKind;
  readonly path: string;
  readonly detail: string;
  readonly breaking: boolean;
}

/**
 * Each literal form, and the primitive it widens to. Nothing else counts as a widening.
 *
 * Written as an explicit table rather than "does the new text look like a primitive name", because
 * `type-changed` is the finding that catches a field going from `string` to `number`, and a loose
 * test here would let that through as a widening.
 */
const LITERAL_BASE: ReadonlyArray<readonly [RegExp, string]> = [
  [/^"(?:[^"\\]|\\.)*"$/, 'string'],
  [/^'(?:[^'\\]|\\.)*'$/, 'string'],
  [/^`(?:[^`\\]|\\.)*`$/, 'string'],
  [/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i, 'number'],
  [/^-?\d+n$/, 'bigint'],
  [/^(?:true|false)$/, 'boolean'],
];

/** True only when `before` is a literal and `after` is exactly the primitive it is a literal of. */
export function widensScalar(before: string, after: string): boolean {
  return LITERAL_BASE.some(([pattern, base]) => pattern.test(before) && after === base);
}

/**
 * True only when `after` is `before` with members ADDED to unions inside the signature.
 *
 * A function whose parameter or return embeds a named union — `topicSpec(topic: TopicName)`,
 * `isRegisteredTopic(topic): topic is TopicName` — changes its signature text every time the
 * union gains a member, which is precisely the additive change AD-02 exists to permit: every
 * call that compiled still compiles, every read that compiled still compiles. Judging it as
 * `type-changed` made "register a topic" a breaking change to the events contract, which would
 * make the registry unmaintainable — the same trap §"never correct a citation" (widened-scalar
 * above) closed for literals. This is deliberately the ONLY relaxation for functions, and it is
 * conservative: the inserted run must be a bare literal or identifier joined by `|`; anything
 * structurally richer, any removal, any reordering, any retyped parameter still reads as
 * `type-changed` and breaks the build.
 */
export function widensFunctionSignature(before: string, after: string): boolean {
  if (before === after) return false;
  const base = tokenizeSignature(before);
  const head = tokenizeSignature(after);
  let i = 0;
  let j = 0;
  while (i < base.length || j < head.length) {
    if (i < base.length && j < head.length && base[i] === head[j]) {
      i += 1;
      j += 1;
      continue;
    }
    // The only tolerated divergence: an insertion in `head` shaped `| <member>` or `<member> |`.
    if (j + 1 < head.length && head[j] === '|' && isUnionMemberToken(head[j + 1]!)) {
      j += 2;
      continue;
    }
    if (j + 1 < head.length && isUnionMemberToken(head[j]!) && head[j + 1] === '|') {
      j += 2;
      continue;
    }
    return false;
  }
  return i === base.length && j === head.length;
}

/** String/number/bigint/boolean literals and bare type names. An object or generic inserted into
 *  a union is NOT recognised — richer members fall through to `type-changed`, deliberately. */
function isUnionMemberToken(token: string): boolean {
  return (
    LITERAL_BASE.some(([pattern]) => pattern.test(token)) || /^[A-Za-z_$][A-Za-z0-9_$.]*$/.test(token)
  );
}

/** Signature text as comparable tokens: string literals whole, names whole, punctuation single. */
function tokenizeSignature(text: string): string[] {
  return (
    text.match(
      /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|-?\d[\w.]*|[A-Za-z_$][A-Za-z0-9_$.]*|\S/g,
    ) ?? []
  );
}

const MAX_DEPTH = 8;

// A generous list, because a false failure costs a JSDoc tag and a false pass ships a break.
const INPUT_SUFFIXES = ['Request', 'Input', 'Params', 'Args', 'Body', 'Command', 'Query'];

export function classifyRole(name: string, jsDocTags: readonly string[]): Role {
  if (jsDocTags.includes('input')) return 'input';
  if (jsDocTags.includes('output')) return 'output';
  return INPUT_SUFFIXES.some((suffix) => name.endsWith(suffix)) ? 'input' : 'output';
}

// ---------------------------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------------------------

const COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2023,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  strict: true,
  skipLibCheck: true,
  noEmit: true,
  allowImportingTsExtensions: true,
  noResolve: false,
};

// The type checker hands out an internal numeric id; it is the only cheap identity a type has,
// and the cycle guard needs one. A recursive type without this walks until MAX_DEPTH on every
// branch, which on a real contract package is minutes rather than milliseconds.
function typeId(type: ts.Type): number {
  return (type as unknown as { id?: number }).id ?? -1;
}

function isBooleanUnion(members: readonly string[]): boolean {
  return members.length === 2 && members.includes('true') && members.includes('false');
}

interface WalkContext {
  readonly checker: ts.TypeChecker;
  readonly entries: Map<string, SurfaceEntry>;
  readonly root: string;
  readonly location: ts.Node;
}

function record(ctx: WalkContext, entry: SurfaceEntry): void {
  ctx.entries.set(entry.path, entry);
}

function walk(
  ctx: WalkContext,
  type: ts.Type,
  entryPath: string,
  optional: boolean,
  depth: number,
  seen: ReadonlySet<number>,
): void {
  const { checker } = ctx;
  const id = typeId(type);

  // Depth and cycle stops both record a scalar rather than nothing, so that a type going from
  // recursive to non-recursive still shows up as a change rather than as silence.
  if (depth > MAX_DEPTH || seen.has(id)) {
    record(ctx, {
      path: entryPath,
      root: ctx.root,
      kind: 'scalar',
      optional,
      text: checker.typeToString(type),
      union: [],
    });
    return;
  }

  if (type.getCallSignatures().length > 0) {
    record(ctx, {
      path: entryPath,
      root: ctx.root,
      kind: 'function',
      optional,
      // The full signature text — with NoTruncation, which matters twice. Truncated text elides
      // union members behind '... 11 more ...', so (1) a member REMOVED from a large union could
      // hide inside the ellipsis and pass as "unchanged", and (2) a member ADDED to one could
      // never be recognised as the union widening it is (see widensFunctionSignature below):
      // registering the estate's 18th topic read as three breaking changes because the compared
      // strings were mostly ellipsis. A parameter added, removed or retyped, or a changed return
      // type, all still move this string.
      text: checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation),
      union: [],
    });
    return;
  }

  if (type.isUnion()) {
    const members = type.types.map((member) => checker.typeToString(member)).sort();
    if (isBooleanUnion(members)) {
      record(ctx, { path: entryPath, root: ctx.root, kind: 'scalar', optional, text: 'boolean', union: [] });
      return;
    }
    // `undefined` in the union is the optional flag restated. Carrying it in both places would
    // report an optionality change twice, once as a union narrowing.
    const withoutUndefined = members.filter((member) => member !== 'undefined');
    const dropped = withoutUndefined.length !== members.length;
    if (withoutUndefined.length === 1 && dropped) {
      const only = withoutUndefined[0] ?? 'unknown';
      record(ctx, { path: entryPath, root: ctx.root, kind: 'scalar', optional: true, text: only, union: [] });
      return;
    }
    record(ctx, {
      path: entryPath,
      root: ctx.root,
      kind: 'union',
      optional: optional || dropped,
      text: withoutUndefined.join(' | '),
      union: withoutUndefined,
    });
    return;
  }

  if (checker.isArrayType(type)) {
    const args = checker.getTypeArguments(type as ts.TypeReference);
    record(ctx, { path: entryPath, root: ctx.root, kind: 'array', optional, text: 'Array', union: [] });
    const element = args[0];
    if (element) walk(ctx, element, `${entryPath}[]`, false, depth + 1, new Set([...seen, id]));
    return;
  }

  const properties = type.getProperties();
  const isObjectish = (type.flags & ts.TypeFlags.Object) !== 0 && properties.length > 0;
  if (isObjectish) {
    record(ctx, {
      path: entryPath,
      root: ctx.root,
      kind: 'object',
      optional,
      text: 'object',
      union: [],
    });
    const nextSeen = new Set([...seen, id]);
    for (const property of [...properties].sort((a, b) => a.name.localeCompare(b.name))) {
      // Well-known symbol members are not surface, and worse, their names are NOT STABLE: the
      // checker spells them `__@unscopables@1100`, where the trailing number is TypeScript's
      // internal symbol id for that compilation. It shifts whenever anything upstream of it
      // changes, so identical code compared against itself produced a matched pair of
      // `__@iterator@55 removed` / `__@iterator@1059 added` findings — hundreds of them, on a
      // readonly array constant, every one breaking. A check that is red on unchanged code is a
      // check that gets bypassed, and this one guards the estate's contracts. No consumer can
      // read `ENTRY_KINDS.__@unscopables@1100` in any case: it is Array.prototype's own plumbing.
      if (property.name.startsWith('__@')) continue;
      const declaration = property.valueDeclaration ?? property.declarations?.[0] ?? ctx.location;
      const propertyType = checker.getTypeOfSymbolAtLocation(property, declaration);
      const propertyOptional = (property.flags & ts.SymbolFlags.Optional) !== 0;
      walk(ctx, propertyType, `${entryPath}.${property.name}`, propertyOptional, depth + 1, nextSeen);
    }
    return;
  }

  record(ctx, {
    path: entryPath,
    root: ctx.root,
    kind: 'scalar',
    optional,
    text: checker.typeToString(type),
    union: [],
  });
}

// Build the surface from a single entry module. Exported for the tests, which drive fixture
// pairs directly rather than through git.
export function surfaceOfEntry(entryFile: string): Surface {
  const program = ts.createProgram([entryFile], COMPILER_OPTIONS);
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(entryFile);
  if (!source) throw new Error(`compat: cannot read ${entryFile}`);

  const notes: string[] = [];
  for (const diagnostic of program.getSemanticDiagnostics(source)) {
    // 2307 is 'cannot find module'. Expected for a cross-package import when the package is read
    // out of a git archive; noted rather than raised.
    const text = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
    notes.push(`TS${diagnostic.code}: ${text}`);
  }

  const entries = new Map<string, SurfaceEntry>();
  const roles = new Map<string, Role>();

  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (!moduleSymbol) {
    return { entries, roles, notes: [...notes, 'the entry module exports nothing'] };
  }

  for (const exported of checker.getExportsOfModule(moduleSymbol)) {
    const name = exported.getName();
    const symbol = (exported.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(exported) : exported;
    const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0] ?? source;

    const isTypeDeclaration = (symbol.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias)) !== 0;
    const type = isTypeDeclaration
      ? checker.getDeclaredTypeOfSymbol(symbol)
      : checker.getTypeOfSymbolAtLocation(symbol, declaration);

    const tags = symbol.getJsDocTags(checker).map((tag) => tag.name);
    roles.set(name, classifyRole(name, tags));
    walk({ checker, entries, root: name, location: declaration }, type, name, false, 0, new Set());
  }

  return { entries, roles, notes };
}

// ---------------------------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------------------------

function parentOf(entryPath: string): string | undefined {
  const dot = entryPath.lastIndexOf('.');
  if (dot === -1) return entryPath.endsWith('[]') ? entryPath.slice(0, -2) : undefined;
  return entryPath.slice(0, dot);
}

function isSubset(inner: readonly string[], outer: readonly string[]): boolean {
  const set = new Set(outer);
  return inner.every((member) => set.has(member));
}

function sameShape(a: SurfaceEntry, b: SurfaceEntry): boolean {
  return a.kind === b.kind && a.text === b.text && a.union.join('|') === b.union.join('|');
}

export function compareSurfaces(base: Surface, head: Surface): Finding[] {
  const findings: Finding[] = [];

  const addedPaths = [...head.entries.keys()].filter((key) => !base.entries.has(key));

  // A whole export appearing or disappearing is reported once, at the export. Listing every
  // field of a deleted type as a separate removal buries the one line that says what happened
  // under twenty that repeat it, and the fix for all twenty is the same fix.
  const removedRoots = new Set(
    [...base.roles.keys()].filter((name) => !head.entries.has(name) && base.entries.has(name)),
  );
  const addedRoots = new Set(
    [...head.roles.keys()].filter((name) => !base.entries.has(name) && head.entries.has(name)),
  );

  for (const [entryPath, before] of base.entries) {
    if (removedRoots.has(before.root) && entryPath !== before.root) continue;
    const after = head.entries.get(entryPath);

    if (!after) {
      if (!parentOf(entryPath)) {
        findings.push({
          kind: 'removed-export',
          path: entryPath,
          detail: `the export '${entryPath}' is gone; every consumer importing it fails to compile`,
          breaking: true,
        });
        continue;
      }
      // A rename is a removal plus an addition under the same parent with the same shape. Saying
      // so turns an unhelpful 'field gone' into the actual instruction.
      const parent = parentOf(entryPath);
      const candidates = addedPaths.filter((candidate) => {
        const other = head.entries.get(candidate);
        return parentOf(candidate) === parent && other !== undefined && sameShape(before, other);
      });
      const suffix = candidates.length === 1 ? ` (looks renamed to '${candidates[0]}')` : '';
      findings.push({
        kind: 'removed',
        path: entryPath,
        detail: `field removed${suffix}; a consumer reading it gets undefined at runtime`,
        breaking: true,
      });
      continue;
    }

    if (before.kind !== after.kind) {
      findings.push({
        kind: 'kind-changed',
        path: entryPath,
        detail: `was ${before.kind} (${before.text}), is now ${after.kind} (${after.text})`,
        breaking: true,
      });
      continue;
    }

    if (before.optional && !after.optional) {
      findings.push({
        kind: 'now-required',
        path: entryPath,
        detail: 'an optional field became required; every caller that omitted it is now wrong',
        breaking: true,
      });
    } else if (!before.optional && after.optional) {
      // Relaxing an input is fine. Relaxing an output withdraws a guarantee: consumers wrote
      // code against a field that was always there and now have to handle its absence.
      const role = head.roles.get(after.root) ?? base.roles.get(before.root) ?? 'output';
      if (role === 'output') {
        findings.push({
          kind: 'weakened-guarantee',
          path: entryPath,
          detail: 'a guaranteed field on a returned type became optional; consumers must now handle undefined',
          breaking: true,
        });
      }
    }

    if (before.kind === 'union') {
      const gone = before.union.filter((member) => !after.union.includes(member));
      if (gone.length > 0) {
        findings.push({
          kind: isSubset(after.union, before.union) ? 'narrowed-union' : 'changed-union',
          path: entryPath,
          detail: `union no longer accepts ${gone.map((member) => `'${member}'`).join(', ')}`,
          breaking: true,
        });
      }
    } else if (before.kind === 'scalar' || before.kind === 'function') {
      if (before.text !== after.text) {
        // A LITERAL REPLACED BY THE PRIMITIVE IT IS A LITERAL OF IS A WIDENING, NOT A BREAK, and
        // this is the same judgement `widened-union` above already makes: every value that
        // satisfied the old type still satisfies the new one, so no consumer's call and no
        // consumer's read stops compiling. (The one thing it does break — annotating a variable
        // with the old narrow type — is broken identically by adding a member to a union, which
        // this checker has always passed. The rule is consistent, not newly lenient.)
        //
        // It matters because of what a literal type is usually doing on a public surface. It is
        // rarely a contract; it is provenance that `as const` swept into the type by accident.
        // `micro-sdk`'s `ROUTES.*.verifiedAt` is `<repo>/src/server.ts:<line>` — a citation whose
        // whole value is being CORRECT, which means being edited whenever the cited file moves.
        // Judging that as eight breaking changes to consumers who cannot observe the field's type
        // made the rule "never correct a citation", which is the opposite of what the citation is
        // for. This is deliberately the ONLY relaxation: literal → its own base primitive. A
        // scalar changing to any other type is still breaking.
        const widenedScalar = before.kind === 'scalar' && widensScalar(before.text, after.text);
        // The function counterpart of the same judgement: a signature whose only movement is
        // union members ADDED (a topic registered, a capability declared) breaks no caller and
        // no reader. See widensFunctionSignature for why this exists and how narrow it is.
        const widenedFunction =
          before.kind === 'function' && widensFunctionSignature(before.text, after.text);
        const widened = widenedScalar || widenedFunction;
        findings.push({
          kind: widenedScalar ? 'widened-scalar' : widenedFunction ? 'widened-function' : 'type-changed',
          path: entryPath,
          detail: widenedScalar
            ? `was the literal ${before.text}, is now '${after.text}' — every value that satisfied it still does`
            : widenedFunction
              ? 'the signature only gained union members — every call and every read still compiles'
              : `was '${before.text}', is now '${after.text}'`,
          breaking: !widened,
        });
      }
    }
  }

  for (const entryPath of addedPaths) {
    const added = head.entries.get(entryPath);
    if (!added) continue;
    if (addedRoots.has(added.root) && entryPath !== added.root) continue;
    const parent = parentOf(entryPath);
    // A wholly new export, or a field of one, adds nothing a consumer has to satisfy.
    const parentIsNew = parent === undefined || !base.entries.has(parent);
    if (parentIsNew) {
      findings.push({ kind: 'added', path: entryPath, detail: 'new', breaking: false });
      continue;
    }
    const role = head.roles.get(added.root) ?? 'output';
    if (!added.optional && role === 'input') {
      findings.push({
        kind: 'added-required',
        path: entryPath,
        detail:
          `a required field was added to '${added.root}', which is an input type; ` +
          'every caller constructing it now fails to compile. Add it optionally, or rename the type ' +
          'if it is not an input',
        breaking: true,
      });
      continue;
    }
    findings.push({ kind: 'added', path: entryPath, detail: 'new', breaking: false });
  }

  return findings;
}

// ---------------------------------------------------------------------------------------------
// Reading a package, and reading it at a git ref
// ---------------------------------------------------------------------------------------------

interface PackageManifest {
  name?: string;
  types?: string;
  main?: string;
}

// The entry to compile. Prefer src over dist unconditionally: dist is a build artifact that may
// be absent, stale, or from the other ref entirely.
export function entryFileOf(packageDir: string): string {
  const manifestPath = path.join(packageDir, 'package.json');
  let manifest: PackageManifest = {};
  if (existsSync(manifestPath)) {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifest;
  }
  const candidates = [
    path.join(packageDir, 'src', 'index.ts'),
    manifest.types ? path.join(packageDir, manifest.types) : undefined,
    manifest.main ? path.join(packageDir, manifest.main) : undefined,
    path.join(packageDir, 'index.ts'),
  ];
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate) && candidate.endsWith('.ts')) return candidate;
  }
  throw new Error(`compat: no TypeScript entry found in ${packageDir} (looked for src/index.ts, types, main)`);
}

function git(repoRoot: string, args: readonly string[]): string {
  return execFileSync('git', [...args], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

export interface CheckoutAtRef {
  readonly packageDir: string;
  readonly cleanup: () => void;
}

// Extract the package as it was at `ref` into a temporary tree. `git archive` is used rather
// than a worktree because it never touches the caller's checkout: a compatibility check that can
// leave a repository on a different ref is a check nobody runs locally.
export function checkoutPackageAtRef(repoRoot: string, relativeDir: string, ref: string): CheckoutAtRef | undefined {
  // Ask first whether the path exists at that ref, rather than reading it off a failed archive.
  // Those are two different answers — 'this package is new' and 'the checker is pointed at the
  // wrong place' — and treating the second as the first is a check that reports success for a
  // package it never looked at.
  const listing = execFileSync('git', ['ls-tree', '--name-only', ref, '--', relativeDir], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (listing.trim() === '') return undefined;

  const scratch = mkdtempSync(path.join(tmpdir(), 'cfcompat-'));
  const tarball = path.join(scratch, 'base.tar');
  const archive = execFileSync('git', ['archive', '--format=tar', ref, '--', relativeDir], {
    cwd: repoRoot,
    maxBuffer: 256 * 1024 * 1024,
  });
  writeFileSync(tarball, archive);
  execFileSync('tar', ['-xf', tarball, '-C', scratch]);

  // Resolution must fail identically on both sides or the diff is noise. Borrowing the working
  // tree's node_modules is the closest available approximation: a sibling contract package
  // resolves to its current version on both sides, which is correct, because a change to that
  // sibling is caught when the checker runs on the sibling.
  // BOTH the workspace root's node_modules and the PACKAGE'S OWN. In a pnpm workspace the root
  // holds only hoisted tooling; a package's dependencies — including the sibling contract packages
  // it imports, which are exactly the types that matter here — live in
  // `packages/<name>/node_modules`. Linking only the root left the base side unable to resolve
  // `@cloudsforge/contracts-chain`, so every type that flowed through it degraded to `any` and the
  // head side's real types all read as `type-changed`: AssetCode "was scalar (any), is now union",
  // and so on for the whole package. That is a breaking finding on code nobody touched, which is
  // the failure mode this checker can least afford — it is the thing standing between a removed
  // contract field and a runtime break in a consumer whose CI never sees the change, and a checker
  // that cries wolf on every push gets muted.
  for (const modules of [path.join(repoRoot, 'node_modules'), path.join(repoRoot, relativeDir, 'node_modules')]) {
    if (!existsSync(modules)) continue;
    const link = path.join(scratch, path.relative(repoRoot, modules));
    try {
      mkdirSync(path.dirname(link), { recursive: true });
      symlinkSync(modules, link, 'dir');
    } catch {
      // A symlink we cannot make is a resolution difference, which the notes will show.
    }
  }

  return {
    packageDir: path.join(scratch, relativeDir),
    cleanup: () => rmSync(scratch, { recursive: true, force: true }),
  };
}

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

function main(argv: readonly string[]): number {
  const [packageArg, baseRef] = argv;
  if (!packageArg || !baseRef) {
    process.stderr.write('usage: node --import tsx tools/compat.ts <packageDir> <baseRef>\n');
    return 2;
  }

  if (!existsSync(path.resolve(packageArg))) {
    process.stderr.write(`compat: ${path.resolve(packageArg)} does not exist\n`);
    return 2;
  }
  // realpath both sides before taking the difference. On macOS /tmp is a symlink to /private/tmp,
  // so `git rev-parse --show-toplevel` answers with the resolved path while the argument is not,
  // and the relative path between them climbs out of the repository. That produced a 'this
  // package is new, nothing to check' pass on a package that was right there.
  const packageDir = realpathSync(path.resolve(packageArg));
  const repoRoot = realpathSync(git(packageDir, ['rev-parse', '--show-toplevel']).trim());
  const relativeDir = path.relative(repoRoot, packageDir) || '.';

  const base = checkoutPackageAtRef(repoRoot, relativeDir, baseRef);
  if (!base) {
    process.stdout.write(`ok: ${relativeDir} does not exist at ${baseRef} — a new package cannot break a consumer\n`);
    return 0;
  }

  try {
    const baseSurface = surfaceOfEntry(entryFileOf(base.packageDir));
    const headSurface = surfaceOfEntry(entryFileOf(packageDir));
    const findings = compareSurfaces(baseSurface, headSurface);

    const breaking = findings.filter((finding) => finding.breaking);
    const additive = findings.filter((finding) => !finding.breaking);

    // A lopsided note count means one side resolved imports the other did not, so a reported
    // difference may be an artefact. Say so before the findings, not after.
    if (baseSurface.notes.length !== headSurface.notes.length) {
      process.stdout.write(
        `note: ${baseRef} produced ${baseSurface.notes.length} compiler notes and the working tree ` +
          `${headSurface.notes.length}. Types that resolve on one side only are compared as 'any'.\n`,
      );
    }

    process.stdout.write(
      `${relativeDir}: ${baseSurface.entries.size} paths at ${baseRef}, ${headSurface.entries.size} now\n`,
    );
    for (const finding of additive) {
      process.stdout.write(`  + ${finding.path}\n`);
    }
    for (const finding of breaking) {
      process.stdout.write(`::error::${finding.path}: ${finding.kind} — ${finding.detail}\n`);
    }

    if (breaking.length > 0) {
      process.stdout.write(
        `\n${breaking.length} breaking change(s). Contracts evolve additively (AD-02): a removed field, ` +
          'a narrowed type or a renamed key needs a new field alongside the old one, not an edit to it.\n',
      );
      return 1;
    }
    process.stdout.write(`ok: ${additive.length} additive or widening change(s), nothing removed or narrowed\n`);
    return 0;
  } finally {
    base.cleanup();
  }
}

// import.meta.url only equals the argv path when this file is the entry, which is what keeps the
// tests free to import compareSurfaces without the CLI running.
const invokedDirectly = process.argv[1] !== undefined && import.meta.url.endsWith(path.basename(process.argv[1]));
if (invokedDirectly) {
  process.exitCode = main(process.argv.slice(2));
}
