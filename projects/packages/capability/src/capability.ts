import { z } from "zod"

export type Method = "get" | "post" | "put" | "patch" | "delete"

export type Route<M extends Method = Method, P extends string = string> = {
    method: M
    path: P
}

type Spec<N extends string, S extends z.ZodRawShape, O, Ctx> = {
    name: N
    title?: string
    description: string
    input: S
    handler: (input: z.infer<z.ZodObject<S>>, ctx: Ctx) => Promise<O>
}

export type Capability<
    N extends string = string,
    S extends z.ZodRawShape = z.ZodRawShape,
    O = unknown,
    R extends Route | undefined = Route | undefined,
    Ctx = never
> = {
    name: N
    title?: string
    description: string
    input: S
    route: R
    mcp: boolean
    run: (raw: unknown, ctx: Ctx) => Promise<O>
}

export type AnyCapability<Ctx = never> = Capability<string, z.ZodRawShape, unknown, Route | undefined, Ctx>

export type CapabilityFactory<Ctx> = {
    <N extends string, S extends z.ZodRawShape, O, M extends Method, P extends string>(
        spec: Spec<N, S, O, Ctx> & { route: Route<M, P>; mcp?: boolean }
    ): Capability<N, S, O, Route<M, P>, Ctx>
    <N extends string, S extends z.ZodRawShape, O>(spec: Spec<N, S, O, Ctx> & { route?: undefined; mcp: true }): Capability<N, S, O, undefined, Ctx>
}

export class InputError extends Error {
    constructor(readonly issues: z.core.$ZodIssue[]) {
        super("invalid input")
    }
}

const build = (spec: Spec<string, z.ZodRawShape, unknown, unknown> & { route?: Route; mcp?: boolean }): AnyCapability<unknown> => ({
    name: spec.name,
    title: spec.title,
    description: spec.description,
    input: spec.input,
    route: spec.route,
    mcp: spec.mcp ?? false,
    run: async (raw, ctx) => {
        const parsed = z.object(spec.input).safeParse(raw)
        if (!parsed.success) throw new InputError(parsed.error.issues)
        return await spec.handler(parsed.data, ctx)
    }
})

/**
 * Binds the capability factory to the context every handler receives, so this package stays free of
 * application types while handlers keep a fully typed context.
 */
export const createCapability = <Ctx>(): CapabilityFactory<Ctx> => build as CapabilityFactory<Ctx>
