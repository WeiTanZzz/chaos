import { defineConfig } from "drizzle-kit"
import { config } from "./src/config.ts"

export default defineConfig({
    dialect: "sqlite",
    schema: "../../packages/db/src/schema.ts",
    out: "./drizzle",
    dbCredentials: { url: config.databasePath() }
})
