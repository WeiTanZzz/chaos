import { Hono, type MiddlewareHandler } from "hono"
import type { AnyCapability } from "./capability.ts"
import { mountDocs } from "./docs.ts"
import { mountHttp } from "./http.ts"
import { mountMcp, type ServerInfo } from "./mcp.ts"

export type Middleware = {
    /** Everything this app mounts: capability routes, the mcp endpoint, health and the docs. */
    all?: MiddlewareHandler[]
    /** Capability routes only — never the mcp endpoint. */
    http?: MiddlewareHandler[]
    /** The mcp endpoint only. */
    mcp?: MiddlewareHandler[]
}

export type AppOptions<Ctx, Caps extends readonly AnyCapability<Ctx>[], BasePath extends string> = {
    context: Ctx
    capabilities: Caps
    info: ServerInfo
    middleware?: Middleware
    /** Prefix applied to every capability route, e.g. "/api/v1". The paths below are absolute and unaffected. */
    basePath?: BasePath
    mcpPath?: string
    openapiPath?: string
    docsPath?: string
}

export const createApp = <Ctx, const Caps extends readonly AnyCapability<Ctx>[], const BasePath extends string = "">({
    context,
    capabilities,
    info,
    middleware = {},
    basePath,
    mcpPath = "/mcp",
    openapiPath = "/openapi.json",
    docsPath = "/docs"
}: AppOptions<Ctx, Caps, BasePath>) => {
    const app = new Hono()
    for (const handler of middleware.all ?? []) app.use(handler)
    app.get("/health", c => c.json({ status: "ok" }))
    mountDocs(app, { capabilities, info, mcpPath, openapiPath, docsPath, basePath })
    mountMcp(app, { path: mcpPath, capabilities, context, info, middleware: middleware.mcp })
    return mountHttp(app, { capabilities, context, basePath, middleware: middleware.http })
}
