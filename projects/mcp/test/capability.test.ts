import { expect, test } from "bun:test"
import { z } from "zod"
import { createApp } from "../src/app.ts"
import { capability } from "../src/core/capability.ts"
import type { Db } from "../src/db/client.ts"

const echo = capability({
    name: "echo",
    description: "Echo a message back.",
    input: { message: z.string().min(1) },
    route: { method: "get", path: "/echo" },
    mcp: true,
    handler: async ({ message }) => ({ message })
})

const hidden = capability({
    name: "hidden",
    description: "Http only, no mcp flag set.",
    input: {},
    route: { method: "get", path: "/hidden" },
    handler: async () => ({ ok: true })
})

const app = createApp({
    deps: {
        db: () => {
            throw new Error("db not used in this test")
        }
    } as { db: () => Db },
    capabilities: [echo, hidden]
})

const rpc = async (body: unknown) => {
    const response = await app.request("/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify(body)
    })
    const text = await response.text()
    return JSON.parse(text.slice(text.indexOf("data: ") + 6))
}

test("one declaration serves the http route", async () => {
    const response = await app.request("/echo?message=hi")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ message: "hi" })
})

test("http rejects invalid input", async () => {
    const response = await app.request("/echo?message=")
    expect(response.status).toBe(400)
})

test("only capabilities with mcp: true become tools", async () => {
    expect((await app.request("/hidden")).status).toBe(200)

    const listed = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    expect(listed.result.tools.map((tool: { name: string }) => tool.name)).toEqual(["echo"])

    const called = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "echo", arguments: { message: "hi" } } })
    expect(called.result.content[0].text).toBe(JSON.stringify({ message: "hi" }))
})
