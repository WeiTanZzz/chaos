import { desc, eq } from "drizzle-orm"
import { z } from "zod"
import { capability } from "../core/capability.ts"
import { items } from "../db/schema.ts"

export const listItems = capability({
    name: "items_list",
    title: "List items",
    description: "List items, newest first.",
    input: { limit: z.coerce.number().int().min(1).max(100).default(20) },
    route: { method: "get", path: "/items" },
    mcp: true,
    handler: async ({ limit }, { db }) => db().select().from(items).orderBy(desc(items.createdAt)).limit(limit)
})

export const createItem = capability({
    name: "items_create",
    title: "Create item",
    description: "Create an item with the given name.",
    input: { name: z.string().min(1) },
    route: { method: "post", path: "/items" },
    handler: async ({ name }, { db }) => (await db().insert(items).values({ name }).returning())[0]
})

export const getItem = capability({
    name: "items_get",
    title: "Get item",
    description: "Fetch a single item by id.",
    input: { id: z.uuid() },
    route: { method: "get", path: "/items/:id" },
    mcp: true,
    handler: async ({ id }, { db }) => (await db().select().from(items).where(eq(items.id, id)))[0] ?? null
})
