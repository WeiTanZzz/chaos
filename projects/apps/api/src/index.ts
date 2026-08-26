import { buildApp } from "./app.ts"
import { config } from "./config.ts"
import { lazyDb } from "./db/client.ts"

const app = buildApp(lazyDb(config.databasePath))

export type AppType = typeof app

export default {
    port: config.port,
    fetch: app.fetch
}
