import { StreamableHTTPTransport } from "@hono/mcp"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { Hono } from "hono"
import type { Capability } from "./capability.ts"
import type { Deps } from "./deps.ts"

export const createMcpServer = (capabilities: readonly Capability[], deps: Deps, info: { name: string; version: string }) => {
    const server = new McpServer(info)
    for (const cap of capabilities.filter(cap => cap.mcp)) {
        server.registerTool(cap.name, { title: cap.title, description: cap.description, inputSchema: cap.input }, async args => {
            const result = await cap.run(args, deps)
            return { content: [{ type: "text", text: JSON.stringify(result) }] }
        })
    }
    return server
}

export const mountMcp = (app: Hono, path: string, capabilities: readonly Capability[], deps: Deps, info: { name: string; version: string }) => {
    app.all(path, async c => {
        const server = createMcpServer(capabilities, deps, info)
        const transport = new StreamableHTTPTransport()
        await server.connect(transport)
        return (await transport.handleRequest(c)) ?? c.body(null, 204)
    })
    return app
}
