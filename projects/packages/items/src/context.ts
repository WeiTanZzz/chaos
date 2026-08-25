import { createCapability } from "@chaos/capability"
import type { Db } from "@chaos/db"

export type ItemsContext = {
    db: () => Db
}

export const capability = createCapability<ItemsContext>()
