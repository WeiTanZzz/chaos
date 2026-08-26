import type { Hono } from "hono"
import { z } from "zod"
import { createCapability } from "../src/index.ts"

export type Ctx = { greeting: string }

export const capability = createCapability<Ctx>()

export const context = () => ({ greeting: "hi" })

export const info = { name: "test", version: "0.0.0" }

export const echo = capability({
    name: "echo",
    description: "Echo a message back.",
    input: { message: z.string().min(1) },
    route: { method: "get", path: "/echo" },
    mcp: true,
    handler: async ({ message }, { greeting }) => ({ message: `${greeting} ${message}` })
})

export const hidden = capability({
    name: "hidden",
    description: "Http only, no mcp flag set.",
    input: {},
    route: { method: "get", path: "/hidden" },
    handler: async () => ({ ok: true })
})

export const toolOnly = capability({
    name: "tool_only",
    description: "Reachable as an mcp tool, with no http route.",
    input: { value: z.number() },
    mcp: true,
    handler: async ({ value }) => ({ doubled: value * 2 })
})

/** Sends one JSON-RPC message to the mcp endpoint and unwraps the single SSE frame that comes back. */
export const rpc = async (app: Hono, body: unknown, headers: Record<string, string> = {}) => {
    const response = await app.request("/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
        body: JSON.stringify(body)
    })
    const text = await response.text()
    return JSON.parse(text.slice(text.indexOf("data: ") + 6))
}

export const toolNames = (listed: { result: { tools: { name: string }[] } }) => listed.result.tools.map(tool => tool.name)
