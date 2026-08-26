import { createCapability } from "@chaos/capability"
import type { Caller, Role } from "./auth.ts"
import type { Db } from "./db/client.ts"

export type Deps = {
    db: () => Db
    caller: Caller
}

/** What a capability declares about itself. The package never reads it; `authorize` in app.ts does. */
export type Access = {
    role: Role
}

export const capability = createCapability<Deps, Access>()
