import { StreamableHTTPTransport } from "@hono/mcp"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { Context, Hono, MiddlewareHandler } from "hono"
import { every } from "hono/combine"
import type { AnyCapability } from "./capability.ts"
import type { ContextFactory } from "./http.ts"

export type ServerInfo = {
    name: string
    version: string
}

export const createMcpServer = <Ctx>(capabilities: readonly AnyCapability<Ctx>[], ctx: Ctx, info: ServerInfo) => {
    const server = new McpServer(info)
    for (const cap of capabilities.filter(cap => cap.mcp)) {
        server.registerTool(cap.name, { title: cap.title, description: cap.description, inputSchema: cap.input }, async args => {
            const result = await cap.run(args, ctx)
            return { content: [{ type: "text", text: JSON.stringify(result) }] }
        })
    }
    return server
}

export type McpOptions<Ctx> = {
    path: string
    capabilities: readonly AnyCapability<Ctx>[]
    context: ContextFactory<Ctx>
    info: ServerInfo
    /** Runs before the mcp endpoint only. */
    middleware?: MiddlewareHandler[]
    /**
     * Decides per request which capabilities this caller may see. An excluded capability is absent from
     * `tools/list` and unknown to `tools/call`. The package asks the question; the app answers it.
     */
    visibleTools?: (capability: AnyCapability<Ctx>, c: Context) => boolean | Promise<boolean>
}

export const mountMcp = <Ctx>(app: Hono, { path, capabilities, context, info, middleware = [], visibleTools }: McpOptions<Ctx>) => {
    const handler = async (c: Context) => {
        const visible =
            visibleTools === undefined
                ? capabilities
                : (await Promise.all(capabilities.map(async cap => ((await visibleTools(cap, c)) ? cap : undefined)))).filter(cap => cap !== undefined)
        const server = createMcpServer(visible, context(c), info)
        const transport = new StreamableHTTPTransport()
        await server.connect(transport)
        return (await transport.handleRequest(c)) ?? c.body(null, 204)
    }
    if (middleware.length === 0) app.all(path, handler)
    else app.all(path, every(...middleware), handler)
    return app
}
