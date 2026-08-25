import type { Context, Hono } from "hono"
import type { BlankEnv } from "hono/types"
import { type AnyCapability, InputError } from "./capability.ts"
import type { CapabilitiesSchema } from "./schema.ts"

const readInput = async (c: Context, method: string) => {
    const params = c.req.param()
    if (method === "get" || method === "delete") return { ...c.req.query(), ...params }
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}))
    return { ...body, ...params }
}

const trimSlash = (path: string) => (path.endsWith("/") ? path.slice(0, -1) : path)

export const mountHttp = <Ctx, Caps extends readonly AnyCapability<Ctx>[], Prefix extends string = "">(
    app: Hono,
    capabilities: Caps,
    ctx: Ctx,
    basePath?: Prefix
) => {
    const prefix = trimSlash(basePath ?? "")
    for (const cap of capabilities) {
        const route = cap.route
        if (route === undefined) continue
        app[route.method](`${prefix}${route.path}`, async c => {
            try {
                const result = await cap.run(await readInput(c, route.method), ctx)
                return c.body(JSON.stringify(result), 200, { "content-type": "application/json" })
            } catch (error) {
                if (error instanceof InputError) return c.json({ error: "invalid input", issues: error.issues }, 400)
                throw error
            }
        })
    }
    // The routes were registered in a loop, so Hono cannot infer them: CapabilitiesSchema derives the same
    // routes from the declarations instead. This is the single point where that derivation is asserted.
    // biome-ignore lint/nursery/noUnsafeTypeAssertion: the route schema is derived from Caps, not inferrable from the loop
    return app as unknown as Hono<BlankEnv, CapabilitiesSchema<Caps, Prefix>>
}
