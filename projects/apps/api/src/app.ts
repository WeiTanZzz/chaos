import { createApp } from "@chaos/capability"
import type { Context } from "hono"
import { allows, callerOf, identify, type Role } from "./auth.ts"
import { access, capabilities } from "./capabilities/index.ts"
import type { Db } from "./db/client.ts"

// Widened for lookup by name: the literal map keeps its exact types where the capabilities declare themselves.
const required: Record<string, Role | undefined> = access

export const buildApp = (db: () => Db) =>
    createApp({
        context: (c: Context) => ({ db, caller: callerOf(c) }),
        capabilities,
        info: { name: "chaos-api", version: "0.0.0" },
        basePath: "/api/v1",
        middleware: { all: [identify] },
        // A tool the caller may not run is not advertised to them either.
        visibleTools: (capability, c) => allows(callerOf(c), required[capability.name] ?? "anonymous")
    })
