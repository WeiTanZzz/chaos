type Stats = {
    total: number
    success: number
    failure: number
    latencies: number[]
}

const config = {
    url: "https://your-api.example.com/healthz",
    intervalMs: 1000,
    timeoutMs: 5000
}

const { url, intervalMs, timeoutMs } = config

const stats: Stats = { total: 0, success: 0, failure: 0, latencies: [] }
let consecutiveFailures = 0
let wasUp = true

const percentile = (params: { sorted: number[]; ratio: number }) => {
    const index = Math.min(params.sorted.length - 1, Math.floor(params.sorted.length * params.ratio))
    return params.sorted[index]
}

const printSummary = () => {
    const sorted = [...stats.latencies].sort((left, right) => left - right)
    console.log("\n--- summary ---")
    console.log(`total: ${stats.total}  success: ${stats.success}  failure: ${stats.failure}`)
    if (stats.total > 0) {
        console.log(`availability: ${((stats.success / stats.total) * 100).toFixed(2)}%`)
    }
    if (sorted.length > 0) {
        const p50 = percentile({ sorted, ratio: 0.5 })
        const p95 = percentile({ sorted, ratio: 0.95 })
        const max = sorted[sorted.length - 1]
        console.log(`latency: p50=${p50}ms  p95=${p95}ms  max=${max}ms`)
    }
}

process.on("SIGINT", () => {
    printSummary()
    process.exit(0)
})

console.log(`probing ${url} every ${intervalMs}ms (timeout ${timeoutMs}ms), ctrl+c to stop\n`)

while (true) {
    const startedAt = performance.now()
    stats.total += 1
    try {
        const response = await fetch(url, {
            signal: AbortSignal.timeout(timeoutMs),
            // force a fresh connection each probe so LB/network failures aren't hidden by keep-alive reuse
            headers: { connection: "close" }
        })
        const latency = Math.round(performance.now() - startedAt)
        const timestamp = new Date().toISOString()
        if (response.ok) {
            stats.success += 1
            stats.latencies.push(latency)
            if (!wasUp) {
                console.log(`${timestamp}  *** RECOVERED after ${consecutiveFailures} failures ***`)
            }
            consecutiveFailures = 0
            wasUp = true
            console.log(`${timestamp}  OK    ${response.status}  ${latency}ms`)
        } else {
            stats.failure += 1
            consecutiveFailures += 1
            wasUp = false
            console.log(`${timestamp}  FAIL  ${response.status}  ${latency}ms`)
        }
    } catch (error) {
        const latency = Math.round(performance.now() - startedAt)
        const timestamp = new Date().toISOString()
        stats.failure += 1
        consecutiveFailures += 1
        if (wasUp) {
            console.log(`${timestamp}  *** DOWN ***`)
        }
        wasUp = false
        const reason = error instanceof Error ? error.message : String(error)
        console.log(`${timestamp}  FAIL  ${reason}  ${latency}ms`)
    }
    const elapsed = performance.now() - startedAt
    const remaining = intervalMs - elapsed
    if (remaining > 0) {
        await Bun.sleep(remaining)
    }
}
