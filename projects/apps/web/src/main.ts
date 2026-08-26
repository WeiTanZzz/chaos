import type { AppType } from "@chaos/api"
import type { Item } from "@chaos/schema"
import { hc } from "hono/client"

const el = <T extends HTMLElement>(selector: string): T => {
    const node = document.querySelector<T>(selector)
    if (node === null) throw new Error(`missing element ${selector}`)
    return node
}

const form = el<HTMLFormElement>("#create")
const nameInput = el<HTMLInputElement>("#name")
const limitInput = el<HTMLInputElement>("#limit")
const roleSelect = el<HTMLSelectElement>("#role")
const list = el<HTMLUListElement>("#items")
const empty = el<HTMLParagraphElement>("#empty")
const error = el<HTMLParagraphElement>("#error")

// The role rides on every request so the switcher takes effect immediately. A real client has no say in this:
// here the proxy forwards the header, in production it would hold a credential the browser never sees.
const itemsApi = hc<AppType>(window.location.origin, { headers: () => ({ "x-role": roleSelect.value }) }).api.v1.items

const show = (message: string | null) => {
    error.textContent = message ?? ""
    error.hidden = message === null
}

type Refusal = { status: number; statusText: string; json: () => Promise<unknown> }

const refused = async (response: Refusal, action: string) => {
    const body = await response.json().catch(() => undefined)
    const detail = typeof body === "object" && body !== null && "error" in body ? String(body.error) : response.statusText
    show(`${action} refused as ${roleSelect.value}: ${response.status} ${detail}`)
}

const render = (items: Item[]) => {
    list.replaceChildren(
        ...items.map(item => {
            const entry = document.createElement("li")

            const label = document.createElement("div")
            label.textContent = item.name
            const id = document.createElement("span")
            id.className = "id"
            id.textContent = item.id
            label.append(id)

            const created = document.createElement("time")
            created.dateTime = item.createdAt
            created.textContent = new Date(item.createdAt).toLocaleString()

            const remove = document.createElement("button")
            remove.type = "button"
            remove.textContent = "Delete"
            remove.addEventListener("click", () => {
                void destroy(item.id)
            })

            const meta = document.createElement("div")
            meta.className = "meta"
            meta.append(created, remove)

            entry.append(label, meta)
            return entry
        })
    )
    empty.hidden = items.length > 0
}

const refresh = async () => {
    const response = await itemsApi.$get({ query: { limit: limitInput.value } })
    if (!response.ok) return refused(response, "list")
    show(null)
    render(await response.json())
}

const destroy = async (id: string) => {
    const response = await itemsApi[":id"].$delete({ param: { id } })
    if (!response.ok) return refused(response, "delete")
    await refresh()
}

form.addEventListener("submit", async event => {
    event.preventDefault()
    const response = await itemsApi.$post({ json: { name: nameInput.value } })
    if (!response.ok) return refused(response, "create")
    nameInput.value = ""
    await refresh()
})

for (const input of [limitInput, roleSelect]) {
    input.addEventListener("change", () => {
        void refresh()
    })
}

void refresh()
