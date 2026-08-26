import type { Hono } from "hono"
import { z } from "zod"
import type { AnyCapability, Method } from "./capability.ts"
import type { ServerInfo } from "./mcp.ts"

const pathParams = (path: string) =>
    path
        .split("/")
        .filter(segment => segment.startsWith(":"))
        .map(segment => segment.slice(1))

const toOpenApiPath = (path: string) => path.replace(/:([^/]+)/g, "{$1}")

const inputSchema = (cap: AnyCapability<never>) => z.toJSONSchema(z.object(cap.input), { io: "input" })

const jsonResponses = (cap: AnyCapability<never>) => ({
    "200": {
        description: "Capability result",
        content: { "application/json": cap.output === undefined ? {} : { schema: z.toJSONSchema(cap.output, { io: "output" }) } }
    },
    "400": {
        description: "The capability refused the request (validation, authorisation, anything a handler throws)",
        content: {
            "application/json": {
                schema: { type: "object", properties: { error: { type: "string" }, issues: { type: "array", items: { type: "object" } } } }
            }
        }
    }
})

const operation = (cap: AnyCapability<never>, method: Method, path: string) => {
    const schema = inputSchema(cap)
    const properties = schema.properties ?? {}
    const required = new Set(schema.required ?? [])
    const inPath = new Set(pathParams(path))
    const carriesBody = method !== "get" && method !== "delete"

    const parameters = Object.entries(properties)
        .filter(([name]) => inPath.has(name) || !carriesBody)
        .map(([name, value]) => ({ name, in: inPath.has(name) ? "path" : "query", required: inPath.has(name) || required.has(name), schema: value }))

    const bodyProperties = Object.fromEntries(Object.entries(properties).filter(([name]) => carriesBody && !inPath.has(name)))

    return {
        operationId: cap.name,
        summary: cap.title ?? cap.name,
        description: cap.description,
        ...(cap.mcp ? { "x-mcp-tool": cap.name } : {}),
        ...(parameters.length > 0 ? { parameters } : {}),
        ...(Object.keys(bodyProperties).length > 0
            ? {
                  requestBody: {
                      required: true,
                      content: {
                          "application/json": {
                              schema: { type: "object", properties: bodyProperties, required: [...required].filter(name => !inPath.has(name)) }
                          }
                      }
                  }
              }
            : {}),
        responses: jsonResponses(cap)
    }
}

export type OpenApiOptions<Ctx> = {
    capabilities: readonly AnyCapability<Ctx>[]
    info: ServerInfo
    mcpPath: string
    basePath?: string
    /** Only documents what is actually mounted. */
    surfaces?: { http?: boolean; mcp?: boolean }
}

export const toOpenApi = <Ctx>({ capabilities, info, mcpPath, basePath = "", surfaces = {} }: OpenApiOptions<Ctx>) => {
    const { http = true, mcp = true } = surfaces
    const prefix = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath
    const caps: readonly AnyCapability<never>[] = capabilities
    const paths: Record<string, Record<string, unknown>> = {
        "/health": {
            get: { operationId: "health", summary: "Health check", responses: { "200": { description: "Service is up", content: { "application/json": {} } } } }
        }
    }
    for (const cap of http ? caps : []) {
        const route = cap.route
        if (route === undefined) continue
        const path = `${prefix}${toOpenApiPath(route.path)}`
        paths[path] = { ...paths[path], [route.method]: operation(cap, route.method, route.path) }
    }
    return {
        openapi: "3.1.0",
        info: { title: info.name, version: info.version },
        paths,
        ...(mcp
            ? {
                  "x-mcp": {
                      endpoint: mcpPath,
                      transport: "streamable-http",
                      tools: caps
                          .filter(cap => cap.mcp)
                          .map(cap => ({
                              name: cap.name,
                              title: cap.title ?? cap.name,
                              description: cap.description,
                              inputSchema: inputSchema(cap),
                              route: cap.route === undefined || !http ? null : `${cap.route.method.toUpperCase()} ${prefix}${cap.route.path}`
                          }))
                  }
              }
            : {})
    }
}

export const mountOpenApi = <Ctx>(app: Hono, path: string, options: OpenApiOptions<Ctx>) => {
    const document = toOpenApi(options)
    app.get(path, c => c.json(document))
    return app
}
