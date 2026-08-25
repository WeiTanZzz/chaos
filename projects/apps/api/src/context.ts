import { createCapability } from "@chaos/capability"
import type { Db } from "./db/client.ts"

export type Deps = {
    db: () => Db
}

export const capability = createCapability<Deps>()
