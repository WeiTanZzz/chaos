import { createApp } from "@chaos/capability"
import type { Context } from "hono"
import { allows, callerOf, identify, type Role, requireRole } from "./auth.ts"
import { capabilities } from "./capabilities/index.ts"
import type { Db } from "./db/client.ts"
import { instrument } from "./observability.ts"

const needs = (meta: { role: Role } | undefined): Role => meta?.role ?? "anonymous"

export const buildApp = (db: () => Db) =>
    createApp({
        context: (c: Context) => ({ db, caller: callerOf(c) }),
        capabilities,
        info: { name: "chaos-api", version: "0.0.0" },
        basePath: "/api/v1",
        middleware: { all: [identify] },
        // Both surfaces, one rule, read off what each capability declared about itself.
        authorize: (capability, { caller }) => requireRole(caller, needs(capability.meta)),
        instrument,
        // A tool the caller may not run is not advertised to them either.
        visibleTools: (capability, c) => allows(callerOf(c), needs(capability.meta))
    })
