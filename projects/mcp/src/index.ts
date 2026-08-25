import { createApp } from "./app.ts"
import { capabilities } from "./capabilities/index.ts"
import { config } from "./config.ts"
import { lazyDb } from "./db/client.ts"

const app = createApp({ deps: { db: lazyDb(config.databaseUrl) }, capabilities })

export default {
    port: config.port,
    fetch: app.fetch
}
