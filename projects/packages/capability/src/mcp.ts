import { StreamableHTTPTransport } from "@hono/mcp"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { Context, Hono, MiddlewareHandler } from "hono"
import { every } from "hono/combine"
import { z } from "zod"
import type { AnyCapability } from "./capability.ts"
import { type Authorize, type ContextFactory, type Instrument, runDirectly } from "./http.ts"

export type ServerInfo = {
    name: string
    version: string
}

export const createMcpServer = <Ctx, Cap extends AnyCapability<Ctx>>(
    capabilities: readonly Cap[],
    ctx: Ctx,
    info: ServerInfo,
    call?: (capability: Cap, run: () => Promise<unknown>) => Promise<unknown>
) => {
    const server = new McpServer(info)
    for (const cap of capabilities.filter(cap => cap.mcp)) {
        // An object-shaped output can also be declared to the client; an array or a nullable cannot, because the
        // protocol's structuredContent has to be an object.
        const structured = cap.output instanceof z.ZodObject ? cap.output.shape : undefined
        server.registerTool(
            cap.name,
            {
                title: cap.title,
                description: cap.description,
                inputSchema: cap.input,
                ...(structured === undefined ? {} : { outputSchema: structured })
            },
            async args => {
                const run = () => cap.run(args, ctx)
                const result = await (call === undefined ? run() : call(cap, run))
                const content = [{ type: "text" as const, text: JSON.stringify(result) }]
                const structuredContent = structured === undefined ? undefined : z.record(z.string(), z.unknown()).parse(result)
                return structuredContent === undefined ? { content } : { content, structuredContent }
            }
        )
    }
    return server
}

export type McpOptions<Ctx> = {
    path: string
    capabilities: readonly AnyCapability<Ctx>[]
    context: ContextFactory<Ctx>
    info: ServerInfo
    /** Runs before the mcp endpoint only. */
    middleware?: MiddlewareHandler[]
    /**
     * Decides per request which capabilities this caller may see. An excluded capability is absent from
     * `tools/list` and unknown to `tools/call`. The package asks the question; the app answers it.
     */
    visibleTools?: (capability: AnyCapability<Ctx>, c: Context) => boolean | Promise<boolean>
    /** Runs before every tool call. Throw to refuse. */
    authorize?: Authorize<Ctx, AnyCapability<Ctx>>
    /** Wraps every tool call. */
    instrument?: Instrument<AnyCapability<Ctx>>
}

export const mountMcp = <Ctx>(
    app: Hono,
    { path, capabilities, context, info, middleware = [], visibleTools, authorize, instrument = runDirectly }: McpOptions<Ctx>
) => {
    const handler = async (c: Context) => {
        const visible =
            visibleTools === undefined
                ? capabilities
                : (await Promise.all(capabilities.map(async cap => ((await visibleTools(cap, c)) ? cap : undefined)))).filter(cap => cap !== undefined)
        const ctx = context(c)
        const server = createMcpServer(visible, ctx, info, async (capability, run) =>
            instrument({ capability, surface: "mcp", c }, async () => {
                await authorize?.(capability, ctx, c)
                return await run()
            })
        )
        const transport = new StreamableHTTPTransport()
        await server.connect(transport)
        return (await transport.handleRequest(c)) ?? c.body(null, 204)
    }
    if (middleware.length === 0) app.all(path, handler)
    else app.all(path, every(...middleware), handler)
    return app
}
