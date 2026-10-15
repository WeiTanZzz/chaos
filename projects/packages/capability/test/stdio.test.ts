import { afterEach, expect, test } from "bun:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"

const server = new URL("./stdio-server.ts", import.meta.url).pathname
let client: Client | undefined

const connect = async (env: Record<string, string> = {}) => {
    client = new Client({ name: "test-client", version: "0.0.0" })
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [server], env: { ...env, PATH: process.env.PATH ?? "" } }))
    return client
}

afterEach(async () => {
    await client?.close()
    client = undefined
})

test("serves only the mcp capabilities over stdio, route or not", async () => {
    const { tools } = await (await connect()).listTools()
    expect(tools.map(tool => tool.name).sort()).toEqual(["echo", "tool_only"])
})

test("a tool call runs the capability with the context built once at startup", async () => {
    const connected = await connect()
    const echoed = await connected.callTool({ name: "echo", arguments: { message: "there" } })
    expect(echoed.content).toEqual([{ type: "text", text: JSON.stringify({ message: "hi there" }) }])

    const doubled = await connected.callTool({ name: "tool_only", arguments: { value: 2 } })
    expect(doubled.content).toEqual([{ type: "text", text: JSON.stringify({ doubled: 4 }) }])
})

test("authorize refuses a call before it runs", async () => {
    const refused = await (await connect({ DENY: "1" })).callTool({ name: "tool_only", arguments: { value: 2 } })
    expect(refused.isError).toBe(true)
    expect(JSON.stringify(refused.content)).toContain("denied")
})
