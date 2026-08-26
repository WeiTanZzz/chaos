import { expect, test } from "bun:test"
import { createApp } from "../src/index.ts"
import { capability, context, echo, info, rpc, toolNames } from "./fixtures.ts"

const guarded = capability({
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
})

test("route middleware guards its own route only", async () => {
    const app = createApp({ context, capabilities: [guarded, echo], info })

    expect((await app.request("/guarded")).status).toBe(401)
    expect((await app.request("/guarded", { headers: { "x-key": "secret" } })).status).toBe(200)
    expect((await app.request("/echo?message=there")).status).toBe(200)
})

test("middleware.all also covers the mcp endpoint", async () => {
    const seen: string[] = []
    const app = createApp({
        context,
        capabilities: [echo],
        info,
        middleware: {
            all: [
                async (c, next) => {
                    seen.push(c.req.path)
                    await next()
                }
            ]
        }
    })

    await app.request("/echo?message=there")
    await rpc(app, { jsonrpc: "2.0", id: 1, method: "tools/list" })
    await app.request("/health")

    expect(seen).toEqual(["/echo", "/mcp", "/health"])
})

test("each surface can carry its own middleware", async () => {
    const app = createApp({
        context,
        capabilities: [echo],
        info,
        middleware: {
            http: [async (c, next) => (c.req.header("x-api-key") === "http-key" ? await next() : c.json({ error: "unauthorized" }, 401))],
            mcp: [async (c, next) => (c.req.header("authorization") === "Bearer mcp-token" ? await next() : c.json({ error: "unauthorized" }, 401))]
        }
    })

    // The http key opens the route and does nothing for mcp; the mcp token is the other way around.
    expect((await app.request("/echo?message=there", { headers: { "x-api-key": "http-key" } })).status).toBe(200)
    expect((await app.request("/echo?message=there", { headers: { authorization: "Bearer mcp-token" } })).status).toBe(401)
    expect(toolNames(await rpc(app, { jsonrpc: "2.0", id: 1, method: "tools/list" }, { authorization: "Bearer mcp-token" }))).toEqual(["echo"])

    const refused = await app.request("/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "x-api-key": "http-key" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })
    })
    expect(refused.status).toBe(401)

    // Neither guard touches health.
    expect((await app.request("/health")).status).toBe(200)
})
