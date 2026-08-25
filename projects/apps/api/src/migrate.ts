import { migrate } from "drizzle-orm/bun-sqlite/migrator"
import { config } from "./config.ts"
import { createDb } from "./db/client.ts"

migrate(createDb(config.databasePath()), { migrationsFolder: "./drizzle" })
