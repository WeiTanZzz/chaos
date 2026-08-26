import { expect, test } from "bun:test"
import type { Context } from "hono"
import { CapabilityError, createApp, createCapability } from "../src/index.ts"
import { rpc, toolNames } from "./fixtures.ts"

// `meta` is opaque to the package: it hands whatever was declared to `authorize`, which is the app's to write.
type Meta = { minimum: number }
type Caller = { clearance: number }

const capability = createCapability<Caller, Meta>()

const open = capability({
    name: "open",
    description: "No clearance required.",
    input: {},
    route: { method: "get", path: "/open" },
    mcp: true,
    handler: async () => ({ ok: true })
})

const restricted = capability({
    name: "restricted",
    meta: { minimum: 5 },
    description: "Needs clearance 5.",
    input: {},
    route: { method: "get", path: "/restricted" },
    mcp: true,
    handler: async () => ({ ok: true })
})

const app = createApp({
    context: (c: Context) => ({ clearance: Number(c.req.header("x-clearance") ?? 0) }),
    capabilities: [open, restricted],
    info: { name: "test", version: "0.0.0" },
    authorize: (capability, { clearance }) => {
        const minimum = capability.meta?.minimum ?? 0
        if (clearance < minimum) throw new CapabilityError(403, "insufficient clearance", { minimum, clearance })
    }
})

const at = (clearance: number) => ({ "x-clearance": String(clearance) })

test("authorize runs for every capability, off what it declared", async () => {
    expect((await app.request("/open")).status).toBe(200)
    expect((await app.request("/restricted")).status).toBe(403)
    expect(await (await app.request("/restricted")).json()).toEqual({ error: "insufficient clearance", details: { minimum: 5, clearance: 0 } })
    expect((await app.request("/restricted", { headers: at(5) })).status).toBe(200)
})

test("the same declaration governs the mcp surface", async () => {
    const refused = await rpc(app, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "restricted", arguments: {} } }, at(0))
    expect(refused.result.isError).toBe(true)
    expect(refused.result.content[0].text).toContain("insufficient clearance")

    const allowed = await rpc(app, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "restricted", arguments: {} } }, at(5))
    expect(allowed.result.content[0].text).toBe(JSON.stringify({ ok: true }))

    // Nothing was hidden here — visibleTools is the separate decision.
    expect(toolNames(await rpc(app, { jsonrpc: "2.0", id: 3, method: "tools/list" }, at(0)))).toEqual(["open", "restricted"])
})

test("authorize refuses before the input is validated", async () => {
    const badInputAndNoClearance = await app.request("/restricted?nonsense=1")
    expect(badInputAndNoClearance.status).toBe(403)
})
