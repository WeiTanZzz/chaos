import { createDb } from "@chaos/db"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"
import { config } from "./config.ts"

migrate(createDb(config.databasePath()), { migrationsFolder: "./drizzle" })
