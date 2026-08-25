# projects

Bun workspace. Every capability is declared once and served as an HTTP route, plus an MCP tool when it opts in
with `mcp: true`. No build step — Bun runs the TypeScript sources directly and `workspace:*` deps resolve to the
local folders.

Agents editing this workspace: read [AGENTS.md](AGENTS.md) first.

## Layout

```
apps/
  api          @chaos/api         http api + mcp endpoint: capabilities, db, config, entry
  web          @chaos/web         small frontend on the typed client, proxies /api -> the service
packages/
  capability   @chaos/capability  declare once -> http route + mcp tool + openapi + client types
  schema       @chaos/schema      the wire contract: zod input shapes and output schemas
```

Only two things are shared. `@chaos/capability` is the mechanism; `@chaos/schema` is the contract — zod and
nothing else, so a browser can import it without dragging in Drizzle, Hono or the MCP SDK. Everything
app-specific (db schema, db client, the item capabilities) lives in `apps/api`, because nothing else consumes it.

Both shared packages set `"sideEffects": false`, which is what makes per-export tree-shaking work: an unused
export from `@chaos/schema` is dropped from the web bundle, and without that flag it is not (measured, not
assumed).

`@chaos/capability` knows nothing about this app: `createCapability<Ctx>()` binds the factory to whatever context
the handlers should receive, so the package has no dependency on Drizzle or on any domain type. The app declares
its own context in `apps/api/src/context.ts`:

```ts
export type Deps = { db: () => Db }
export const capability = createCapability<Deps>()
```

## Run

```
bun install
bun run db:migrate        # creates apps/api/api.sqlite
bun run dev               # both apps, prefixed output, one Ctrl-C stops everything
```

`dev` is `bun run --parallel --no-orphans --filter './apps/*' dev` — Bun's own workspace runner, no `concurrently`
and no task orchestrator. `--parallel` is what makes it concurrent (a bare `--filter` runs the matched scripts in
sequence, so the first watcher blocks the rest) and `--no-orphans` is what makes stopping the parent stop both
children. `bun run dev:api` / `bun run dev:web` still run one at a time.

- `GET /health`
- `GET|POST /api/v1/items`, `GET /api/v1/items/:id`
- `POST /mcp` — MCP over Streamable HTTP (only capabilities with `mcp: true`)
- `GET /openapi.json` — generated from the same declarations
- `items_summarize` is MCP-only — it has no HTTP route, so the frontend cannot call it and models can

## Documentation

`/openapi.json` is generated from the capability registry at startup: paths and methods from `route`, parameters
and request bodies from the Zod shape (`:id` becomes a path parameter, the rest becomes query or body depending
on the method), descriptions from the declaration. Capabilities that are also tools carry `x-mcp-tool`, and the
document ends with an `x-mcp` block listing every tool with its JSON Schema — including the MCP-only ones that
have no path.

The service serves the document, not a viewer. Point whatever you like at it — Scalar, Swagger UI, Redoc,
Postman — or render it in a separate project. Every off-the-shelf viewer ships as a CDN-loaded bundle, which is
not something this service should depend on to describe itself.

## Declaring a capability

Input is a Zod shape: it validates the HTTP request and becomes the tool's JSON Schema, so there is no second
copy of the contract.

```ts
export const listItems = capability({
    name: "items_list",                          // MCP tool name
    description: "List items, newest first.",
    input: listItemsInput,                       // from @chaos/schema
    output: listItemsOutput,                     // from @chaos/schema
    route: { method: "get", path: "/items" },    // HTTP surface
    mcp: true,                                   // opt in as an MCP tool (default: false)
    handler: async ({ limit }, { db }) => (await db().select().from(items).limit(limit)).map(toItem)
})
```

`input` validates the request and becomes the tool's JSON Schema. `output` is optional: when present it types the
handler's return value and fills in the 200 response schema in `/openapi.json`. Both live in `@chaos/schema`, so
the frontend imports exactly the same definitions — `Item` in `apps/web` is `z.infer` of the schema the handler
is checked against.

Add it to `apps/api/src/capabilities/index.ts` and the HTTP route is live.

### Base path

`createApp` takes an optional `basePath`, and this app sets it to `/api/v1`. The prefix shows up in the routes, in
`/openapi.json` and in the client types alike — `client.api.v1.items.$get(...)` is what type-checks.

`/health`, `/mcp`, `/docs` and `/openapi.json` stay at the root: they are not part of the versioned API, and each
has its own absolute path option (`mcpPath`, `openapiPath`, `docsPath`).

### Surfaces

One build, three deployments. `SURFACES` picks what the process actually mounts:

```
SURFACES=http,openapi   # plain REST service, /mcp returns 404
SURFACES=mcp            # mcp server only, no capability routes and no schema
# unset                 # everything (the default)
```

`/health` is always mounted so probes work in every mode, and `/openapi.json` drops its `x-mcp` block when the
mcp surface is off rather than documenting an endpoint that 404s. Run the same image twice with different values
to put the API and the MCP server on separate hosts, scaling and auth of their own.

In code it is `createApp({ surfaces: { http, mcp, openapi } })`, all defaulting to true. The returned type still
describes every capability route even when `http` is off — a deployment switch does not change what the code
declares, so keep the typed client pointed at a deployment that serves HTTP.

### Middleware

Middleware registered on the returned app does **nothing** — Hono dispatches in registration order and the routes
are already mounted. Pass it in instead, per surface:

```ts
createApp({
    context,
    capabilities,
    info,
    middleware: {
        all: [logger()],                  // every route, /mcp, /health and /openapi.json included
        http: [apiKeyAuth],               // capability routes only, never /mcp
        mcp: [bearerAuth]                 // the mcp endpoint only
    }
})
```

The two surfaces authenticate differently in practice — a browser session or an API key for HTTP, a bearer token
from the MCP client — so they get separate slots. `all` runs first, then the surface slot, then any middleware
the route itself declares:

```ts
route: {
    method: "post",
    path: "/items",
    middleware: [requireAdmin]            // this route only, http surface only
}
```

An MCP `tools/call` never passes through `http` or route middleware — it arrives at `/mcp`, not at the
capability's path. Anything that must hold for both surfaces goes in `all`, or in the context the handler
receives. Path params, query string (GET/DELETE)
and JSON body (POST/PUT/PATCH) all feed the same validated input object.

Each surface is opt-in independently, and the type system requires at least one of them:

| Declaration | HTTP | MCP tool |
| --- | --- | --- |
| `route` only | yes | no — `mcp` defaults to `false` |
| `route` + `mcp: true` | yes | yes |
| `mcp: true`, no `route` | no | yes |
| neither | does not compile | |

## Typed client (Hono RPC)

The same declarations produce the client types. `createApp` carries the capability tuple through to the returned
`Hono` type, so `hc` gets full route, input and output typing from a **type-only** import — no server code, no
Drizzle, no MCP SDK in the client bundle.

`apps/web` is exactly this: a page that lists and creates items with no hand-written request types.

```ts
import { hc } from "hono/client"
import type { AppType } from "@chaos/api"

const items = hc<AppType>("http://localhost:4400").api.v1.items

const response = await items.$get({ query: { limit: "5" } })
const rows = await response.json()           // { id: string; name: string; createdAt: string }[]

await items[":id"].$get({ param: { id } })
await items.$post({ json: { name: "hello" } })
```

Unknown routes, unknown query keys and wrong body types all fail to compile. `Date` is typed as `string` because
`JSONParsed` models what actually crosses the wire.

Caveat: the declared output is the success body. Validation failures return `400` with `{ error, issues }`, so
check `response.ok` before trusting the parsed body.

## Portability

| Layer | Choice | Why it travels |
| --- | --- | --- |
| HTTP | Hono, `fetch(Request) => Response` | Web standard |
| Entry | `export default { port, fetch }` | Bun and Workers/Deno both accept it |
| MCP | `@modelcontextprotocol/sdk` + `@hono/mcp` | No `node:` builtins on this path |
| DB | Drizzle + `bun:sqlite` | **Bun-only** — see below |
| Config | `process.env` | Available on every target |

The database handle is injected through the app context and created lazily, so nothing is opened at import time
and capability code never knows which driver it got.

The SQLite driver is the one deliberate exception to the table above: `bun:sqlite` is a Bun builtin, so the
storage layer no longer runs on Workers or Node. It is a test-time choice. Swapping
`apps/api/src/db/client.ts` back to `drizzle-orm/postgres-js` (or `drizzle-orm/libsql`) restores portability —
nothing outside that file knows the difference.

### Kubernetes / any container

```
docker build -f apps/api/Dockerfile -t chaos-api .
```

### Cloudflare Workers

```
cd apps/api && npx wrangler deploy
```

`wrangler.jsonc` sets `nodejs_compat`. This works only once the storage layer is off `bun:sqlite` — swap
`apps/api/src/db/client.ts` for postgres.js with Hyperdrive, or libsql.

### Node

`bun`/`workerd`/`deno` serve the default export directly. On Node, wrap it:
`serve({ fetch: app.fetch, port })` from `@hono/node-server`.

## Database

SQLite through `bun:sqlite`, file at `apps/api/api.sqlite` (`DATABASE_PATH` to move it). `drizzle-kit` generates
migrations; applying them goes through `drizzle-orm/bun-sqlite/migrator` rather than `drizzle-kit migrate`, which
would need `better-sqlite3` or `@libsql/client` installed.

```
bun run db:generate
bun run db:migrate
```

To switch dialect, replace the driver in `apps/api/src/db/client.ts`, the `drizzle-orm/sqlite-core` imports in
`apps/api/src/db/schema.ts`, and `dialect` in `apps/api/drizzle.config.ts`.

## Lint, format, test

Biome does both formatting and linting. `biome.json` extends the repo root config (4-space indent, double quotes,
no semicolons, 160 columns, LF) and adds a strict rule set on top:

- `any` is banned — `suspicious/noExplicitAny` is an error, and `tsconfig.json` runs `strict` so implicit `any`
  fails too. No escape hatch via `as any`.
- No non-null assertions (`!`), no parameter reassignment, no `enum`, no `delete`, no bare `console`
  (`console.warn` / `console.error` allowed).
- `noFloatingPromises` and `noMisusedPromises` — an unawaited handler is an error, not a silent bug.
- `noUnsafeTypeAssertion` — `as` is an error. Two assertions survive, each with a `biome-ignore` naming the
  reason: they are the type-level bridges (loop-registered routes, one erased factory implementation) that
  TypeScript cannot infer. Everything else uses annotations, type arguments or a real runtime check.
- Unused imports, variables and parameters are errors; imports are auto-sorted by the assist action.
- `project` and `test` lint domains on, so undeclared dependencies and import cycles are caught — including a
  package importing something its own `package.json` does not declare.

```
bun run check        # format + lint + organize imports, writing fixes
bun run ci           # verify only, for CI
bun run typecheck
bun test
```
