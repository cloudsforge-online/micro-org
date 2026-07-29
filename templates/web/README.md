# micro-__NAME__

One CloudsForge frontend. Built to a static bundle, served by nginx behind the gateway.

```bash
pnpm install
pnpm check      # typecheck + tests
pnpm dev
```

## The one property that must not regress

**Hosts are resolved at runtime, never at build time.** `src/hosts.ts` derives every API host from
`window.location`, so one image serves local, staging and production. `web-ci.yml` fails the build
if `import.meta.env.VITE_` appears anywhere.

Losing this looks harmless and costs a lot: the release manifest could no longer pin one image per
frontend, promoting a build from staging to production would become rebuilding it, and the artifact
that was tested would not be the artifact that shipped.

## Also enforced

- No business logic that is not also enforced server side. The game client already demonstrated
  the failure mode: it withheld four SKUs from the UI while the routes stayed live and chargeable.
- No third-party analytics tag. Product analytics is a service fed by the event bus (AD-21).
