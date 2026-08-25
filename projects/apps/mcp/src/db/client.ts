import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import * as schema from "./schema.ts"

export type Db = ReturnType<typeof createDb>

export const createDb = (url: string) => drizzle(postgres(url, { prepare: false }), { schema })

export const lazyDb = (url: () => string) => {
    let db: Db | undefined
    return () => (db ??= createDb(url()))
}
