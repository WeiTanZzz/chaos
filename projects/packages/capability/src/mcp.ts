import { StreamableHTTPTransport } from "@hono/mcp"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { Context, Hono, MiddlewareHandler } from "hono"
import { every } from "hono/combine"
import type { AnyCapability } from "./capability.ts"

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
    context: Ctx
    info: ServerInfo
    /** Runs before the mcp endpoint only. */
    middleware?: MiddlewareHandler[]
}

export const mountMcp = <Ctx>(app: Hono, { path, capabilities, context, info, middleware = [] }: McpOptions<Ctx>) => {
    const handler = async (c: Context) => {
        const server = createMcpServer(capabilities, context, info)
        const transport = new StreamableHTTPTransport()
        await server.connect(transport)
        return (await transport.handleRequest(c)) ?? c.body(null, 204)
    }
    if (middleware.length === 0) app.all(path, handler)
    else app.all(path, every(...middleware), handler)
    return app
}
