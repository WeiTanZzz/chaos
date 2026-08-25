import type { AddParam, ParamKeys, Schema } from "hono/types"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import type { JSONParsed } from "hono/utils/types"
import type { z } from "zod"
import type { AnyCapability } from "./capability.ts"

type UnionToIntersection<U> = (U extends unknown ? (arg: U) => void : never) extends (arg: infer I) => void ? I : never

type Body<C extends AnyCapability> = z.input<z.ZodObject<C["input"]>>

type QueryOf<C extends AnyCapability> = { [K in keyof Omit<Body<C>, ParamKeys<C["route"]["path"]>>]: string | string[] }

type InputOf<C extends AnyCapability> = C["route"]["method"] extends "get" | "delete"
    ? keyof QueryOf<C> extends never
        ? unknown
        : { query: QueryOf<C> }
    : { json: Body<C> }

type OutputOf<C extends AnyCapability> = JSONParsed<Awaited<ReturnType<C["run"]>>>

type CapabilitySchema<C extends AnyCapability> = C extends AnyCapability
    ? {
          [P in C["route"]["path"]]: {
              [M in `$${C["route"]["method"]}`]: {
                  input: AddParam<InputOf<C>, C["route"]["path"]>
                  output: OutputOf<C>
                  outputFormat: "json"
                  status: ContentfulStatusCode
              }
          }
      }
    : never

export type CapabilitiesSchema<Caps extends readonly AnyCapability[]> =
    UnionToIntersection<CapabilitySchema<Caps[number]>> extends infer S ? (S extends Schema ? S : never) : never
