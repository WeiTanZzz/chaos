import { Hono } from "hono"
import type { AnyCapability } from "./capability.ts"
import { mountDocs } from "./docs.ts"
import { mountHttp } from "./http.ts"
import { mountMcp, type ServerInfo } from "./mcp.ts"

export type AppOptions<Ctx, Caps extends readonly AnyCapability<Ctx>[]> = {
    context: Ctx
    capabilities: Caps
    info: ServerInfo
    mcpPath?: string
    openapiPath?: string
    docsPath?: string
}

export const createApp = <Ctx, const Caps extends readonly AnyCapability<Ctx>[]>({
    context,
    capabilities,
    info,
    mcpPath = "/mcp",
    openapiPath = "/openapi.json",
    docsPath = "/docs"
}: AppOptions<Ctx, Caps>) => {
    const app = new Hono()
    app.get("/health", c => c.json({ status: "ok" }))
    mountDocs(app, { capabilities, info, mcpPath, openapiPath, docsPath })
    mountMcp(app, mcpPath, capabilities, context, info)
    return mountHttp(app, capabilities, context)
}
