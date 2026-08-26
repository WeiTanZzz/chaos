import { createItem, deleteItem, getItem, listItems, renameItem, summarizeItems } from "./items.ts"

export { createItem, deleteItem, getItem, listItems, renameItem, summarizeItems }

export const capabilities = [listItems, getItem, createItem, renameItem, deleteItem, summarizeItems]
