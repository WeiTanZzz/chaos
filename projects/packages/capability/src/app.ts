import { Hono, type MiddlewareHandler } from "hono"
import type { AnyCapability } from "./capability.ts"
import { mountHttp } from "./http.ts"
import { mountMcp, type ServerInfo } from "./mcp.ts"
import { mountOpenApi } from "./openapi.ts"

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
    context: Ctx
    capabilities: Caps
    info: ServerInfo
    /** Which surfaces this deployment serves. All on by default; `/health` is always mounted. */
    surfaces?: Surfaces
    middleware?: Middleware
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
    basePath,
    mcpPath = "/mcp",
    openapiPath = "/openapi.json"
}: AppOptions<Ctx, Caps, BasePath>) => {
    const { http = true, mcp = true, openapi = true } = surfaces
    const app = new Hono()
    for (const handler of middleware.all ?? []) app.use(handler)
    app.get("/health", c => c.json({ status: "ok" }))
    if (openapi) mountOpenApi(app, openapiPath, { capabilities, info, mcpPath, basePath, surfaces: { http, mcp } })
    if (mcp) mountMcp(app, { path: mcpPath, capabilities, context, info, middleware: middleware.mcp })
    return mountHttp(app, { capabilities, context, basePath, middleware: middleware.http, enabled: http })
}
