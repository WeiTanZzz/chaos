import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"
import { z } from "zod"
import { buildApp } from "../src/app.ts"
import * as schema from "../src/db/schema.ts"

const db = drizzle(new Database(":memory:"), { schema })
migrate(db, { migrationsFolder: `${import.meta.dir}/../drizzle` })

const app = buildApp(() => db)

const as = (role: string): Record<string, string> => ({ "x-role": role })

const rpc = async (body: unknown, role: string) => {
    const response = await app.request("/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...as(role) },
        body: JSON.stringify(body)
    })
    const text = await response.text()
    return JSON.parse(text.slice(text.indexOf("data: ") + 6))
}

const create = (name: string, role: string) =>
    app.request("/api/v1/items", { method: "POST", headers: { "content-type": "application/json", ...as(role) }, body: JSON.stringify({ name }) })

test("reads are open, writes need a member", async () => {
    expect((await app.request("/api/v1/items")).status).toBe(200)

    const refused = await create("from anonymous", "anonymous")
    expect(refused.status).toBe(403)
    expect(await refused.json()).toEqual({ error: "forbidden", details: { needs: "member", has: "anonymous" } })

    expect((await create("from member", "member")).status).toBe(200)
})

test("deleting needs an admin", async () => {
    const created = z.object({ id: z.uuid() }).parse(await (await create("doomed", "admin")).json())

    expect((await app.request(`/api/v1/items/${created.id}`, { method: "delete", headers: as("member") })).status).toBe(403)

    const deleted = await app.request(`/api/v1/items/${created.id}`, { method: "delete", headers: as("admin") })
    expect(deleted.status).toBe(200)
    expect(await deleted.json()).toEqual({ deleted: 1 })
})

test("the same rule applies over mcp", async () => {
    // Hidden, so it is not "forbidden" over mcp — for this caller the tool simply does not exist.
    const asAnonymous = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "items_summarize", arguments: {} } }, "anonymous")
    expect(asAnonymous.result.content[0].text).toContain("not found")
    expect(asAnonymous.result.isError).toBe(true)

    const asMember = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "items_summarize", arguments: {} } }, "member")
    expect(JSON.parse(asMember.result.content[0].text).total).toBeGreaterThan(0)
})

test("tools are hidden from callers who could not run them", async () => {
    const names = async (role: string) => (await rpc({ jsonrpc: "2.0", id: 3, method: "tools/list" }, role)).result.tools.map((t: { name: string }) => t.name)

    expect(await names("anonymous")).toEqual(["items_list", "items_get"])
    expect(await names("member")).toEqual(["items_list", "items_get", "items_summarize"])
})
