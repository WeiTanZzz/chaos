import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const items = sqliteTable("items", {
    id: text("id")
        .primaryKey()
        .$defaultFn(() => crypto.randomUUID()),
    name: text("name").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
        .notNull()
        .$defaultFn(() => new Date())
})

export type Item = typeof items.$inferSelect
export type NewItem = typeof items.$inferInsert
