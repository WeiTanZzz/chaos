import { CapabilityError, createCapability, createScopedCapability } from "@chaos/capability"
import type { Item } from "@chaos/schema"
import { eq } from "drizzle-orm"
import { z } from "zod"
import type { Caller, Role } from "./auth.ts"
import type { Db } from "./db/client.ts"
import { items } from "./db/schema.ts"

export type Deps = {
    db: () => Db
    caller: Caller
}

/** What a capability declares about itself. The package never reads it; `authorize` in app.ts does. */
export type Access = {
    role: Role
}

export const capability = createCapability<Deps, Access>()

const identified = z.object({ id: z.uuid() })

/**
 * For capabilities addressed at one item. The id comes out of the validated input the way invevo pulls
 * `tenancy` / `workspace` / `insight` out of theirs, and the item it loads is handed to the handler, so the
 * handler neither repeats the query nor decides what a missing row means.
 */
export const itemCapability = createScopedCapability<Deps, Access, { item: Item }>(async ({ input, context }) => {
    const { id } = identified.parse(input)
    const row = (await context.db().select().from(items).where(eq(items.id, id)))[0]
    // Absent and invisible are answered the same way, so ownership cannot be probed.
    if (row === undefined) throw new CapabilityError(404, "not found", { id })
    return { item: { id: row.id, name: row.name, createdAt: row.createdAt.toISOString() } }
})
