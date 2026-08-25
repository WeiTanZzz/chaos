import { Hono } from "hono"
import type { AnyCapability } from "./capability.ts"
import { mountHttp } from "./http.ts"
import { mountMcp, type ServerInfo } from "./mcp.ts"

export type AppOptions<Ctx, Caps extends readonly AnyCapability<Ctx>[]> = {
    context: Ctx
    capabilities: Caps
    info: ServerInfo
    mcpPath?: string
}

export const createApp = <Ctx, const Caps extends readonly AnyCapability<Ctx>[]>({ context, capabilities, info, mcpPath = "/mcp" }: AppOptions<Ctx, Caps>) => {
    const app = new Hono()
    app.get("/health", c => c.json({ status: "ok" }))
    mountMcp(app, mcpPath, capabilities, context, info)
    return mountHttp(app, capabilities, context)
}
