import { z } from "zod"
import type { Deps } from "./deps.ts"

export type Method = "get" | "post" | "put" | "patch" | "delete"

export type Route<M extends Method = Method, P extends string = string> = {
    method: M
    path: P
}

type Spec<N extends string, M extends Method, P extends string, S extends z.ZodRawShape, O> = {
    name: N
    title?: string
    description: string
    input: S
    route: Route<M, P>
    mcp?: boolean
    handler: (input: z.infer<z.ZodObject<S>>, deps: Deps) => Promise<O>
}

export type Capability<
    N extends string = string,
    M extends Method = Method,
    P extends string = string,
    S extends z.ZodRawShape = z.ZodRawShape,
    O = unknown
> = {
    name: N
    title?: string
    description: string
    input: S
    route: Route<M, P>
    mcp: boolean
    run: (raw: unknown, deps: Deps) => Promise<O>
}

export type AnyCapability = Capability

export class InputError extends Error {
    constructor(readonly issues: z.core.$ZodIssue[]) {
        super("invalid input")
    }
}

export const capability = <N extends string, M extends Method, P extends string, S extends z.ZodRawShape, O>(
    spec: Spec<N, M, P, S, O>
): Capability<N, M, P, S, O> => ({
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
