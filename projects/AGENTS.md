# Working in `projects/`

Rules for any AI agent editing this workspace. Read `README.md` for what the code does; this file is about how to
change it.

## Before you claim anything works

```bash
bun run typecheck    # tsc for the workspace, plus apps/web with its DOM lib
bun test
bun run ci           # biome, verify only
```

All three must pass. For anything touching a request path, also run it: start the app and hit the endpoint
(`curl`, or the browser for a page). "Types check" is not evidence that a route responds — several bugs in this
repo's history compiled cleanly and returned 500 or rendered a blank page.

Never report a step as done that you skipped, and never describe untested code as verified. If something is
blocked, finish the rest and say plainly what you left out.

## Layout rules

```
apps/api    http api + mcp endpoint      apps/web    frontend
packages/capability   the mechanism      packages/schema   the wire contract
```

- A package exists only when something outside its owner consumes it. `db` and the item capabilities live inside
  `apps/api` for exactly this reason — do not promote code to `packages/` speculatively.
- `packages/capability` must not import app types, Drizzle, or anything domain-specific. Handler context comes in
  through `createCapability<Ctx>()`.
- `packages/schema` depends on **zod only** — a browser imports it. Never add a server dependency there.
- Shared packages set `"sideEffects": false`. This is load-bearing: without it an unused export is not
  tree-shaken out of the web bundle (measured). Keep barrel files as flat `export *`, not `export * as ns`.
- Every package declares its own dependencies. Biome's `noUndeclaredDependencies` will catch a missing one.

## Capabilities

One declaration produces the HTTP route, the MCP tool, the OpenAPI entry and the client types. Never write a
second copy of a contract.

- `input` and `output` schemas belong in `packages/schema`, not inline in the capability.
- `mcp` defaults to `false`. Only expose a capability to models deliberately.
- A capability needs at least one surface (`route`, `mcp: true`, or both); the overloads enforce it.
- Register it in `apps/api/src/capabilities/index.ts` or it does not exist.
- Handlers return the wire shape. Convert `Date` to an ISO string in the handler — the declared output schema is
  the contract, not the row type.

## Surfaces

`createApp({ surfaces: { http, mcp, openapi } })` decides what a deployment mounts; `apps/api` reads it from
`SURFACES` (unset means all). `/health` is always mounted. When you add anything that publishes route or tool
information, respect these flags — `/openapi.json` must not advertise a surface the process did not mount.

The returned type is unchanged by the flags, so a client that type-checks can still 404 against an mcp-only
deployment. That is deliberate; do not try to make the type conditional.

## Middleware

`app.use()` on the app `createApp` returns does nothing — the routes are already registered and Hono dispatches
in order. Pass it to `createApp` instead, choosing the surface it belongs to:

- `middleware.all` — every route, `/mcp`, `/health` and `/openapi.json` included.
- `middleware.http` — capability routes only. The place for API auth.
- `middleware.mcp` — the mcp endpoint only. The place for MCP auth, which is usually a different scheme.
- `route.middleware` — one route, HTTP surface only.

They run in that order. An MCP tool call arrives at `/mcp` and never passes through `http` or route middleware,
so a guard that must hold for both surfaces goes in `all` or in the handler's context — never in `http` alone.

## TypeScript

- **No `any`.** `noExplicitAny` is an error and `strict` is on.
- **No `as`.** `noUnsafeTypeAssertion` is an error. Reach for a type argument, an annotation, `satisfies`, or a
  real runtime check first — in this repo nine of eleven assertions turned out to be avoidable. If one is truly
  unavoidable, add `// biome-ignore lint/nursery/noUnsafeTypeAssertion: <reason>` stating why.
- No non-null assertions (`!`), no `enum`, no bare `console` (`console.warn`/`console.error` are allowed).
- Do not hand-format. `bun run check` applies the house style (4 spaces, double quotes, no semicolons, 160
  columns) from the repo-root Biome config that `biome.json` extends.

## Portability

Nothing under `packages/` or `apps/api/src` may reach for a runtime-specific API. The two deliberate exceptions:

- `apps/api/src/db/client.ts` uses `bun:sqlite` — the only Bun-bound file, and a test-time choice.
- `apps/api/src/index.ts` exports `{ port, fetch }`, which Bun, workerd and Deno all accept.

If you need a new capability of the platform, add it behind an injected dependency rather than importing the
platform directly.

## Commands and traps

- `bun run dev` starts both apps. `--parallel` is required (a bare `--filter` runs them sequentially and the
  first watcher blocks the rest) and `--no-orphans` is what makes one Ctrl-C stop both.
- `bun run db:migrate` goes through `drizzle-orm/bun-sqlite/migrator`, not `drizzle-kit migrate`, which would
  demand `better-sqlite3`. Generated migrations in `apps/api/drizzle/` are committed; `*.sqlite` files are not.
- Do **not** run `biome migrate`. It rewrote the repo-root config, marked the root as a non-root config and
  turned `recommended` into `preset: "none"`, silently disabling every rule.
- The service serves `/openapi.json` and no viewer. Do not add a documentation UI dependency here: every one of
  them loads its bundle from a CDN. Rendering the document is a separate project's job.
- Adding a dependency needs a reason. This workspace prefers the runtime's own tools: Bun's workspace runner over
  `concurrently`, a self-contained docs page over a CDN-loaded viewer, zod's built-in JSON Schema over a
  converter library.
