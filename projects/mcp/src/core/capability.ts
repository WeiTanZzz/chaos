import { z } from "zod"
import type { Deps } from "./deps.ts"

export type Method = "get" | "post" | "put" | "patch" | "delete"

export type Route<M extends Method = Method, P extends string = string> = {
    method: M
    path: P
}

type Spec<N extends string, S extends z.ZodRawShape, O> = {
    name: N
    title?: string
    description: string
    input: S
    handler: (input: z.infer<z.ZodObject<S>>, deps: Deps) => Promise<O>
}

export type Capability<N extends string = string, S extends z.ZodRawShape = z.ZodRawShape, O = unknown, R extends Route | undefined = Route | undefined> = {
    name: N
    title?: string
    description: string
    input: S
    route: R
    mcp: boolean
    run: (raw: unknown, deps: Deps) => Promise<O>
}

export type AnyCapability = Capability

export class InputError extends Error {
    constructor(readonly issues: z.core.$ZodIssue[]) {
        super("invalid input")
    }
}

export function capability<N extends string, S extends z.ZodRawShape, O, M extends Method, P extends string>(
    spec: Spec<N, S, O> & { route: Route<M, P>; mcp?: boolean }
): Capability<N, S, O, Route<M, P>>
export function capability<N extends string, S extends z.ZodRawShape, O>(spec: Spec<N, S, O> & { route?: undefined; mcp: true }): Capability<N, S, O, undefined>
export function capability<N extends string, S extends z.ZodRawShape, O>(
    spec: Spec<N, S, O> & { route?: Route; mcp?: boolean }
): Capability<N, S, O, Route | undefined> {
    return {
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
    }
}
