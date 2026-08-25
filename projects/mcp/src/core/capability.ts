import { z } from "zod"
import type { Deps } from "./deps.ts"

export type Method = "get" | "post" | "put" | "patch" | "delete"

export type Route = {
    method: Method
    path: string
}

type Spec<S extends z.ZodRawShape, O> = {
    name: string
    title?: string
    description: string
    input: S
    route: Route
    mcp?: boolean
    handler: (input: z.infer<z.ZodObject<S>>, deps: Deps) => Promise<O>
}

export type Capability = {
    name: string
    title?: string
    description: string
    input: z.ZodRawShape
    route: Route
    mcp: boolean
    run: (raw: unknown, deps: Deps) => Promise<unknown>
}

export class InputError extends Error {
    constructor(readonly issues: z.core.$ZodIssue[]) {
        super("invalid input")
    }
}

export const capability = <S extends z.ZodRawShape, O>(spec: Spec<S, O>): Capability => ({
    name: spec.name,
    title: spec.title,
    description: spec.description,
    input: spec.input,
    route: spec.route,
    mcp: spec.mcp ?? false,
    run: async (raw, deps) => {
        const parsed = z.object(spec.input).safeParse(raw)
        if (!parsed.success) throw new InputError(parsed.error.issues)
        return await spec.handler(parsed.data, deps)
    }
})
