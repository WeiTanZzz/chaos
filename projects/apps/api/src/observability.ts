import type { AnyCapability, Call, Instrument } from "@chaos/capability"
import { CapabilityError } from "@chaos/capability"
import { type Span, SpanStatusCode, trace } from "@opentelemetry/api"
import type { Deps } from "./context.ts"

const tracer = trace.getTracer("@chaos/api")

const attributes = (call: Call<AnyCapability<Deps>>) => ({
    "capability.name": call.capability.name,
    "capability.surface": call.surface,
    ...(call.capability.route === undefined
        ? {}
        : { "http.request.method": call.capability.route.method.toUpperCase(), "http.route": call.capability.route.path }),
    ...(call.surface === "mcp" ? { "mcp.tool.name": call.capability.name } : {})
})

/**
 * One span per capability call, on either surface. Several tool calls inside a single POST /mcp become siblings
 * under that request's span, which is exactly what middleware could never express: it sees one request, not the
 * calls within it.
 *
 * `@opentelemetry/api` is a no-op until a provider is registered, so this costs nothing when tracing is off.
 * Registering the provider — and choosing an exporter, which is runtime-specific — is the entry point's job.
 */
const record = (span: Span, error: unknown) => {
    // A refusal is an outcome, not a fault: record it, but do not mark the span as an error.
    if (error instanceof CapabilityError) return span.setAttribute("capability.outcome", `refused.${error.status}`)
    span.setAttribute("capability.outcome", "failed")
    span.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.message : "unknown" })
    if (error instanceof Error) span.recordException(error)
}

/**
 * One span per capability call, on either surface. Several tool calls inside a single POST /mcp become siblings
 * under that request's span, which is exactly what middleware could never express: it sees one request, not the
 * calls within it.
 *
 * `@opentelemetry/api` is a no-op until a provider is registered, so this costs nothing when tracing is off.
 * Registering the provider — and choosing an exporter, which is runtime-specific — is the entry point's job.
 */
export const instrument: Instrument<AnyCapability<Deps>> = (call, run) =>
    tracer.startActiveSpan(`capability ${call.capability.name}`, { attributes: attributes(call) }, async span => {
        try {
            const result = await run()
            span.setStatus({ code: SpanStatusCode.OK })
            return result
        } catch (error) {
            record(span, error)
            throw error
        } finally {
            span.end()
        }
    })
