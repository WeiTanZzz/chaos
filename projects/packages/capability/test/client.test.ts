import { expect, test } from "bun:test"
import { hc, type InferRequestType, type InferResponseType } from "hono/client"
import { createApp } from "../src/index.ts"
import { context, echo, hidden, info, toolOnly } from "./fixtures.ts"

const app = createApp({ context, capabilities: [echo, hidden, toolOnly], info })

test("the rpc client is typed from the same declarations", async () => {
    const client = hc<typeof app>("http://test", { fetch: app.request })

    const response = await client.echo.$get({ query: { message: "there" } })
    expect(await response.json()).toEqual({ message: "hi there" })

    type Request = InferRequestType<typeof client.echo.$get>
    type Response = InferResponseType<typeof client.echo.$get>
    const request: Request = { query: { message: "there" } }
    const echoed: Response = { message: "hi there" }
    expect([request, echoed]).toBeDefined()
})
