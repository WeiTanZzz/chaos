import { type Context, Hono, type MiddlewareHandler } from "hono"
import type { BlankEnv } from "hono/types"
import type { AnyCapability } from "./capability.ts"
import type { Authorize, ContextFactory, Instrument } from "./http.ts"
import { mountHttp } from "./http.ts"
import { mountMcp, type ServerInfo } from "./mcp.ts"
import { mountOpenApi } from "./openapi.ts"
import type { CapabilitiesSchema } from "./schema.ts"

export type Middleware = {
    /** Everything this app mounts: capability routes, the mcp endpoint, health and the docs. */
    all?: MiddlewareHandler[]
    /** Capability routes only — never the mcp endpoint. */
    http?: MiddlewareHandler[]
    /** The mcp endpoint only. */
    mcp?: MiddlewareHandler[]
}

export type Surfaces = {
    /** Capability routes. Off means the same build serves mcp only. */
    http?: boolean
    /** The mcp endpoint. Off means the same build serves a plain http api. */
    mcp?: boolean
    /** The generated `/openapi.json` document. */
    openapi?: boolean
}

export type AppOptions<Ctx, Caps extends readonly AnyCapability<Ctx>[], BasePath extends string> = {
    /** Built per request, so a handler can see who is calling. Close over a constant when it never varies. */
    context: ContextFactory<Ctx>
    capabilities: Caps
    info: ServerInfo
    /** Which surfaces this deployment serves. All on by default; `/health` is always mounted. */
    surfaces?: Surfaces
    middleware?: Middleware
    /** Per request, decides which capabilities this caller may see as mcp tools. */
    visibleTools?: (capability: Caps[number], c: Context) => boolean | Promise<boolean>
    /**
     * Runs before every capability on both surfaces, with whatever that capability declared in its `meta`.
     * Throw — a `CapabilityError` for a status the http surface can render — to refuse.
     */
    authorize?: Authorize<NoInfer<Ctx>, Caps[number]>
    /** Wraps every capability call on both surfaces: the place for tracing, timing or a transaction. */
    instrument?: Instrument<Caps[number]>
    /** Prefix applied to every capability route, e.g. "/api/v1". The paths below are absolute and unaffected. */
    basePath?: BasePath
    mcpPath?: string
    openapiPath?: string
}

export const createApp = <Ctx, const Caps extends readonly AnyCapability<Ctx>[], const BasePath extends string = "">({
    context,
    capabilities,
    info,
    surfaces = {},
    middleware = {},
    visibleTools,
    authorize,
    instrument,
    basePath,
    mcpPath = "/mcp",
    openapiPath = "/openapi.json"
}: AppOptions<Ctx, Caps, BasePath>) => {
    const { http = true, mcp = true, openapi = true } = surfaces
    // The routes are registered in a loop, so Hono cannot infer them. CapabilitiesSchema derives the same routes
    // from the declarations, and the app is built with that shape rather than being asserted into it afterwards.
    const app = new Hono<BlankEnv, CapabilitiesSchema<Caps, BasePath>>()
    for (const handler of middleware.all ?? []) app.use(handler)
    app.get("/health", c => c.json({ status: "ok" }))
    if (openapi) mountOpenApi(app, openapiPath, { capabilities, info, mcpPath, basePath, surfaces: { http, mcp } })
    if (mcp) mountMcp(app, { path: mcpPath, capabilities, context, info, middleware: middleware.mcp, visibleTools, authorize, instrument })
    return mountHttp(app, { capabilities, context, basePath, middleware: middleware.http, enabled: http, authorize, instrument })
}
