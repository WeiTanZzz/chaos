import { createApp } from "@chaos/capability"
import { capabilities } from "./capabilities/index.ts"
import { config } from "./config.ts"
import { lazyDb } from "./db/client.ts"

// One lazily-opened handle for the process; the factory hands the same deps to every request.
const deps = { db: lazyDb(config.databasePath) }

const app = createApp({
    context: () => deps,
    capabilities,
    info: { name: "chaos-api", version: "0.0.0" },
    surfaces: config.surfaces,
    basePath: "/api/v1"
})

export type AppType = typeof app

export default {
    port: config.port,
    fetch: app.fetch
}
