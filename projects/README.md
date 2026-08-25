# projects

Bun workspace. Every capability is declared once and served as an HTTP route, plus an MCP tool when it opts in
with `mcp: true`. No build step — Bun runs the TypeScript sources directly and `workspace:*` deps resolve to the
local folders.

## Layout

```
apps/
  mcp          @chaos/mcp         the service: db schema, item capabilities, config, entry
packages/
  capability   @chaos/capability  declare once -> http route + mcp tool + client types
```

`@chaos/capability` knows nothing about this app: `createCapability<Ctx>()` binds the factory to whatever context
the handlers should receive, so the package has no dependency on Drizzle, on `Deps`, or on any domain type. The
app declares its own context in `apps/mcp/src/context.ts`:

```ts
export type Deps = { db: () => Db }
export const capability = createCapability<Deps>()
```

## Run

```
bun install
cp apps/mcp/.env.example apps/mcp/.env
bun run dev
```

- `GET /health`
- `GET|POST /items`, `GET /items/:id`
- `POST /mcp` — MCP over Streamable HTTP (only capabilities with `mcp: true`)
- `items_summarize` is MCP-only — it has no HTTP route

## Declaring a capability

Input is a Zod shape: it validates the HTTP request and becomes the tool's JSON Schema, so there is no second
copy of the contract.

```ts
export const listItems = capability({
    name: "items_list",                          // MCP tool name
    description: "List items, newest first.",
    input: { limit: z.coerce.number().int().min(1).max(100).default(20) },
    route: { method: "get", path: "/items" },    // HTTP surface
    mcp: true,                                   // opt in as an MCP tool (default: false)
    handler: async ({ limit }, { db }) => db().select().from(items).limit(limit)
})
```

Add it to `apps/mcp/src/capabilities/index.ts` and the HTTP route is live. Path params, query string (GET/DELETE)
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

```ts
import { hc } from "hono/client"
import type { AppType } from "@chaos/mcp"

const client = hc<AppType>("http://localhost:4400")

const response = await client.items.$get({ query: { limit: "5" } })
const items = await response.json()          // { id: string; name: string; createdAt: string }[]

await client.items[":id"].$get({ param: { id } })
await client.items.$post({ json: { name: "hello" } })
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
| DB | Drizzle + postgres.js | Works on Node, Bun, Deno, Workers (`nodejs_compat`) |
| Config | `process.env` | Available on every target |

The database handle is injected through the app context and created lazily, so no connection is opened at import
time and capability code never knows which driver it got.

### Kubernetes / any container

```
docker build -f apps/mcp/Dockerfile -t mcp .
```

### Cloudflare Workers

```
cd apps/mcp && npx wrangler deploy
```

`wrangler.jsonc` sets `nodejs_compat`. Use Hyperdrive (or any pooled Postgres URL) for `DATABASE_URL`.

### Node

`bun`/`workerd`/`deno` serve the default export directly. On Node, wrap it:
`serve({ fetch: app.fetch, port })` from `@hono/node-server`.

## Database

Postgres dialect. To switch, replace `drizzle-orm/postgres-js` in `apps/mcp/src/db/client.ts`, the
`drizzle-orm/pg-core` imports in `apps/mcp/src/db/schema.ts`, and `dialect` in `apps/mcp/drizzle.config.ts`.

```
bun run db:generate
bun run db:migrate
```

## Lint, format, test

Biome does both formatting and linting. `biome.json` extends the repo root config (4-space indent, double quotes,
no semicolons, 160 columns, LF) and adds a strict rule set on top:

- `any` is banned — `suspicious/noExplicitAny` is an error, and `tsconfig.json` runs `strict` so implicit `any`
  fails too. No escape hatch via `as any`.
- No non-null assertions (`!`), no parameter reassignment, no `enum`, no `delete`, no bare `console`
  (`console.warn` / `console.error` allowed).
- `noFloatingPromises` and `noMisusedPromises` — an unawaited handler is an error, not a silent bug.
- Unused imports, variables and parameters are errors; imports are auto-sorted by the assist action.
- `project` and `test` lint domains on, so undeclared dependencies and import cycles are caught — including a
  package importing something its own `package.json` does not declare.

```
bun run check        # format + lint + organize imports, writing fixes
bun run ci           # verify only, for CI
bun run typecheck
bun test
```
