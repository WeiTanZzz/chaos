import { createCapability } from "@chaos/capability"
import type { Caller } from "./auth.ts"
import type { Db } from "./db/client.ts"

export type Deps = {
    db: () => Db
    caller: Caller
}

export const capability = createCapability<Deps>()
