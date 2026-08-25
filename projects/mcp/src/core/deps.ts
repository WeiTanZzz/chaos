import type { Db } from "../db/client.ts"

export type Deps = {
    db: () => Db
}
