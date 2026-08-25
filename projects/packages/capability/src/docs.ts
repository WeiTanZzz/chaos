import type { Hono } from "hono"
import type { AnyCapability } from "./capability.ts"
import type { ServerInfo } from "./mcp.ts"
import { toOpenApi } from "./openapi.ts"

const page = (openapiPath: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>API reference</title>
<style>
:root { --bg:#fff; --fg:#111827; --muted:#6b7280; --line:#e5e7eb; --card:#f9fafb; --accent:#2563eb; }
@media (prefers-color-scheme: dark) { :root { --bg:#0b0f19; --fg:#e5e7eb; --muted:#9ca3af; --line:#1f2937; --card:#111827; --accent:#60a5fa; } }
* { box-sizing: border-box }
body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif }
main { max-width:900px; margin:0 auto; padding:48px 24px 96px }
h1 { font-size:28px; margin:0 0 4px } h2 { font-size:15px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); margin:48px 0 16px }
.sub { color:var(--muted); margin:0 0 8px }
.op { border:1px solid var(--line); border-radius:10px; margin-bottom:12px; background:var(--card); overflow:hidden }
.op > summary { cursor:pointer; padding:14px 16px; display:flex; gap:12px; align-items:center; list-style:none }
.op > summary::-webkit-details-marker { display:none }
.method { font:600 12px/1 ui-monospace,SFMono-Regular,Menlo,monospace; padding:5px 8px; border-radius:5px; color:#fff; letter-spacing:.04em }
.get{background:#2563eb} .post{background:#16a34a} .put{background:#ca8a04} .patch{background:#ca8a04} .delete{background:#dc2626} .tool{background:#7c3aed}
code, .path { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:13.5px }
.desc { color:var(--muted); font-size:13.5px; margin-left:auto; text-align:right }
.body { padding:0 16px 16px; border-top:1px solid var(--line) }
table { width:100%; border-collapse:collapse; margin-top:12px; font-size:13.5px }
th { text-align:left; color:var(--muted); font-weight:500; padding:6px 8px 6px 0; border-bottom:1px solid var(--line) }
td { padding:7px 8px 7px 0; border-bottom:1px solid var(--line); vertical-align:top }
.req { color:#dc2626; font-size:11px; margin-left:6px } .in { color:var(--muted); font-size:12px }
pre { background:var(--bg); border:1px solid var(--line); border-radius:8px; padding:12px; overflow:auto; font-size:12.5px; margin:12px 0 0 }
a { color:var(--accent) }
.empty { color:var(--muted); font-size:13.5px; margin-top:12px }
</style>
</head>
<body>
<main>
  <h1 id="title">API reference</h1>
  <p class="sub" id="version"></p>
  <p class="sub">Schema: <a href="${openapiPath}">${openapiPath}</a></p>
  <h2>HTTP endpoints</h2>
  <div id="http"></div>
  <h2 id="mcp-heading">MCP tools</h2>
  <p class="sub" id="mcp-sub"></p>
  <div id="mcp"></div>
</main>
<script type="module">
const el = (tag, props = {}, children = []) => {
    const node = Object.assign(document.createElement(tag), props)
    for (const child of [children].flat()) node.append(child)
    return node
}

const paramRows = operation => {
    const rows = (operation.parameters ?? []).map(p => [p.name, p.in, p.schema, p.required])
    const body = operation.requestBody?.content?.["application/json"]?.schema
    for (const [name, schema] of Object.entries(body?.properties ?? {})) rows.push([name, "body", schema, (body.required ?? []).includes(name)])
    return rows
}

const describe = schema => {
    if (!schema) return "any"
    const base = schema.type ?? (schema.anyOf ? schema.anyOf.map(s => s.type).join(" | ") : "any")
    const extra = [schema.format, schema.enum?.join("|"), schema.minimum !== undefined ? "min " + schema.minimum : null,
        schema.maximum !== undefined ? "max " + schema.maximum : null, schema.minLength ? "minLength " + schema.minLength : null,
        schema.default !== undefined ? "default " + JSON.stringify(schema.default) : null].filter(Boolean)
    return extra.length ? base + " (" + extra.join(", ") + ")" : base
}

const table = rows => {
    if (rows.length === 0) return el("p", { className: "empty", textContent: "No input." })
    const head = el("tr", {}, [el("th", { textContent: "Name" }), el("th", { textContent: "In" }), el("th", { textContent: "Type" })])
    const body = rows.map(([name, where, schema, required]) =>
        el("tr", {}, [
            el("td", {}, [el("code", { textContent: name }), required ? el("span", { className: "req", textContent: "required" }) : ""]),
            el("td", { className: "in", textContent: where }),
            el("td", {}, el("code", { textContent: describe(schema) }))
        ]))
    return el("table", {}, [head, ...body])
}

const operationCard = (path, method, operation) => {
    const summary = el("summary", {}, [
        el("span", { className: "method " + method, textContent: method.toUpperCase() }),
        el("span", { className: "path", textContent: path }),
        el("span", { className: "desc", textContent: operation["x-mcp-tool"] ? "also mcp tool" : "" })
    ])
    const body = el("div", { className: "body" }, [
        el("p", { className: "sub", textContent: operation.description ?? "" }),
        table(paramRows(operation))
    ])
    return el("details", { className: "op" }, [summary, body])
}

const toolCard = tool => {
    const summary = el("summary", {}, [
        el("span", { className: "method tool", textContent: "TOOL" }),
        el("span", { className: "path", textContent: tool.name }),
        el("span", { className: "desc", textContent: tool.route ?? "mcp only" })
    ])
    const rows = Object.entries(tool.inputSchema?.properties ?? {}).map(([name, schema]) =>
        [name, "argument", schema, (tool.inputSchema.required ?? []).includes(name)])
    const body = el("div", { className: "body" }, [
        el("p", { className: "sub", textContent: tool.description ?? "" }),
        table(rows),
        el("pre", { textContent: JSON.stringify(tool.inputSchema, null, 2) })
    ])
    return el("details", { className: "op" }, [summary, body])
}

const doc = await (await fetch("${openapiPath}")).json()
document.title = doc.info.title + " API"
document.getElementById("title").textContent = doc.info.title
document.getElementById("version").textContent = "OpenAPI " + doc.openapi + " · version " + doc.info.version

const http = document.getElementById("http")
for (const [path, methods] of Object.entries(doc.paths))
    for (const [method, operation] of Object.entries(methods)) http.append(operationCard(path, method, operation))

const mcp = doc["x-mcp"]
document.getElementById("mcp-sub").textContent = mcp ? mcp.transport + " at " + mcp.endpoint : ""
const tools = document.getElementById("mcp")
for (const tool of mcp?.tools ?? []) tools.append(toolCard(tool))
</script>
</body>
</html>`

export type DocsOptions<Ctx> = {
    capabilities: readonly AnyCapability<Ctx>[]
    info: ServerInfo
    mcpPath: string
    openapiPath: string
    docsPath: string
}

export const mountDocs = <Ctx>(app: Hono, { capabilities, info, mcpPath, openapiPath, docsPath }: DocsOptions<Ctx>) => {
    const document = toOpenApi(capabilities, info, mcpPath)
    app.get(openapiPath, c => c.json(document))
    app.get(docsPath, c => c.html(page(openapiPath)))
    return app
}
