import type { AddParam, ParamKeys, Schema } from "hono/types"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import type { JSONParsed } from "hono/utils/types"
import type { z } from "zod"
import type { AnyCapability, Method, Route } from "./capability.ts"

type UnionToIntersection<U> = (U extends unknown ? (arg: U) => void : never) extends (arg: infer I) => void ? I : never

type Body<C extends AnyCapability<never>> = z.input<z.ZodObject<C["input"]>>

type QueryOf<C extends AnyCapability<never>, P extends string> = { [K in keyof Omit<Body<C>, ParamKeys<P>>]: string | string[] }

type InputOf<C extends AnyCapability<never>, M extends Method, P extends string> = M extends "get" | "delete"
    ? keyof QueryOf<C, P> extends never
        ? unknown
        : { query: QueryOf<C, P> }
    : { json: Body<C> }

type OutputOf<C extends AnyCapability<never>> = JSONParsed<Awaited<ReturnType<C["run"]>>>

type CapabilitySchema<C extends AnyCapability<never>> = C extends { route: Route<infer M, infer P> }
    ? {
          [K in P]: {
              [K2 in `$${M}`]: {
                  input: AddParam<InputOf<C, M, P>, P>
                  output: OutputOf<C>
                  outputFormat: "json"
                  status: ContentfulStatusCode
              }
          }
      }
    : never

export type CapabilitiesSchema<Caps extends readonly AnyCapability<never>[]> =
    UnionToIntersection<CapabilitySchema<Caps[number]>> extends infer S ? (S extends Schema ? S : never) : never
