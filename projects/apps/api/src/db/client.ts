import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import * as schema from "./schema.ts"

export type Db = ReturnType<typeof createDb>

export const createDb = (path: string) => drizzle(new Database(path), { schema })

export const lazyDb = (path: () => string) => {
    let db: Db | undefined
    return () => (db ??= createDb(path()))
}
