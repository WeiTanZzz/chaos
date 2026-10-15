import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import type { AnyCapability } from "./capability.ts"
import { createMcpServer, type ServerInfo } from "./mcp.ts"

export type StdioCall<Cap> = {
    capability: Cap
    surface: "stdio"
}

export type StdioOptions<Ctx, Cap extends AnyCapability<Ctx>> = {
    capabilities: readonly Cap[]
    /** One process serves one client, so the context is built once by the caller rather than per request. */
    context: Ctx
    info: ServerInfo
    /** Runs before every tool call. Throw to refuse. */
    authorize?: (capability: Cap, context: Ctx) => void | Promise<void>
    /** Wraps every tool call. */
    instrument?: <T>(call: StdioCall<Cap>, run: () => Promise<T>) => Promise<T>
}

/**
 * Serves the mcp capabilities over this process's stdin and stdout, for clients that launch the server
 * themselves. No Hono and no http: stdout belongs to the protocol, so log to stderr.
 */
export const serveStdio = async <Ctx, Cap extends AnyCapability<Ctx>>({
    capabilities,
    context,
    info,
    authorize,
    instrument = (_call, run) => run()
}: StdioOptions<Ctx, Cap>) => {
    const server = createMcpServer(capabilities, context, info, (capability, run) =>
        instrument({ capability, surface: "stdio" }, async () => {
            await authorize?.(capability, context)
            return await run()
        })
    )
    await server.connect(new StdioServerTransport())
    return server
}
