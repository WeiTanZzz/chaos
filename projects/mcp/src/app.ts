import { Hono } from "hono"
import { capabilities } from "./capabilities/index.ts"
import type { Capability } from "./core/capability.ts"
import type { Deps } from "./core/deps.ts"
import { mountHttp } from "./core/http.ts"
import { mountMcp } from "./core/mcp.ts"

export type AppOptions = {
    deps: Deps
    capabilities?: readonly Capability[]
    info?: { name: string; version: string }
}

export const createApp = ({ deps, capabilities: caps = capabilities, info = { name: "mcp", version: "0.0.0" } }: AppOptions) => {
    const app = new Hono()
    app.get("/health", c => c.json({ status: "ok" }))
    mountHttp(app, caps, deps)
    mountMcp(app, "/mcp", caps, deps, info)
    return app
}
