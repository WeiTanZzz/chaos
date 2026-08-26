import { expect, test } from "bun:test"
import type { Context } from "hono"
import { CapabilityError, createApp, createCapability } from "../src/index.ts"
import { rpc, toolNames } from "./fixtures.ts"

// The package supplies the mechanism — a per-request context, a visibility question and an error that carries a
// status. Roles, tokens and rules are the app's business; none of them appear in the package.
type Caller = { role: string }

const capability = createCapability<Caller>()

const whoAmI = capability({
    name: "who_am_i",
    description: "Reports the caller the context was built with.",
    input: {},
    route: { method: "get", path: "/me" },
    mcp: true,
    handler: async (_input, caller) => ({ role: caller.role })
})

const adminOnly = capability({
    name: "admin_only",
    description: "Refuses anyone but an admin.",
    input: {},
    route: { method: "get", path: "/admin" },
    mcp: true,
    handler: async (_input, caller) => {
        if (caller.role !== "admin") throw new CapabilityError(403, "forbidden", { needs: "admin" })
        return { ok: true }
    }
})

const app = createApp({
    context: (c: Context) => ({ role: c.req.header("x-role") ?? "anonymous" }),
    capabilities: [whoAmI, adminOnly],
    info: { name: "test", version: "0.0.0" },
    visibleTools: (capability, c) => capability.name !== "admin_only" || c.req.header("x-role") === "admin"
})

const as = (role: string) => ({ "x-role": role })

test("the context is built per request", async () => {
    expect(await (await app.request("/me", { headers: as("admin") })).json()).toEqual({ role: "admin" })
    expect(await (await app.request("/me")).json()).toEqual({ role: "anonymous" })

    const called = await rpc(app, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "who_am_i", arguments: {} } }, as("viewer"))
    expect(called.result.content[0].text).toBe(JSON.stringify({ role: "viewer" }))
})

test("a thrown CapabilityError picks the http status", async () => {
    const denied = await app.request("/admin", { headers: as("viewer") })
    expect(denied.status).toBe(403)
    expect(await denied.json()).toEqual({ error: "forbidden", details: { needs: "admin" } })

    expect((await app.request("/admin", { headers: as("admin") })).status).toBe(200)
})

test("visibleTools decides what a caller can see and call", async () => {
    expect(toolNames(await rpc(app, { jsonrpc: "2.0", id: 2, method: "tools/list" }, as("admin")))).toEqual(["who_am_i", "admin_only"])
    expect(toolNames(await rpc(app, { jsonrpc: "2.0", id: 3, method: "tools/list" }, as("viewer")))).toEqual(["who_am_i"])

    // A hidden tool is not merely refused, it does not exist for this caller.
    const called = await rpc(app, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "admin_only", arguments: {} } }, as("viewer"))
    expect(called.result?.ok).toBeUndefined()
    expect(JSON.stringify(called)).toContain("admin_only")
})
