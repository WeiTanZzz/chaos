import { Hono } from "hono"
import type { AnyCapability } from "./capability.ts"
import { mountDocs } from "./docs.ts"
import { mountHttp } from "./http.ts"
import { mountMcp, type ServerInfo } from "./mcp.ts"

export type AppOptions<Ctx, Caps extends readonly AnyCapability<Ctx>[], BasePath extends string> = {
    context: Ctx
    capabilities: Caps
    info: ServerInfo
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
    basePath,
    mcpPath = "/mcp",
    openapiPath = "/openapi.json",
    docsPath = "/docs"
}: AppOptions<Ctx, Caps, BasePath>) => {
    const app = new Hono()
    app.get("/health", c => c.json({ status: "ok" }))
    mountDocs(app, { capabilities, info, mcpPath, openapiPath, docsPath, basePath })
    mountMcp(app, mcpPath, capabilities, context, info)
    return mountHttp(app, capabilities, context, basePath)
}
