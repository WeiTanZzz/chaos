import { CapabilityError } from "../src/index.ts"
import { serveStdio } from "../src/stdio.ts"
import { echo, hidden, info, toolOnly } from "./fixtures.ts"

await serveStdio({
    capabilities: [echo, hidden, toolOnly],
    context: { greeting: "hi" },
    info,
    authorize: capability => {
        if (capability.name === "tool_only" && process.env.DENY === "1") throw new CapabilityError(403, "denied")
    }
})
