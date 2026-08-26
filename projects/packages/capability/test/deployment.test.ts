import { expect, test } from "bun:test"
import { hc } from "hono/client"
import { z } from "zod"
import { createApp } from "../src/index.ts"
import { context, echo, info, rpc, toolOnly } from "./fixtures.ts"

test("basePath prefixes every capability route", async () => {
    const app = createApp({ context, capabilities: [echo], info, basePath: "/api/v1" })

    expect((await app.request("/api/v1/echo?message=there")).status).toBe(200)
    expect((await app.request("/echo?message=there")).status).toBe(404)
    expect((await app.request("/health")).status).toBe(200)

    const client = hc<typeof app>("http://test", { fetch: app.request })
    const response = await client.api.v1.echo.$get({ query: { message: "there" } })
    expect(await response.json()).toEqual({ message: "hi there" })

    const document = z.object({ paths: z.record(z.string(), z.unknown()) }).parse(await (await app.request("/openapi.json")).json())
    expect(Object.keys(document.paths)).toContain("/api/v1/echo")
})

test("surfaces decide what a deployment mounts", async () => {
    const httpOnly = createApp({ context, capabilities: [echo, toolOnly], info, surfaces: { mcp: false } })

    expect((await httpOnly.request("/echo?message=there")).status).toBe(200)
    expect((await httpOnly.request("/mcp", { method: "POST" })).status).toBe(404)
    expect((await httpOnly.request("/health")).status).toBe(200)

    const document = z.object({ paths: z.record(z.string(), z.unknown()) }).parse(await (await httpOnly.request("/openapi.json")).json())
    expect(document).not.toHaveProperty("x-mcp")

    const mcpOnly = createApp({ context, capabilities: [echo, toolOnly], info, surfaces: { http: false } })

    expect((await mcpOnly.request("/echo?message=there")).status).toBe(404)
    expect((await mcpOnly.request("/health")).status).toBe(200)
    expect((await rpc(mcpOnly, { jsonrpc: "2.0", id: 1, method: "tools/list" })).result.tools).toHaveLength(2)

    const noSchema = createApp({ context, capabilities: [echo], info, surfaces: { openapi: false } })

    expect((await noSchema.request("/openapi.json")).status).toBe(404)
    expect((await noSchema.request("/echo?message=there")).status).toBe(200)
})
