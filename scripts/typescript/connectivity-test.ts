type Stats = {
    total: number
    success: number
    failure: number
    latencies: number[]
}

type TargetConfig = {
    url: string
    // "2xx" = response.ok required; "non-5xx" = any origin response counts (e.g. a 404 from an API-only host still proves connectivity)
    okWhen: "2xx" | "non-5xx"
}

const config: { targets: TargetConfig[]; intervalMs: number; timeoutMs: number } = {
    targets: [],
    intervalMs: 1000,
    timeoutMs: 5000
}

const { intervalMs, timeoutMs } = config

type Target = {
    url: string
    okWhen: TargetConfig["okWhen"]
    label: string
    stats: Stats
    consecutiveFailures: number
    wasUp: boolean
}

const targets: Target[] = config.targets.map(targetConfig => ({
    url: targetConfig.url,
    okWhen: targetConfig.okWhen,
    label: new URL(targetConfig.url).host,
    stats: { total: 0, success: 0, failure: 0, latencies: [] },
    consecutiveFailures: 0,
    wasUp: true
}))

const labelWidth = Math.max(...targets.map(target => target.label.length))

const percentile = (params: { sorted: number[]; ratio: number }) => {
    const index = Math.min(params.sorted.length - 1, Math.floor(params.sorted.length * params.ratio))
    return params.sorted[index]
}

const printSummary = () => {
    for (const target of targets) {
        const { label, stats } = target
        const sorted = [...stats.latencies].sort((left, right) => left - right)
        console.log(`\n--- summary: ${label} ---`)
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
}

const exitWithSummary = () => {
    printSummary()
    process.exit(0)
}

process.on("SIGINT", exitWithSummary)
process.on("SIGTERM", exitWithSummary)

const probe = async (target: Target) => {
    const label = target.label.padEnd(labelWidth)
    while (true) {
        const startedAt = performance.now()
        target.stats.total += 1
        try {
            const response = await fetch(target.url, {
                signal: AbortSignal.timeout(timeoutMs),
                // force a fresh connection each probe so LB/network failures aren't hidden by keep-alive reuse
                headers: { connection: "close" }
            })
            const latency = Math.round(performance.now() - startedAt)
            const timestamp = new Date().toISOString()
            const isOk = target.okWhen === "2xx" ? response.ok : response.status < 500
            if (isOk) {
                target.stats.success += 1
                target.stats.latencies.push(latency)
                if (!target.wasUp) {
                    console.log(`${timestamp}  ${label}  *** RECOVERED after ${target.consecutiveFailures} failures ***`)
                }
                target.consecutiveFailures = 0
                target.wasUp = true
            } else {
                target.stats.failure += 1
                target.consecutiveFailures += 1
                target.wasUp = false
                console.log(`${timestamp}  ${label}  FAIL  ${response.status}  ${latency}ms`)
            }
        } catch (error) {
            const latency = Math.round(performance.now() - startedAt)
            const timestamp = new Date().toISOString()
            target.stats.failure += 1
            target.consecutiveFailures += 1
            if (target.wasUp) {
                console.log(`${timestamp}  ${label}  *** DOWN ***`)
            }
            target.wasUp = false
            const reason = error instanceof Error ? error.message : String(error)
            console.log(`${timestamp}  ${label}  FAIL  ${reason}  ${latency}ms`)
        }
        const elapsed = performance.now() - startedAt
        const remaining = intervalMs - elapsed
        if (remaining > 0) {
            await Bun.sleep(remaining)
        }
    }
}

console.log(`probing ${targets.map(target => target.url).join(", ")} every ${intervalMs}ms (timeout ${timeoutMs}ms), ctrl+c to stop\n`)

await Promise.all(targets.map(target => probe(target)))
