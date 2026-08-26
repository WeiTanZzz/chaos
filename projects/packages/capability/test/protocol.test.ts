import { expect, test } from "bun:test"
import { z } from "zod"
import { createApp, createCapability } from "../src/index.ts"
import { rpc } from "./fixtures.ts"

const capability = createCapability<Record<never, never>>()
const context = () => ({})
const info = { name: "test", version: "0.0.0" }

const one = capability({
    name: "one",
    description: "Object output, so it can be declared to the client.",
    input: {},
    output: z.object({ value: z.number() }),
    mcp: true,
    handler: async () => ({ value: 1 })
})

const many = capability({
    name: "many",
    description: "Array output, which structuredContent cannot carry.",
    input: {},
    output: z.array(z.object({ value: z.number() })),
    mcp: true,
    handler: async () => [{ value: 1 }]
})

const app = createApp({ context, capabilities: [one, many], info })

test("an object output is declared as an output schema and returned as structured content", async () => {
    const listed = await rpc(app, { jsonrpc: "2.0", id: 2, method: "tools/list" })
    const tools: { name: string; outputSchema?: { properties?: Record<string, unknown> } }[] = listed.result.tools

    expect(tools.find(tool => tool.name === "one")?.outputSchema?.properties).toHaveProperty("value")
    expect(tools.find(tool => tool.name === "many")?.outputSchema).toBeUndefined()

    const object = await rpc(app, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "one", arguments: {} } })
    expect(object.result.structuredContent).toEqual({ value: 1 })
    expect(object.result.content[0].text).toBe(JSON.stringify({ value: 1 }))

    const array = await rpc(app, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "many", arguments: {} } })
    expect(array.result.structuredContent).toBeUndefined()
    expect(array.result.content[0].text).toBe(JSON.stringify([{ value: 1 }]))
})
