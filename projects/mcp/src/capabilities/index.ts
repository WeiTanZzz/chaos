import { createItem, getItem, listItems } from "./items.ts"

export const capabilities = [listItems, getItem, createItem]
