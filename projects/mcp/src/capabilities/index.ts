import type { Capability } from "../core/capability.ts"
import { createItem, getItem, listItems } from "./items.ts"

export const capabilities: readonly Capability[] = [listItems, getItem, createItem]
