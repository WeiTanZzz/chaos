import { expect, test } from "bun:test"
import type { Context } from "hono"
import { z } from "zod"
import { CapabilityError, createApp, createCapability, createScopedCapability } from "../src/index.ts"
import { rpc } from "./fixtures.ts"

type Ctx = { tenant: string }

const capability = createCapability<Ctx>()
const context = (c: Context) => ({ tenant: c.req.header("x-tenant") ?? "public" })
const info = { name: "test", version: "0.0.0" }

test("instrument wraps every call on both surfaces", async () => {
    const seen: string[] = []
    const ping = capability({
        name: "ping",
        description: "ping",
        input: {},
        route: { method: "get", path: "/ping" },
        mcp: true,
        handler: async () => ({ ok: true })
    })

    const app = createApp({
        context,
        capabilities: [ping],
        info,
        instrument: async (call, run) => {
            seen.push(`${call.surface}:${call.capability.name}:start`)
            const result = await run()
            seen.push(`${call.surface}:${call.capability.name}:end`)
            return result
        }
    })

    await app.request("/ping")
    await rpc(app, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "ping", arguments: {} } })
    await app.request("/health")

    // /health is not a capability, so it is not instrumented.
    expect(seen).toEqual(["http:ping:start", "http:ping:end", "mcp:ping:start", "mcp:ping:end"])
})

test("instrument sees a refusal and can still let it through", async () => {
    const outcomes: string[] = []
    const refuses = capability({
        name: "refuses",
        description: "always refuses",
        input: {},
        route: { method: "get", path: "/refuses" },
        handler: async () => {
            throw new CapabilityError(402, "payment required")
        }
    })

    const app = createApp({
        context,
        capabilities: [refuses],
        info,
        instrument: async (_call, run) => {
            try {
                return await run()
            } catch (error) {
                outcomes.push(error instanceof CapabilityError ? `refused ${error.status}` : "failed")
                throw error
            }
        }
    })

    expect((await app.request("/refuses")).status).toBe(402)
    expect(outcomes).toEqual(["refused 402"])
})

test("a declared output is checked, not trusted", async () => {
    const lies = capability({
        name: "lies",
        description: "returns something its schema does not describe",
        input: {},
        output: z.object({ count: z.number() }),
        route: { method: "get", path: "/lies" },
        // The handler is typed, so the only way to break the contract is to lose the type — as a database row or
        // an upstream response easily does.
        handler: async () => JSON.parse('{"count":"not a number"}')
    })

    const app = createApp({ context, capabilities: [lies], info })

    // A broken contract is the service's fault, so it is not a 4xx.
    expect((await app.request("/lies")).status).toBe(500)
})

test("an output schema also strips fields it does not mention", async () => {
    const chatty = capability({
        name: "chatty",
        description: "returns more than it declares",
        input: {},
        output: z.object({ public: z.string() }),
        route: { method: "get", path: "/chatty" },
        handler: async () => JSON.parse('{"public":"fine","secret":"leaked"}')
    })

    const app = createApp({ context, capabilities: [chatty], info })

    expect(await (await app.request("/chatty")).json()).toEqual({ public: "fine" })
})

test("a scope resolves per call and hands its result to the handler", async () => {
    const tenants: Record<string, { plan: string } | undefined> = { acme: { plan: "pro" } }

    const tenantCapability = createScopedCapability<Ctx, never, { plan: string }>(({ context: ctx }) => {
        const tenant = tenants[ctx.tenant]
        if (tenant === undefined) throw new CapabilityError(404, "no such tenant", { tenant: ctx.tenant })
        return { plan: tenant.plan }
    })

    const whichPlan = tenantCapability({
        name: "which_plan",
        description: "reports the plan the scope resolved",
        input: {},
        route: { method: "get", path: "/plan" },
        mcp: true,
        handler: async (_input, { tenant, plan }) => ({ tenant, plan })
    })

    const app = createApp({ context, capabilities: [whichPlan], info })

    expect(await (await app.request("/plan", { headers: { "x-tenant": "acme" } })).json()).toEqual({ tenant: "acme", plan: "pro" })
    expect((await app.request("/plan")).status).toBe(404)

    const called = await rpc(app, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "which_plan", arguments: {} } }, { "x-tenant": "acme" })
    expect(called.result.content[0].text).toBe(JSON.stringify({ tenant: "acme", plan: "pro" }))
})

test("a scope reads the validated input, so it runs after validation", async () => {
    const order: string[] = []

    const scoped = createScopedCapability<Ctx, never, { doubled: number }>(({ input }) => {
        order.push("scope")
        const { value } = z.object({ value: z.number() }).parse(input)
        return { doubled: value * 2 }
    })

    const doubler = scoped({
        name: "doubler",
        description: "doubles in the scope",
        input: { value: z.coerce.number().int() },
        route: { method: "get", path: "/double" },
        handler: async (_input, { doubled }) => ({ doubled })
    })

    const app = createApp({
        context,
        capabilities: [doubler],
        info,
        authorize: () => {
            order.push("authorize")
        }
    })

    expect(await (await app.request("/double?value=21")).json()).toEqual({ doubled: 42 })
    expect(order).toEqual(["authorize", "scope"])

    // Invalid input never reaches the scope.
    order.length = 0
    expect((await app.request("/double?value=abc")).status).toBe(400)
    expect(order).toEqual(["authorize"])
})
