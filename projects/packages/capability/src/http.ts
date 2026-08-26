import type { Context, Hono, MiddlewareHandler } from "hono"
import { every } from "hono/combine"
import type { BlankEnv, Schema } from "hono/types"
import { type AnyCapability, CapabilityError } from "./capability.ts"

const readInput = async (c: Context, method: string) => {
    const params = c.req.param()
    if (method === "get" || method === "delete") return { ...c.req.query(), ...params }
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}))
    return { ...body, ...params }
}

const trimSlash = (path: string) => (path.endsWith("/") ? path.slice(0, -1) : path)

/**
 * Builds the context for one request. Deliberately synchronous: anything async (authenticating a token, loading
 * a user) belongs in middleware, which can store its result on the Hono context for this factory to read.
 */
export type ContextFactory<Ctx> = (c: Context) => Ctx

export type HttpOptions<Ctx, Caps extends readonly AnyCapability<Ctx>[], Prefix extends string> = {
    capabilities: Caps
    context: ContextFactory<Ctx>
    basePath?: Prefix
    /** Runs before every capability route, ahead of any middleware the route itself declares. */
    middleware?: MiddlewareHandler[]
    /** When false no route is registered, but the returned type is unchanged. */
    enabled?: boolean
}

export const mountHttp = <Ctx, Caps extends readonly AnyCapability<Ctx>[], Prefix extends string, S extends Schema>(
    app: Hono<BlankEnv, S>,
    { capabilities, context, basePath, middleware = [], enabled = true }: HttpOptions<Ctx, Caps, Prefix>
) => {
    const prefix = trimSlash(basePath ?? "")
    for (const cap of enabled ? capabilities : []) {
        const route = cap.route
        if (route === undefined) continue
        const handler = async (c: Context) => {
            try {
                const result = await cap.run(await readInput(c, route.method), context(c))
                return c.body(JSON.stringify(result), 200, { "content-type": "application/json" })
            } catch (error) {
                if (error instanceof CapabilityError) {
                    return c.json({ error: error.message, ...(error.details === undefined ? {} : { details: error.details }) }, error.status)
                }
                throw error
            }
        }
        const path = `${prefix}${route.path}`
        const chain = [...middleware, ...(route.middleware ?? [])]
        if (chain.length === 0) app[route.method](path, handler)
        else app[route.method](path, every(...chain), handler)
    }
    return app
}
