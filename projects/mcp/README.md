# mcp

Bun + Hono + Drizzle. Every capability is declared once and served as an HTTP route, plus an MCP tool when it
opts in with `mcp: true`. Nothing in `src/` imports a runtime- or vendor-specific API.

## Run

```
bun install
cp .env.example .env
bun run dev
```

- `GET /health`
- `GET|POST /items`, `GET /items/:id`
- `POST /mcp` — MCP over Streamable HTTP (only capabilities with `mcp: true`)

## Declaring a capability

`capability()` takes one declaration and produces both surfaces. Input is a Zod shape: it validates the HTTP
request and becomes the tool's JSON Schema, so there is no second copy of the contract.

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

Add it to `src/capabilities/index.ts` and the HTTP route is live. Path params, query string (GET/DELETE) and JSON
body (POST/PUT/PATCH) all feed the same validated input object.

Each surface is opt-in independently, and the type system requires at least one of them:

| Declaration | HTTP | MCP tool |
| --- | --- | --- |
| `route` only | yes | no — `mcp` defaults to `false` |
| `route` + `mcp: true` | yes | yes |
| `mcp: true`, no `route` | no | yes |
| neither | does not compile | |

So a model-only tool just drops the route:

```ts
export const summarize = capability({
    name: "items_summarize",
    description: "Only reachable over MCP.",
    input: { since: z.iso.date() },
    mcp: true,
    handler: async ({ since }, { db }) => ...
})
```

## Typed client (Hono RPC)

The same declarations also produce the client types. `createApp` carries the capability tuple through to the
returned `Hono` type, so `hc` gets full route, input and output typing from a **type-only** import — no server
code, no Drizzle, no MCP SDK in the client bundle.

```ts
import { hc } from "hono/client"
import type { AppType } from "../mcp/src/app.ts"

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

The database handle is injected (`Deps.db`) and created lazily, so no connection is opened at import time and
capability code never knows which driver it got.

### Kubernetes / any container

```
docker build -t mcp .
```

### Cloudflare Workers

```
npx wrangler deploy
```

`wrangler.jsonc` sets `nodejs_compat`. Use Hyperdrive (or any pooled Postgres URL) for `DATABASE_URL`.

### Node

`bun`/`workerd`/`deno` serve the default export directly. On Node, wrap it:
`serve({ fetch: app.fetch, port })` from `@hono/node-server`.

## Database

Postgres dialect. To switch, replace `drizzle-orm/postgres-js` in `src/db/client.ts`, the `drizzle-orm/pg-core`
imports in `src/db/schema.ts`, and `dialect` in `drizzle.config.ts`. Nothing else changes.

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
- `project` and `test` lint domains on, so undeclared dependencies and import cycles are caught.

```
bun run check        # format + lint + organize imports, writing fixes
bun run ci           # verify only, for CI
bun run typecheck
bun test
```
