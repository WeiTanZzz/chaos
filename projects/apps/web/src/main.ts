import type { AppType } from "@chaos/api"
import type { Item } from "@chaos/schema"
import { hc } from "hono/client"

const itemsApi = hc<AppType>(window.location.origin).api.v1.items

const el = <T extends HTMLElement>(selector: string): T => {
    const node = document.querySelector<T>(selector)
    if (node === null) throw new Error(`missing element ${selector}`)
    return node
}

const form = el<HTMLFormElement>("#create")
const nameInput = el<HTMLInputElement>("#name")
const limitInput = el<HTMLInputElement>("#limit")
const list = el<HTMLUListElement>("#items")
const empty = el<HTMLParagraphElement>("#empty")
const error = el<HTMLParagraphElement>("#error")

const show = (message: string | null) => {
    error.textContent = message ?? ""
    error.hidden = message === null
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
            entry.append(label, created)
            return entry
        })
    )
    empty.hidden = items.length > 0
}

const refresh = async () => {
    const response = await itemsApi.$get({ query: { limit: limitInput.value } })
    if (!response.ok) return show(`list failed: ${response.status}`)
    show(null)
    render(await response.json())
}

form.addEventListener("submit", async event => {
    event.preventDefault()
    const response = await itemsApi.$post({ json: { name: nameInput.value } })
    if (!response.ok) return show(`create failed: ${response.status}`)
    nameInput.value = ""
    await refresh()
})

limitInput.addEventListener("change", () => {
    void refresh()
})

void refresh()
