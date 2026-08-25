export const config = {
    port: Number(process.env.PORT ?? 4400),
    databasePath: () => process.env.DATABASE_PATH ?? "mcp.sqlite"
}
