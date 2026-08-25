const required = (name: string): string => {
    const value = process.env[name]
    if (value === undefined || value === "") throw new Error(`missing env ${name}`)
    return value
}

export const config = {
    port: Number(process.env.PORT ?? 4400),
    databaseUrl: () => required("DATABASE_URL")
}
