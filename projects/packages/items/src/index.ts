export type { ItemsContext } from "./context.ts"
export { createItem, getItem, listItems, summarizeItems } from "./items.ts"

import { createItem, getItem, listItems, summarizeItems } from "./items.ts"

export const capabilities = [listItems, getItem, createItem, summarizeItems]
