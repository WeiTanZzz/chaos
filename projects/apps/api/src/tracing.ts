import { trace } from "@opentelemetry/api"
import { BasicTracerProvider, ConsoleSpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base"
import { config } from "./config.ts"

/**
 * Choosing an exporter is the one runtime-specific part of tracing — OTLP over http on a server, a Workers
 * exporter on Cloudflare — so it lives in the entry point rather than in the app or the package. Without this
 * call the OTel API stays a no-op and `instrument` costs nothing.
 */
export const startTracing = () => {
    if (!config.tracing) return
    const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(new ConsoleSpanExporter())] })
    trace.setGlobalTracerProvider(provider)
    console.warn("tracing: spans go to the console; swap ConsoleSpanExporter for an OTLP exporter to ship them")
}
