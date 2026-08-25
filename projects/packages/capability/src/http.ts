import type { Context, Hono, MiddlewareHandler } from "hono"
import { every } from "hono/combine"
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

export type HttpOptions<Ctx, Caps extends readonly AnyCapability<Ctx>[], Prefix extends string> = {
    capabilities: Caps
    context: Ctx
    basePath?: Prefix
    /** Runs before every capability route, ahead of any middleware the route itself declares. */
    middleware?: MiddlewareHandler[]
    /** When false no route is registered, but the returned type is unchanged. */
    enabled?: boolean
}

export const mountHttp = <Ctx, Caps extends readonly AnyCapability<Ctx>[], Prefix extends string = "">(
    app: Hono,
    { capabilities, context, basePath, middleware = [], enabled = true }: HttpOptions<Ctx, Caps, Prefix>
) => {
    const prefix = trimSlash(basePath ?? "")
    for (const cap of enabled ? capabilities : []) {
        const route = cap.route
        if (route === undefined) continue
        const handler = async (c: Context) => {
            try {
                const result = await cap.run(await readInput(c, route.method), context)
                return c.body(JSON.stringify(result), 200, { "content-type": "application/json" })
            } catch (error) {
                if (error instanceof InputError) return c.json({ error: "invalid input", issues: error.issues }, 400)
                throw error
            }
        }
        const path = `${prefix}${route.path}`
        const chain = [...middleware, ...(route.middleware ?? [])]
        if (chain.length === 0) app[route.method](path, handler)
        else app[route.method](path, every(...chain), handler)
    }
    // The routes were registered in a loop, so Hono cannot infer them: CapabilitiesSchema derives the same
    // routes from the declarations instead. This is the single point where that derivation is asserted.
    // biome-ignore lint/nursery/noUnsafeTypeAssertion: the route schema is derived from Caps, not inferrable from the loop
    return app as unknown as Hono<BlankEnv, CapabilitiesSchema<Caps, Prefix>>
}
