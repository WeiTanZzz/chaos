import {
    createItemInput,
    createItemOutput,
    deleteItemInput,
    deleteItemOutput,
    getItemInput,
    getItemOutput,
    type Item,
    listItemsInput,
    listItemsOutput,
    summarizeItemsInput,
    summarizeItemsOutput
} from "@chaos/schema"
import { count, desc, eq, gte, max, min } from "drizzle-orm"
import type { Role } from "../auth.ts"
import { requireRole } from "../auth.ts"
import { capability } from "../context.ts"
import { items } from "../db/schema.ts"

/**
 * What each capability needs. One declaration drives both the guard inside the handler — which covers HTTP and
 * MCP alike — and `visibleTools`, which hides a tool from callers who could not run it.
 */
export const access = {
    items_list: "anonymous",
    items_get: "anonymous",
    items_create: "member",
    items_delete: "admin",
    items_summarize: "member"
} satisfies Record<string, Role>

type Row = typeof items.$inferSelect

const toItem = (row: Row): Item => ({ id: row.id, name: row.name, createdAt: row.createdAt.toISOString() })

export const listItems = capability({
    name: "items_list",
    title: "List items",
    description: "List items, newest first.",
    input: listItemsInput,
    output: listItemsOutput,
    route: { method: "get", path: "/items" },
    mcp: true,
    handler: async ({ limit }, { db }) => (await db().select().from(items).orderBy(desc(items.createdAt)).limit(limit)).map(toItem)
})

export const getItem = capability({
    name: "items_get",
    title: "Get item",
    description: "Fetch a single item by id.",
    input: getItemInput,
    output: getItemOutput,
    route: { method: "get", path: "/items/:id" },
    mcp: true,
    handler: async ({ id }, { db }) => {
        const row = (await db().select().from(items).where(eq(items.id, id)))[0]
        return row === undefined ? null : toItem(row)
    }
})

export const createItem = capability({
    name: "items_create",
    title: "Create item",
    description: "Create an item with the given name.",
    input: createItemInput,
    output: createItemOutput,
    route: { method: "post", path: "/items" },
    handler: async ({ name }, { db, caller }) => {
        requireRole(caller, access.items_create)
        const [row] = await db().insert(items).values({ name }).returning()
        if (row === undefined) throw new Error("insert returned no rows")
        return toItem(row)
    }
})

export const deleteItem = capability({
    name: "items_delete",
    title: "Delete item",
    description: "Delete an item by id. Administrators only.",
    input: deleteItemInput,
    output: deleteItemOutput,
    route: { method: "delete", path: "/items/:id" },
    handler: async ({ id }, { db, caller }) => {
        requireRole(caller, access.items_delete)
        const deleted = await db().delete(items).where(eq(items.id, id)).returning()
        return { deleted: deleted.length }
    }
})

export const summarizeItems = capability({
    name: "items_summarize",
    title: "Summarize items",
    description: "Count items and report when the first and last one were created, optionally limited to those created on or after a date (YYYY-MM-DD).",
    input: summarizeItemsInput,
    output: summarizeItemsOutput,
    mcp: true,
    handler: async ({ since }, { db, caller }) => {
        requireRole(caller, access.items_summarize)
        const [summary] = await db()
            .select({ total: count(), earliest: min(items.createdAt), latest: max(items.createdAt) })
            .from(items)
            .where(since === undefined ? undefined : gte(items.createdAt, new Date(since)))
        return {
            since: since ?? null,
            total: summary?.total ?? 0,
            earliest: summary?.earliest?.toISOString() ?? null,
            latest: summary?.latest?.toISOString() ?? null
        }
    }
})
