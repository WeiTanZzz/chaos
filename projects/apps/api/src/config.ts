import { z } from "zod"

const surfaces = z
    .string()
    .transform(value => value.split(",").map(name => name.trim()))
    .pipe(z.array(z.enum(["http", "mcp", "openapi"])))
    .optional()

const schema = z.object({
    PORT: z.coerce.number().int().min(1).max(65535).default(4400),
    DATABASE_PATH: z.string().min(1).default("api.sqlite"),
    TRACING: z.stringbool().default(false),
    SURFACES: surfaces
})

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
    // Fail at boot with the whole list, rather than at the first request that happens to need a bad value.
    console.error("invalid configuration:", z.prettifyError(parsed.error))
    throw new Error("invalid configuration")
}

const env = parsed.data
const enabled = env.SURFACES

export const config = {
    port: env.PORT,
    databasePath: () => env.DATABASE_PATH,
    tracing: env.TRACING,
    surfaces: {
        http: enabled === undefined || enabled.includes("http"),
        mcp: enabled === undefined || enabled.includes("mcp"),
        openapi: enabled === undefined || enabled.includes("openapi")
    }
}
