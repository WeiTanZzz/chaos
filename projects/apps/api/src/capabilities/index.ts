import { createItem, deleteItem, getItem, listItems, summarizeItems } from "./items.ts"

export { createItem, deleteItem, getItem, listItems, summarizeItems }

export const capabilities = [listItems, getItem, createItem, deleteItem, summarizeItems]
