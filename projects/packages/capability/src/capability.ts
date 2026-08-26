import type { MiddlewareHandler } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { z } from "zod"

export type Method = "get" | "post" | "put" | "patch" | "delete"

export type Route<M extends Method = Method, P extends string = string> = {
    method: M
    path: P
    /** Runs before the handler on this route only. HTTP surface only — an MCP tool call never passes through it. */
    middleware?: MiddlewareHandler[]
}

type Spec<N extends string, S extends z.ZodRawShape, O, Ctx, Meta> = {
    name: N
    title?: string
    description: string
    /** Opaque to this package: whatever the app wants to declare here, for its own `authorize` to act on. */
    meta?: Meta
    input: S
    /** Declares the response contract: it types the handler's return and documents the 200 response. */
    output?: z.ZodType<O>
    handler: (input: z.infer<z.ZodObject<S>>, ctx: Ctx) => Promise<O>
}

export type Capability<
    N extends string = string,
    S extends z.ZodRawShape = z.ZodRawShape,
    O = unknown,
    R extends Route | undefined = Route | undefined,
    Ctx = never,
    Meta = unknown
> = {
    name: N
    title?: string
    description: string
    meta: Meta | undefined
    input: S
    output: z.ZodType<O> | undefined
    route: R
    mcp: boolean
    run: (raw: unknown, ctx: Ctx) => Promise<O>
}

export type AnyCapability<Ctx = never, Meta = unknown> = Capability<string, z.ZodRawShape, unknown, Route | undefined, Ctx, Meta>

export type CapabilityFactory<Ctx, Meta = never> = {
    <N extends string, S extends z.ZodRawShape, O, M extends Method, P extends string>(
        spec: Spec<N, S, O, Ctx, Meta> & { route: Route<M, P>; mcp?: boolean }
    ): Capability<N, S, O, Route<M, P>, Ctx, Meta>
    <N extends string, S extends z.ZodRawShape, O>(spec: Spec<N, S, O, Ctx, Meta> & { route?: undefined; mcp: true }): Capability<N, S, O, undefined, Ctx, Meta>
}

/**
 * An error carrying the status the HTTP surface should answer with. The package never decides what is an error,
 * only how one is reported: handlers throw these, and both surfaces render them consistently.
 */
export class CapabilityError extends Error {
    constructor(
        readonly status: ContentfulStatusCode,
        message: string,
        readonly details?: unknown
    ) {
        super(message)
    }
}

export class InputError extends CapabilityError {
    constructor(issues: z.core.$ZodIssue[]) {
        super(400, "invalid input", issues)
    }
}

/**
 * Binds the capability factory to the context every handler receives, so this package stays free of
 * application types while handlers keep a fully typed context.
 */
export const createCapability = <Ctx, Meta = never>(): CapabilityFactory<Ctx, Meta> => {
    function capability<N extends string, S extends z.ZodRawShape, O, M extends Method, P extends string>(
        spec: Spec<N, S, O, Ctx, Meta> & { route: Route<M, P>; mcp?: boolean }
    ): Capability<N, S, O, Route<M, P>, Ctx, Meta>
    function capability<N extends string, S extends z.ZodRawShape, O>(
        spec: Spec<N, S, O, Ctx, Meta> & { route?: undefined; mcp: true }
    ): Capability<N, S, O, undefined, Ctx, Meta>
    function capability<N extends string, S extends z.ZodRawShape, O, M extends Method, P extends string>(
        spec: Spec<N, S, O, Ctx, Meta> & { route?: Route<M, P>; mcp?: boolean }
    ): Capability<N, S, O, Route<M, P> | undefined, Ctx, Meta> {
        return {
            name: spec.name,
            title: spec.title,
            description: spec.description,
            meta: spec.meta,
            input: spec.input,
            output: spec.output,
            route: spec.route,
            mcp: spec.mcp ?? false,
            run: async (raw, ctx) => {
                const parsed = z.object(spec.input).safeParse(raw)
                if (!parsed.success) throw new InputError(parsed.error.issues)
                return await spec.handler(parsed.data, ctx)
            }
        }
    }
    return capability
}
