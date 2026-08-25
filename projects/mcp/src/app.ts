import { Hono } from "hono"
import type { capabilities } from "./capabilities/index.ts"
import type { AnyCapability } from "./core/capability.ts"
import type { Deps } from "./core/deps.ts"
import { mountHttp } from "./core/http.ts"
import { mountMcp } from "./core/mcp.ts"

export type ServerInfo = {
    name: string
    version: string
}

export type AppOptions<Caps extends readonly AnyCapability[]> = {
    deps: Deps
    capabilities: Caps
    info?: ServerInfo
}

export const createApp = <const Caps extends readonly AnyCapability[]>({
    deps,
    capabilities: caps,
    info = { name: "mcp", version: "0.0.0" }
}: AppOptions<Caps>) => {
    const app = new Hono()
    app.get("/health", c => c.json({ status: "ok" }))
    mountMcp(app, "/mcp", caps, deps, info)
    return mountHttp(app, caps, deps)
}

export type AppType = ReturnType<typeof createApp<typeof capabilities>>
