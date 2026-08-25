import { createApp } from "@chaos/capability"
import { capabilities } from "./capabilities/index.ts"
import { config } from "./config.ts"
import { lazyDb } from "./db/client.ts"

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
