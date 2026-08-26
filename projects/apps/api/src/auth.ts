import { CapabilityError } from "@chaos/capability"
import type { Context, MiddlewareHandler } from "hono"

export const roles = ["anonymous", "member", "admin"] as const

export type Role = (typeof roles)[number]

export type Caller = {
    role: Role
}

declare module "hono" {
    interface ContextVariableMap {
        caller: Caller
    }
}

const rank = (role: Role) => roles.indexOf(role)

/**
 * Demo identity, not authentication: it trusts a header. A real deployment verifies a token or session here —
 * that work is async, which is exactly why it belongs in middleware rather than in the context factory.
 */
export const identify: MiddlewareHandler = async (c, next) => {
    const claimed = c.req.header("x-role")
    c.set("caller", { role: roles.find(role => role === claimed) ?? "anonymous" })
    await next()
}

export const callerOf = (c: Context): Caller => c.get("caller") ?? { role: "anonymous" }

export const allows = (caller: Caller, needed: Role) => rank(caller.role) >= rank(needed)

/** Refuses with a status the HTTP surface renders as 403 and the MCP surface reports as a tool error. */
export const requireRole = (caller: Caller, needed: Role) => {
    if (!allows(caller, needed)) throw new CapabilityError(403, "forbidden", { needs: needed, has: caller.role })
}
