import { expect, test } from "bun:test"
import { createApp } from "../src/index.ts"
import { context, echo, hidden, info, rpc, toolNames, toolOnly } from "./fixtures.ts"

const app = createApp({ context, capabilities: [echo, hidden, toolOnly], info })

test("one declaration serves the http route", async () => {
    const response = await app.request("/echo?message=there")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ message: "hi there" })
})

test("http rejects invalid input", async () => {
    const response = await app.request("/echo?message=")
    expect(response.status).toBe(400)
})

test("the same declaration is exposed as an mcp tool", async () => {
    const called = await rpc(app, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "echo", arguments: { message: "there" } } })
    expect(called.result.content[0].text).toBe(JSON.stringify({ message: "hi there" }))
})

test("only capabilities with mcp: true become tools", async () => {
    expect((await app.request("/hidden")).status).toBe(200)
    expect(toolNames(await rpc(app, { jsonrpc: "2.0", id: 2, method: "tools/list" }))).toEqual(["echo", "tool_only"])
})

test("a capability can be an mcp tool with no http surface", async () => {
    const called = await rpc(app, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "tool_only", arguments: { value: 21 } } })
    expect(called.result.content[0].text).toBe(JSON.stringify({ doubled: 42 }))

    expect((await app.request("/tool_only")).status).toBe(404)
})
