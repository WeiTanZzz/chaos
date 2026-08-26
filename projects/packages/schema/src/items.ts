import { z } from "zod"

/** An item as it crosses the wire: `createdAt` is an ISO string, not a Date. */
export const itemSchema = z.object({
    id: z.uuid(),
    name: z.string(),
    createdAt: z.iso.datetime()
})

export type Item = z.infer<typeof itemSchema>

export const listItemsInput = { limit: z.coerce.number().int().min(1).max(100).default(20) }
export const listItemsOutput = z.array(itemSchema)

export const getItemInput = { id: z.uuid() }
export const getItemOutput = itemSchema.nullable()

export const createItemInput = { name: z.string().min(1) }
export const createItemOutput = itemSchema

export const deleteItemInput = { id: z.uuid() }
export const deleteItemOutput = z.object({ deleted: z.number().int() })

export const summarizeItemsInput = { since: z.iso.date().optional() }
export const summarizeItemsOutput = z.object({
    since: z.iso.date().nullable(),
    total: z.number().int(),
    earliest: z.iso.datetime().nullable(),
    latest: z.iso.datetime().nullable()
})

export type ItemsSummary = z.infer<typeof summarizeItemsOutput>
