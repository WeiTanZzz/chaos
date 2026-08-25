import { expect, test } from "bun:test"
import { hc, type InferRequestType, type InferResponseType } from "hono/client"
import { z } from "zod"
import { createApp, createCapability } from "../src/index.ts"

type Ctx = { greeting: string }

const capability = createCapability<Ctx>()

const echo = capability({
    name: "echo",
    description: "Echo a message back.",
    input: { message: z.string().min(1) },
    route: { method: "get", path: "/echo" },
    mcp: true,
    handler: async ({ message }, { greeting }) => ({ message: `${greeting} ${message}` })
})

const hidden = capability({
    name: "hidden",
    description: "Http only, no mcp flag set.",
    input: {},
    route: { method: "get", path: "/hidden" },
    handler: async () => ({ ok: true })
})

const toolOnly = capability({
    name: "tool_only",
    description: "Reachable as an mcp tool, with no http route.",
    input: { value: z.number() },
    mcp: true,
    handler: async ({ value }) => ({ doubled: value * 2 })
})

const app = createApp({
    context: { greeting: "hi" },
    capabilities: [echo, hidden, toolOnly],
    info: { name: "test", version: "0.0.0" }
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
    const response = await app.request("/echo?message=there")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ message: "hi there" })
})

test("http rejects invalid input", async () => {
    const response = await app.request("/echo?message=")
    expect(response.status).toBe(400)
})

test("the same declaration is exposed as an mcp tool", async () => {
    const called = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "echo", arguments: { message: "there" } } })
    expect(called.result.content[0].text).toBe(JSON.stringify({ message: "hi there" }))
})

test("only capabilities with mcp: true become tools", async () => {
    expect((await app.request("/hidden")).status).toBe(200)

    const listed = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" })
    expect(listed.result.tools.map((tool: { name: string }) => tool.name)).toEqual(["echo", "tool_only"])
})

test("a capability can be an mcp tool with no http surface", async () => {
    const called = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "tool_only", arguments: { value: 21 } } })
    expect(called.result.content[0].text).toBe(JSON.stringify({ doubled: 42 }))

    expect((await app.request("/tool_only")).status).toBe(404)
})

test("the rpc client is typed from the same declarations", async () => {
    const client = hc<typeof app>("http://test", { fetch: app.request })

    const response = await client.echo.$get({ query: { message: "there" } })
    expect(await response.json()).toEqual({ message: "hi there" })

    type Request = InferRequestType<typeof client.echo.$get>
    type Response = InferResponseType<typeof client.echo.$get>
    const request: Request = { query: { message: "there" } }
    const echoed: Response = { message: "hi there" }
    expect([request, echoed]).toBeDefined()
})

test("basePath prefixes every capability route", async () => {
    const prefixed = createApp({
        context: { greeting: "hi" },
        capabilities: [echo],
        info: { name: "test", version: "0.0.0" },
        basePath: "/api/v1"
    })

    expect((await prefixed.request("/api/v1/echo?message=there")).status).toBe(200)
    expect((await prefixed.request("/echo?message=there")).status).toBe(404)
    expect((await prefixed.request("/health")).status).toBe(200)

    const client = hc<typeof prefixed>("http://test", { fetch: prefixed.request })
    const response = await client.api.v1.echo.$get({ query: { message: "there" } })
    expect(await response.json()).toEqual({ message: "hi there" })

    const document = z.object({ paths: z.record(z.string(), z.unknown()) }).parse(await (await prefixed.request("/openapi.json")).json())
    expect(Object.keys(document.paths)).toContain("/api/v1/echo")
})

test("app middleware wraps every surface, route middleware only its own route", async () => {
    const stamped = createApp({
        context: { greeting: "hi" },
        capabilities: [
            capability({
                name: "guarded",
                description: "Route middleware can reject before the handler runs.",
                input: {},
                route: {
                    method: "get",
                    path: "/guarded",
                    middleware: [async (c, next) => (c.req.header("x-key") === "secret" ? await next() : c.json({ error: "unauthorized" }, 401))]
                },
                mcp: true,
                handler: async () => ({ ok: true })
            }),
            echo
        ],
        info: { name: "test", version: "0.0.0" }
    })

    expect((await stamped.request("/guarded")).status).toBe(401)
    expect((await stamped.request("/guarded", { headers: { "x-key": "secret" } })).status).toBe(200)
    expect((await stamped.request("/echo?message=there")).status).toBe(200)
})

test("middleware.all also covers the mcp endpoint", async () => {
    const seen: string[] = []
    const traced = createApp({
        context: { greeting: "hi" },
        capabilities: [echo],
        info: { name: "test", version: "0.0.0" },
        middleware: {
            all: [
                async (c, next) => {
                    seen.push(c.req.path)
                    await next()
                }
            ]
        }
    })

    await traced.request("/echo?message=there")
    await traced.request("/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    })
    await traced.request("/health")

    expect(seen).toEqual(["/echo", "/mcp", "/health"])
})

test("each surface can carry its own middleware", async () => {
    const surfaced = createApp({
        context: { greeting: "hi" },
        capabilities: [echo],
        info: { name: "test", version: "0.0.0" },
        middleware: {
            http: [async (c, next) => (c.req.header("x-api-key") === "http-key" ? await next() : c.json({ error: "unauthorized" }, 401))],
            mcp: [async (c, next) => (c.req.header("authorization") === "Bearer mcp-token" ? await next() : c.json({ error: "unauthorized" }, 401))]
        }
    })

    const callMcp = (headers: Record<string, string>) =>
        surfaced.request("/mcp", {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
        })

    // The http key opens the route and does nothing for mcp; the mcp token is the other way around.
    expect((await surfaced.request("/echo?message=there", { headers: { "x-api-key": "http-key" } })).status).toBe(200)
    expect((await surfaced.request("/echo?message=there", { headers: { authorization: "Bearer mcp-token" } })).status).toBe(401)
    expect((await callMcp({ authorization: "Bearer mcp-token" })).status).toBe(200)
    expect((await callMcp({ "x-api-key": "http-key" })).status).toBe(401)

    // Neither guard touches health or the docs.
    expect((await surfaced.request("/health")).status).toBe(200)
    expect((await surfaced.request("/openapi.json")).status).toBe(200)
})

test("surfaces decide what a deployment mounts", async () => {
    const httpOnly = createApp({
        context: { greeting: "hi" },
        capabilities: [echo, toolOnly],
        info: { name: "test", version: "0.0.0" },
        surfaces: { mcp: false }
    })

    expect((await httpOnly.request("/echo?message=there")).status).toBe(200)
    expect((await httpOnly.request("/mcp", { method: "POST" })).status).toBe(404)
    expect((await httpOnly.request("/health")).status).toBe(200)

    const document = z.object({ paths: z.record(z.string(), z.unknown()) }).parse(await (await httpOnly.request("/openapi.json")).json())
    expect(document).not.toHaveProperty("x-mcp")

    const mcpOnly = createApp({
        context: { greeting: "hi" },
        capabilities: [echo, toolOnly],
        info: { name: "test", version: "0.0.0" },
        surfaces: { http: false }
    })

    expect((await mcpOnly.request("/echo?message=there")).status).toBe(404)
    expect((await mcpOnly.request("/health")).status).toBe(200)

    const listed = await mcpOnly.request("/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    })
    expect(listed.status).toBe(200)

    const noSchema = createApp({
        context: { greeting: "hi" },
        capabilities: [echo],
        info: { name: "test", version: "0.0.0" },
        surfaces: { openapi: false }
    })

    expect((await noSchema.request("/openapi.json")).status).toBe(404)
    expect((await noSchema.request("/echo?message=there")).status).toBe(200)
})
