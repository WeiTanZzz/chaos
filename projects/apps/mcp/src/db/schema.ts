import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

export const items = pgTable("items", {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
})

export type Item = typeof items.$inferSelect
export type NewItem = typeof items.$inferInsert
