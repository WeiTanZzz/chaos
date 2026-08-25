import { StreamableHTTPTransport } from "@hono/mcp"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { Hono } from "hono"
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

export const mountMcp = <Ctx>(app: Hono, path: string, capabilities: readonly AnyCapability<Ctx>[], ctx: Ctx, info: ServerInfo) => {
    app.all(path, async c => {
        const server = createMcpServer(capabilities, ctx, info)
        const transport = new StreamableHTTPTransport()
        await server.connect(transport)
        return (await transport.handleRequest(c)) ?? c.body(null, 204)
    })
    return app
}
