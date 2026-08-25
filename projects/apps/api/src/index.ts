import { createApp } from "@chaos/capability"
import { lazyDb } from "@chaos/db"
import { capabilities } from "@chaos/items"
import { config } from "./config.ts"

const app = createApp({
    context: { db: lazyDb(config.databasePath) },
    capabilities,
    info: { name: "chaos-api", version: "0.0.0" }
})

export type AppType = typeof app

export default {
    port: config.port,
    fetch: app.fetch
}
