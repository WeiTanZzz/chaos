import { expect, test } from "bun:test"
import { hc, type InferRequestType, type InferResponseType } from "hono/client"
import { z } from "zod"
import { type AppType, createApp } from "../src/app.ts"
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

const capabilities = [echo, hidden]

const app = createApp({
    deps: {
        db: () => {
            throw new Error("db not used in this test")
        }
    } as { db: () => Db },
    capabilities
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

test("the rpc client is typed from the same declarations", async () => {
    const client = hc<typeof app>("http://test", { fetch: app.request })

    const response = await client.echo.$get({ query: { message: "hi" } })
    expect(await response.json()).toEqual({ message: "hi" })

    type Request = InferRequestType<typeof client.echo.$get>
    type Response = InferResponseType<typeof client.echo.$get>
    const request: Request = { query: { message: "hi" } }
    const echoed: Response = { message: "hi" }
    expect([request, echoed]).toBeDefined()
})

test("dates are typed as strings on the wire", () => {
    type Items = InferResponseType<ReturnType<typeof hc<AppType>>["items"]["$get"]>
    const items: Items = [{ id: "id", name: "name", createdAt: "2026-08-25T00:00:00.000Z" }]
    expect(items).toHaveLength(1)
})
