import index from "./index.html"

const apiUrl = process.env.API_URL ?? "http://localhost:4400"
// Stands in for the credential a real deployment would hold here. The demo lets the page pick a role so the
// policy is visible; production would ignore anything the browser claims and resolve identity itself.
const fallbackRole = process.env.ROLE ?? "member"

const proxy = async (request: Request) => {
    const url = new URL(request.url)
    const target = apiUrl + url.pathname + url.search
    const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.text()
    return fetch(target, {
        method: request.method,
        headers: {
            "content-type": request.headers.get("content-type") ?? "application/json",
            "x-role": request.headers.get("x-role") ?? fallbackRole
        },
        body
    })
}

const server = Bun.serve({
    port: Number(process.env.PORT ?? 4500),
    development: true,
    routes: {
        "/": index,
        "/api/*": proxy
    }
})

console.warn(`web on ${server.url} proxying /api -> ${apiUrl}`)
