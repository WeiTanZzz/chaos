import type { Context, Hono } from "hono"
import type { BlankEnv } from "hono/types"
import { type AnyCapability, InputError } from "./capability.ts"
import type { Deps } from "./deps.ts"
import type { CapabilitiesSchema } from "./schema.ts"

const readInput = async (c: Context, method: string) => {
    const params = c.req.param() as Record<string, unknown>
    if (method === "get" || method === "delete") return { ...c.req.query(), ...params }
    const body = await c.req.json().catch(() => ({}))
    return { ...(body as Record<string, unknown>), ...params }
}

export const mountHttp = <Caps extends readonly AnyCapability[]>(app: Hono, capabilities: Caps, deps: Deps) => {
    for (const cap of capabilities) {
        const route = cap.route
        if (route === undefined) continue
        app[route.method](route.path, async c => {
            try {
                return c.json((await cap.run(await readInput(c, route.method), deps)) as never)
            } catch (error) {
                if (error instanceof InputError) return c.json({ error: "invalid input", issues: error.issues }, 400)
                throw error
            }
        })
    }
    return app as unknown as Hono<BlankEnv, CapabilitiesSchema<Caps>>
}
