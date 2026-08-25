import { createItem, getItem, listItems, summarizeItems } from "./items.ts"

export const capabilities = [listItems, getItem, createItem, summarizeItems]
