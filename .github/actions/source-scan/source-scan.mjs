// @ts-check
/**
 * source-scan — one comment-aware implementation of "this construct must not appear in source".
 *
 * ## Why this exists
 *
 * A guard greps source for a forbidden construct. Somebody writes the comment explaining why the
 * construct is forbidden. The grep matches the comment, and the build goes red on correct code —
 * on the very prose that would have stopped the next violation. That has happened SEVEN times in
 * this estate (micro-org#303), and each repair was local: an inline `awk`, or a `grep -v` on lines
 * that begin with a slash-slash. Seven independent repairs of one defect is the evidence that it
 * should be implemented once.
 *
 * A guard that is red on correct code gets bypassed, and a bypassed guard is not a check — it is a
 * step people know to ignore, and it will not be believed on the day it is right.
 *
 * ## Why not another line-prefix filter
 *
 * The `grep -vE ':[0-9]+:\s*(//|\*|/\*)'` that seven of those repairs used is half a fix, and it
 * is wrong in both directions:
 *
 *   * A TRAILING comment is not stripped, so `stop()  // never call setInterval() here` still
 *     fails the build. Same defect, one column to the right.
 *   * A block-comment body whose continuation lines do not begin with an asterisk is not stripped
 *     either, and this estate writes every boundary in a block comment.
 *
 * And the one stripper that did handle comment BODIES — the `awk` in service-ci.yml's rule 1 —
 * was not string-aware, so it read the slash-slash in `'postgres://…'` as the start of a comment
 * and blanked the rest of the line. That is the worse failure and the one the issue warns about: a
 * guard that strips too eagerly has quietly stopped working and looks green forever. It is
 * reproduced as a regression test in test/source-scan.test.ts.
 *
 * ## What it does
 *
 * Comment TEXT is blanked in place, preserving every other byte and every newline — so line and
 * column numbers still point at real source, and CODE ON A LINE THAT ALSO CARRIES A COMMENT IS
 * STILL SCANNED. That distinction is the whole thing:
 *
 *     const rpc = rpcFactory()   // still caught: the code is code
 *     // never call rpcFactory() — allowed: the line is entirely prose
 *
 * Strings are kept by DEFAULT, because for most guards the string IS the violation — a hostname, a
 * DSN, a script `src`. `ignore-strings` blanks string bodies for the guards where the opposite is
 * true (an identifier rule that must not fire on a UI label). It is opt-in because a default that
 * strips more is a default that silently weakens every guard that adopts it.
 *
 * ## Known limits, pinned by tests rather than left to be discovered
 *
 *   * JSX and HTML text is not quoted, so a bare slash-slash in prose inside markup does blank the
 *     rest of that line. The dominant case — a bare URL — is handled: `://` never opens a comment.
 *   * A template literal is scanned to its next unescaped backtick; a backtick nested inside a
 *     `${…}` substitution would confuse it. No such line exists in this estate.
 *   * Regex literals are detected from the preceding token, which is the standard heuristic and is
 *     not a parser. `split(/\//)` is handled; the test file records the shapes that are.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/** @typedef {'js' | 'html' | 'both' | 'hash'} Syntax */

/**
 * @typedef {object} Hit
 * @property {string} file      path relative to the scan root
 * @property {number} line      1-based
 * @property {number} column    1-based
 * @property {string} match     the matched text
 * @property {string} text      the ORIGINAL source line, comments and all
 */

/** Directories that are never source. Kept here so every caller gets the same answer. */
export const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  'out',
  '.next',
  '.turbo',
  '.svelte-kit',
  'vendor',
]);

/** The default file set: the JavaScript family, which is what every guard in this estate reads. */
export const DEFAULT_EXTENSIONS = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts'];

const HTML_EXT = new Set(['html', 'htm', 'svg', 'xml']);
/** Markup that also carries a script block, so both comment syntaxes apply. */
const BOTH_EXT = new Set(['vue', 'svelte', 'astro']);
/** Compose files, Dockerfiles, shell and `.env` — where a comment starts with `#`. */
const HASH_EXT = new Set(['yml', 'yaml', 'toml', 'sh', 'bash', 'env', 'conf', 'ini']);
const HASH_NAME = /^(Dockerfile|Makefile|\.env)/;

/**
 * The comment syntax of a file, by extension. Anything unrecognised is treated as JavaScript,
 * which is the estate's overwhelming default and the conservative answer for a guard: only the two
 * JavaScript comment forms are blanked, nothing else is.
 *
 * @param {string} file
 * @returns {Syntax}
 */
export function syntaxFor(file) {
  const base = file.split('/').pop() ?? file;
  const ext = (base.includes('.') ? (base.split('.').pop() ?? '') : '').toLowerCase();
  if (BOTH_EXT.has(ext)) return 'both';
  if (HTML_EXT.has(ext)) return 'html';
  if (HASH_EXT.has(ext) || HASH_NAME.test(base)) return 'hash';
  return 'js';
}

/**
 * True when a `/` at `i` opens a regular-expression literal rather than dividing.
 *
 * The standard heuristic: look at the previous significant token. After a value — an identifier, a
 * number, `)` or `]` — a slash divides. After an operator, a punctuator, or one of the keywords
 * below, it opens a literal. This matters because `/\//` holds two adjacent slashes and would
 * otherwise be read as a line comment, silently blanking the rest of `str.split(/\//)`.
 *
 * @param {string} text
 * @param {number} i
 */
function opensRegex(text, i) {
  let j = i - 1;
  while (j >= 0 && /\s/.test(text.charAt(j))) j--;
  if (j < 0) return true;
  const prev = text.charAt(j);
  if (/[)\]]/.test(prev)) return false;
  if (/[A-Za-z0-9_$]/.test(prev)) {
    let k = j;
    while (k >= 0 && /[A-Za-z0-9_$]/.test(text.charAt(k))) k--;
    return /^(return|typeof|instanceof|in|of|new|delete|void|do|else|yield|await|case|throw)$/.test(
      text.slice(k + 1, j + 1),
    );
  }
  return true;
}

/**
 * Index just past a string literal opening at `open`.
 *
 * @param {string} text
 * @param {number} open  index of the opening quote
 * @param {string} quote
 */
function endOfString(text, open, quote) {
  let i = open + 1;
  while (i < text.length) {
    const c = text.charAt(i);
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === quote) return i + 1;
    // An unterminated quote does not run past its own line. Without this an apostrophe in JSX
    // prose would swallow the rest of the file and take every guard with it.
    if (c === '\n' && quote !== '`') return i;
    i++;
  }
  return text.length;
}

/**
 * Index just past a regular-expression literal opening at `open`, honouring `[…]` classes, inside
 * which an unescaped `/` is literal.
 *
 * @param {string} text
 * @param {number} open
 */
function endOfRegex(text, open) {
  let i = open + 1;
  let inClass = false;
  while (i < text.length) {
    const c = text.charAt(i);
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '\n') return i;
    if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) return i + 1;
    i++;
  }
  return text.length;
}

/**
 * Blank the comment text in `source`, byte for byte: the result has the same length and the same
 * newlines, with commented characters replaced by spaces.
 *
 * @param {string} source
 * @param {object} [options]
 * @param {Syntax} [options.syntax]
 * @param {boolean} [options.ignoreStrings] also blank string BODIES, keeping the delimiters
 * @returns {string}
 */
export function blankComments(source, options = {}) {
  const syntax = options.syntax ?? 'js';
  const ignoreStrings = options.ignoreStrings ?? false;
  /** @type {string[]} */
  const out = source.split('');

  /**
   * @param {number} from
   * @param {number} to
   */
  const blank = (from, to) => {
    for (let k = Math.max(from, 0); k < to && k < out.length; k++) {
      if (out[k] !== '\n') out[k] = ' ';
    }
  };

  if (syntax === 'hash') {
    // YAML's rule, which is also the shell's: a `#` opens a comment only at the start of a line or
    // after whitespace. `image: repo/name#tag` is not a comment, and neither is `${VAR#prefix}`.
    let i = 0;
    while (i < source.length) {
      const c = source.charAt(i);
      if (c === '"' || c === "'") {
        i = endOfString(source, i, c);
        continue;
      }
      if (c === '#' && (i === 0 || /\s/.test(source.charAt(i - 1)))) {
        let j = i;
        while (j < source.length && source.charAt(j) !== '\n') j++;
        blank(i, j);
        i = j;
        continue;
      }
      i++;
    }
    return out.join('');
  }

  if (syntax === 'html' || syntax === 'both') {
    let i = 0;
    for (;;) {
      const open = source.indexOf('<!--', i);
      if (open === -1) break;
      const close = source.indexOf('-->', open + 4);
      const end = close === -1 ? source.length : close + 3;
      blank(open, end);
      i = end;
    }
  }

  if (syntax === 'html') return out.join('');

  // The JS pass reads the result of the HTML pass. That pass only ever replaces characters with
  // spaces, so every offset is unchanged and a slash-slash inside an HTML comment is now blank.
  const scanned = syntax === 'both' ? out.join('') : source;
  let i = 0;
  while (i < scanned.length) {
    const c = scanned.charAt(i);
    const d = scanned.charAt(i + 1);

    if (c === '/' && d === '/') {
      // `://` is a URL. Written bare in JSX text it is not a comment, and reading it as one is
      // exactly how the previous stripper blanked live code.
      if (scanned.charAt(i - 1) === ':') {
        i += 2;
        continue;
      }
      let j = i;
      while (j < scanned.length && scanned.charAt(j) !== '\n') j++;
      blank(i, j);
      i = j;
      continue;
    }

    if (c === '/' && d === '*') {
      const close = scanned.indexOf('*/', i + 2);
      const end = close === -1 ? scanned.length : close + 2;
      blank(i, end);
      i = end;
      continue;
    }

    if (c === '"' || c === "'" || c === '`') {
      const end = endOfString(scanned, i, c);
      if (ignoreStrings) blank(i + 1, end - 1);
      i = end;
      continue;
    }

    if (c === '/' && opensRegex(scanned, i)) {
      i = endOfRegex(scanned, i);
      continue;
    }

    i++;
  }

  return out.join('');
}

/**
 * @param {RegExp} pattern
 * @returns {RegExp} the same pattern, global, so `exec` walks the whole file
 */
function global(pattern) {
  return pattern.flags.includes('g')
    ? pattern
    : new RegExp(pattern.source, `${pattern.flags}g`);
}

/**
 * Every match of `pattern` in `text`, judged against the comment-blanked copy but reported with
 * the original line so a reader sees the real code.
 *
 * @param {string} text
 * @param {object} options
 * @param {string} options.file
 * @param {RegExp} options.pattern
 * @param {Syntax} [options.syntax]
 * @param {boolean} [options.ignoreStrings]
 * @param {RegExp} [options.allowMatch]  a matched TEXT matching this is exempt
 * @param {RegExp} [options.allowLine]   an original LINE matching this is exempt
 * @returns {Hit[]}
 */
export function scanText(text, options) {
  const stripped = blankComments(text, {
    syntax: options.syntax ?? syntaxFor(options.file),
    ignoreStrings: options.ignoreStrings ?? false,
  });
  const lines = text.split('\n');

  const re = global(options.pattern);
  re.lastIndex = 0;
  /** @type {Hit[]} */
  const hits = [];
  let line = 1;
  let lineStart = 0;
  let cursor = 0;
  for (;;) {
    const m = re.exec(stripped);
    if (m === null) break;
    // A zero-length match loops forever and cannot describe a forbidden construct anyway.
    if (m[0] === '') {
      re.lastIndex++;
      continue;
    }
    if (options.allowMatch?.test(m[0])) continue;
    while (cursor < m.index) {
      if (stripped.charAt(cursor) === '\n') {
        line++;
        lineStart = cursor + 1;
      }
      cursor++;
    }
    const original = lines[line - 1] ?? '';
    // The allow marker is read from the ORIGINAL line, because it is written IN a comment —
    // `foo() // cfctl-allow setInterval`. Testing the blanked line would delete every exemption.
    if (options.allowLine?.test(original)) continue;
    hits.push({
      file: options.file,
      line,
      column: m.index - lineStart + 1,
      match: m[0],
      text: original,
    });
  }
  return hits;
}

/**
 * @param {string} root
 * @param {readonly string[]} paths
 * @param {Set<string>} extensions
 * @param {RegExp} [excludeFiles]
 * @param {RegExp} [includeFiles]
 * @returns {string[]} paths relative to `root`, sorted
 */
function collect(root, paths, extensions, excludeFiles, includeFiles) {
  /** @type {string[]} */
  const found = [];
  /** @param {string} abs */
  const walk = (abs) => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const full = path.join(abs, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = path.relative(root, full);
      if (!extensions.has((entry.name.split('.').pop() ?? '').toLowerCase())) continue;
      if (excludeFiles?.test(rel)) continue;
      if (includeFiles !== undefined && !includeFiles.test(rel)) continue;
      found.push(rel);
    }
  };
  for (const p of paths) {
    const abs = path.resolve(root, p);
    if (statSync(abs).isDirectory()) walk(abs);
    else {
      const rel = path.relative(root, abs);
      if (!excludeFiles?.test(rel)) found.push(rel);
    }
  }
  return found.sort();
}

/**
 * @typedef {object} ScanRequest
 * @property {string} root
 * @property {readonly string[]} paths
 * @property {RegExp} pattern
 * @property {readonly string[]} [extensions]
 * @property {RegExp} [excludeFiles]
 * @property {RegExp} [includeFiles]
 * @property {RegExp} [allowMatch]
 * @property {RegExp} [allowLine]
 * @property {boolean} [ignoreStrings]
 */

/**
 * Scan a tree. A path that does not exist is REPORTED rather than skipped: a guard pointed at a
 * directory that is not there cannot fail, which is the defect on the other side of this one
 * (micro-org#38).
 *
 * @param {ScanRequest} request
 * @returns {{ hits: Hit[], scanned: string[], missing: string[] }}
 */
export function scan(request) {
  /** @type {string[]} */
  const missing = [];
  /** @type {string[]} */
  const present = [];
  for (const p of request.paths) {
    (existsSync(path.resolve(request.root, p)) ? present : missing).push(p);
  }
  const extensions = new Set(
    (request.extensions ?? DEFAULT_EXTENSIONS).map((e) => e.replace(/^\./, '').toLowerCase()),
  );
  const files = collect(
    request.root,
    present,
    extensions,
    request.excludeFiles,
    request.includeFiles,
  );
  /** @type {Hit[]} */
  const hits = [];
  for (const file of files) {
    const text = readFileSync(path.resolve(request.root, file), 'utf8');
    hits.push(
      ...scanText(text, {
        file,
        pattern: request.pattern,
        ...(request.allowMatch === undefined ? {} : { allowMatch: request.allowMatch }),
        ...(request.allowLine === undefined ? {} : { allowLine: request.allowLine }),
        ...(request.ignoreStrings === undefined ? {} : { ignoreStrings: request.ignoreStrings }),
      }),
    );
  }
  return { hits, scanned: files, missing };
}

/* -------------------------------------------------------------- the action entry point -- */

/**
 * @param {string} name
 * @param {Record<string, string | undefined>} env
 */
function input(name, env) {
  /*
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * **THE HYPHEN IS KEPT, AND KEEPING IT IS THE WHOLE FUNCTION.**
   *
   * GitHub sets a node action's inputs as `INPUT_<NAME>` where <NAME> is the declared name
   * upper-cased with SPACES replaced by underscores — hyphens are left alone. `@actions/core`'s
   * `getInput` is one line and does exactly that. So `allow-match` arrives as `INPUT_ALLOW-MATCH`.
   *
   * This read `INPUT_ALLOW_MATCH`, and therefore read nothing. Every hyphenated input was silently
   * absent: `allow-match`, `allow-line`, `exclude-files`, `include-files`, `empty-scan`,
   * `missing-path`, `working-directory`, `ignore-strings`. The two guards that depend on an
   * allow-list — "one database, and only its own" and "only published contract and runtime
   * packages" — reported every service reading its OWN `*_DATABASE_URL` and every import of
   * `@cloudsforge/telemetry` as violations, and `exclude-files` stopped hiding test files, so
   * `src/env.test.ts` was scanned too. Measured on micro-settlement and micro-wallet minutes after
   * this action first went live.
   *
   * The underscore form is still accepted as a FALLBACK, and only as one. Nothing GitHub does
   * produces it; a local harness or `act` might, and refusing it would buy nothing. The dash form
   * is tried first so that the two can never disagree about which wins.
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   */
  const upper = name.toUpperCase();
  const asGitHubSetsIt = env[`INPUT_${upper}`];
  const underscored = env[`INPUT_${upper.replace(/-/g, '_')}`];
  return (asGitHubSetsIt ?? underscored ?? '').trim();
}

/**
 * A list input: newline- or comma-separated, blanks dropped.
 *
 * @param {string} raw
 */
function list(raw) {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/**
 * The whole action as a function of its inputs, so a test can run it without a runner and without
 * spawning. The action entry below is three lines on top of this.
 *
 * @param {Record<string, string | undefined>} env
 * @param {(s: string) => void} write
 * @returns {number} exit code
 */
export function run(env, write) {
  const patternSource = input('pattern', env);
  if (patternSource === '') {
    // A guard with no pattern would scan nothing and pass. That is micro-org#38's shape, so it is
    // an error rather than a no-op.
    write('::error::source-scan was given no pattern, so it could not have failed\n');
    return 2;
  }
  const paths = list(input('paths', env) || 'src');
  const title = input('title', env) || 'a forbidden construct appears in the source';
  const optional = input('missing-path', env) === 'ok';

  /** @type {ScanRequest} */
  const request = {
    root: input('working-directory', env) || env['GITHUB_WORKSPACE'] || '.',
    paths,
    pattern: new RegExp(patternSource, input('flags', env)),
  };
  const extensions = list(input('extensions', env));
  if (extensions.length > 0) request.extensions = extensions;
  for (const [key, field] of /** @type {const} */ ([
    ['exclude-files', 'excludeFiles'],
    ['include-files', 'includeFiles'],
    ['allow-match', 'allowMatch'],
    ['allow-line', 'allowLine'],
  ])) {
    const raw = input(key, env);
    if (raw !== '') request[field] = new RegExp(raw);
  }
  if (input('ignore-strings', env) === 'true') request.ignoreStrings = true;

  const { hits, scanned, missing } = scan(request);

  // A filter that matches no file at all is a guard that cannot fail, and it looks exactly like a
  // guard that passed. It is the failure this estate has had twenty-two times (micro-org#38).
  if (scanned.length === 0 && missing.length === 0 && input('empty-scan', env) !== 'ok') {
    write('::error::source-scan matched no files, so this guard could not have failed\n');
    write(`paths=${paths.join(', ')} extensions=${input('extensions', env) || DEFAULT_EXTENSIONS.join(',')}\n`);
    write('Set empty-scan: ok if a repository with none of these files is a legitimate pass.\n');
    return 1;
  }

  if (missing.length > 0 && !optional) {
    write(`::error::source-scan has nothing to scan: ${missing.join(', ')} does not exist\n`);
    write('A guard pointed at a path that is not there cannot fail (micro-org#38). Fix the path,\n');
    write('or set missing-path: ok if it is genuinely optional.\n');
    return 1;
  }
  if (missing.length === paths.length) {
    write(`ok: ${missing.join(', ')} does not exist, and this guard is declared optional\n`);
    return 0;
  }

  if (hits.length > 0) {
    for (const hit of hits) {
      write(`::error file=${hit.file},line=${hit.line},col=${hit.column}::${title}: ${hit.match}\n`);
    }
    write(`::error::${title}\n`);
    for (const hit of hits) {
      write(`  ${hit.file}:${hit.line}:${hit.column}: ${hit.text.trim()}\n`);
    }
    const guidance = input('guidance', env);
    if (guidance !== '') write(`\n${guidance}\n`);
    write('\nComments and JSDoc are blanked before matching, so every line above is code.\n');
    write('Writing down WHY the construct is forbidden will not fail this step: micro-org#303.\n');
    return 1;
  }

  write(`${input('ok', env) || 'ok: no match'} — ${scanned.length} files scanned\n`);
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && process.argv[1].endsWith('source-scan.mjs');
if (invokedDirectly) {
  process.exitCode = run(process.env, (s) => process.stdout.write(s));
}
