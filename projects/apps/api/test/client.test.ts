import { expect, test } from "bun:test"
import type { hc, InferResponseType } from "hono/client"
import type { AppType } from "../src/index.ts"

test("dates are typed as strings on the wire", () => {
    type Items = InferResponseType<ReturnType<typeof hc<AppType>>["api"]["v1"]["items"]["$get"]>
    const items: Items = [{ id: "id", name: "name", createdAt: "2026-08-25T00:00:00.000Z" }]
    expect(items).toHaveLength(1)
})
