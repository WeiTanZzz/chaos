const surface = (name: string) => {
    const enabled = process.env.SURFACES?.split(",").map(value => value.trim())
    return enabled === undefined ? true : enabled.includes(name)
}

export const config = {
    port: Number(process.env.PORT ?? 4400),
    databasePath: () => process.env.DATABASE_PATH ?? "api.sqlite",
    surfaces: { http: surface("http"), mcp: surface("mcp"), openapi: surface("openapi") }
}
