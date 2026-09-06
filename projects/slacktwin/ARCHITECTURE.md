# SlackTwin v2 — target architecture

Status: design baseline, 2026-09-06. Covers both repos under `projects/slacktwin/`:
[`dispatcher`](./dispatcher) (Slack-facing edge) and [`runtime`](./runtime)
(agent runtime). Decisions recorded here are settled; open items are listed at the end.

Note: `twin-runtime/docs/dispatcher-protocol.md` describes an OTP → JWT → ticket flow and a
`DispatchPayload { event_id, owner_user_id, context }` shape. The dispatcher source implements neither
(`POST /runtime/otp` → `/connect <code>` → `GET /runtime/ws?token=<runtimeId>`, payload `{ raw, enriched }`).
The source is authoritative; the doc is stale and is superseded by §3.7 below.

## 1. Goals and settled decisions

The product: an agent that observes everything a Slack user can see, learns how that user behaves, and
replies on their behalf, with human-in-the-loop (HITL) where the user wants it. Target user is any knowledge
worker, not only developers.

| Area | Decision |
| --- | --- |
| Reading | Always via the user's own token (user scopes). Bot tokens cannot see human-to-human DMs or channels the bot is not in. |
| Reply identity | Per-conversation policy, not global. Default: DMs and private channels reply as the user; public channels reply as the bot with a per-user persona. |
| HITL default | As-user identity: review every draft until the user loosens it. As-bot identity: auto with escalation. |
| HITL surface | Slack-native (bot DMs the owner with Block Kit actions) is the primary surface. Desktop modal is optional. |
| Escape hatches | Model-detected "counterpart wants the human / asks if this is AI" forces escalation and hands the thread over. Owner posting in a thread silences the agent there; resuming is explicit. |
| Non-negotiable rule | The agent never denies being an AI when asked. Not user-configurable. |
| Reply grace period | Configurable per conversation. Default 5 min for DMs, 0 for channels. Working-hours split off by default. |
| Deployment | Dispatcher: Cloudflare Workers and k8s (Bun + Redis) from one codebase behind ports. Runtime: local (Tauri) and hosted (one process per user). |
| Model runtime | Interface designed for a bare model with no file tools. Runtime owns tools and memory access. First adapter is Claude Code via MCP; OpenAI-compatible (llama.cpp / Qwen) follows for triage. |
| Silence | A first-class outcome. Most observed messages produce no reply. |
| Rewrite scope | Not a teardown. Dispatcher: auth model, ports, tagging, streams. Runtime: agent-run interface, tool registry, headless host, the 40 KB wiring file. Memory layout and UI panels are kept. |
| Repos | Private, bound as submodules under `chaos/projects/slacktwin/`. Bun is the toolchain everywhere (package manager, test runner, scripts); no pnpm, no vitest. |

## 2. System overview

```
             Slack (Events API, Web API, Block Kit)
                 │  user events (per authorized user)   ▲ post as user / as bot, DMs to owner
                 ▼                                      │
┌─────────────────────────────── dispatcher (edge) ────────────────────────────────┐
│  Hono app, slack-edge, zod.  Platform-agnostic core + Ports (§3.1)              │
│  install store · user credentials · session hub · otp · cache · sent-log ·      │
│  event buffer · rate limiter                                                     │
│  Cloudflare impl: KV + Durable Objects        Bun impl: Redis + Bun.serve ws     │
└──────────────────────────────┬──────────────────────────────────────────────────┘
                               │ WebSocket, protocol v2 (§3.7): observe / trigger / hitl / outbound
                               ▼
┌─────────────────────────── runtime-server (compute) ─────────────────────────────┐
│  one process per bound user                                                       │
│  core: policy → triage → draft → decision → grace → post   (§4.2)                │
│  tool registry (@chaos/capability) → MCP server for CLIs, direct for APIs (§4.4)  │
│  memory dir (filesystem is truth) · SQLite cache · episodes · learning (§5)       │
│  adapters: claude-code (MCP) · openai-compatible · anthropic                      │
│  local HTTP: web UI + control API                                                 │
└──────────────┬───────────────────────────────────────────────┬───────────────────┘
               │                                               │
       web UI in a browser (hosted)                 Tauri shell embedding server + UI (local)
```

Dispatcher and runtime stay separate services. The dispatcher is a thin, Slack-facing edge with Slack
credentials; the runtime is compute holding the user's memory and model credentials. They scale and are
trusted differently.

## 3. Dispatcher

### 3.1 Ports and platform adapters

Everything the dispatcher touches outside the request is behind an interface. The Hono app receives a `Ports`
object through its context factory instead of reading `c.env` bindings directly. Composition roots per platform
build the object; tests use in-memory implementations.

| Port | Responsibility | Cloudflare impl | Bun / k8s impl |
| --- | --- | --- | --- |
| `InstallStore` | team → bot token, bot user id | KV | Redis hash |
| `UserCredentialStore` | (team, user) → user token encrypted with AES-GCM (KEK from `Secrets`), granted scopes, authorized_at | KV, encrypted values | Redis, encrypted values |
| `OAuthStateStore` | single-use OAuth `state` bound to (team, user), 10 min TTL | KV | Redis |
| `SessionHub` | per-user `Session`: `connect` (upgrade), `isConnected`, `close`, `broadcast`, plus durable `state` (channels, team, runtime id) | `RuntimeSessionDO` with hibernation API | in-process registry over `Bun.serve` WebSockets + Redis pub/sub for multi-replica fan-out |
| `OtpStore` | single-use codes with TTL, pending bindings | `OtpStoreDO` | Redis `SET … EX`, `GETDEL` |
| `BindingStore` | runtime id → Slack user, for reconnects without a new code | KV | Redis |
| `SlackApi` | the subset of Slack's Web API the dispatcher calls, bound per token | slack-edge `SlackAPIClient` (fetch-based, shared by all platforms) | same |
| `Cache` | users, channels, authorizations, memberships with TTL | KV | Redis |
| `SentMessageLog` | (channel, ts) → { user, identity } for runtime-authored messages, TTL ≈ 24 h | DO storage | Redis with expiry |
| `EventBuffer` | per-user queue of events while runtime is offline, bounded, TTL | DO storage | Redis list |
| `RateLimiter` | per-IP sliding window | DO counters | Redis `INCR` + expiry |
| `Secrets` | signing secret, client id/secret, KEK for token encryption | Worker secrets | env / mounted secret |

Rules:

- Domain code under `src/slack/**` and `src/runtime/**` imports only `Ports` types, never `cloudflare:workers`,
  `KVNamespace`, `DurableObject*`, or `Bun.*`.
- `src/platform/cloudflare/`, `src/platform/bun/` and `src/platform/memory/` own the entry points (`wrangler`
  default export vs `Bun.serve`), the WebSocket upgrade mechanics, and the `Ports` construction. The memory
  platform backs the tests and doubles as a single-process dev server.
- Logic every platform needs identically (OTP codes, session state) is written once over a tiny `KeyValue`
  contract that Durable Object storage, a `Map` and Redis all satisfy; platforms wrap it, they do not reimplement it.
- slack-edge is fetch-based and runs unchanged on both platforms.
- Encryption at rest for user tokens: AES-GCM via WebCrypto with a key-encryption key from `Secrets`. Available on
  both platforms without a dependency.

The existing `RuntimeSessionDO` and `OtpStoreDO` become the Cloudflare implementations of `SessionHub` and
`OtpStore` and lose all Slack-posting logic, which moves into the domain layer.

### 3.2 Authorization model

Two layers, one Slack app:

1. **Workspace install** (existing). Bot scopes stay roughly as today plus `users.profile:write` is *not* needed
   here; the bot only needs to post in channels where it is a member, DM the owner for HITL, and read
   user/channel metadata. Add `reactions:read` for observing reactions in channels the bot is in (fallback only).
2. **Per-user authorization** (new). Each user runs `/connect` or clicks the App Home button and goes through
   OAuth v2 with `user_scope`. Requested user scopes:

   | Scope | Why |
   | --- | --- |
   | `channels:history`, `groups:history`, `im:history`, `mpim:history` | observe everything the user can see |
   | `channels:read`, `groups:read`, `im:read`, `mpim:read` | resolve conversation metadata |
   | `users:read` | resolve people |
   | `reactions:read` | reactions as behavioral signal |
   | `chat:write` | post as the user |
   | `reactions:write` | agent can react as the user (optional, off by default) |
   | `users.profile:write` | set the "AI replying" status marker |
   | `files:read` | attachments in observed messages |

   An app-level token (`xapp-`) with `authorizations:read` is required for `apps.event.authorizations.list`.

Token handling:

- User tokens live only in `UserCredentialStore`, encrypted at rest; the plaintext exists only inside a request.
  They never travel to the runtime. All Slack calls on behalf of the user are performed by the dispatcher.
- The user starts authorization from Slack (`/authorize`, or a button in the bot's DM); the dispatcher mints a
  single-use `state` bound to that Slack user and rejects a callback whose `authed_user.id` differs.
- Revocation (`tokens_revoked` event, `account_inactive` errors) deletes the credential and evicts the session
  with a distinct close code so the runtime shows "re-authorize".
- Binding a runtime to a user (OTP flow) stays as today, but the binding is `(team, user) → runtime_id`, not
  `user → runtime_id`, so one person in two workspaces is two bindings.

### 3.3 Ingest: user events, fan-out, two streams

Subscribe to user events (`message.channels`, `message.groups`, `message.im`, `message.mpim`,
`reaction_added`, `reaction_removed`, `member_joined_channel`, `member_left_channel`) in addition to the bot
events already subscribed.

**Fan-out.** A user event arrives once per team with a single entry in `authorizations`. Call
`apps.event.authorizations.list(event_context)` (cached by conversation for a few minutes) to obtain every
authorized user who can see the event, then deliver to each of their sessions. `membership.ts` and the
channel allowlist are removed; "can this user see this conversation" is now answered by Slack.

**Classification.** `classify.ts` stops returning `null` for subtypes. It produces one of:

| Stream | Kinds | Delivered to |
| --- | --- | --- |
| `observe` | `message`, `message_changed`, `message_deleted`, `reaction_added`, `reaction_removed`, `file_shared`, membership changes | every authorized user who can see it |
| `trigger` | `direct_message`, `mention`, `thread_reply_in_owner_thread`, `channel_message` | same recipients, marked as reply candidates |

Every event goes out on `observe`. A subset is additionally flagged as a `trigger` candidate. The runtime decides
whether to reply; the dispatcher never decides.

**Enrichment** stays (sender name, channel name, resolved mentions), performed with the recipient's own user
token so private names resolve correctly.

### 3.4 Authorship tagging and loop control

The dispatcher records every message it posts in `SentMessageLog` keyed by `(channel, ts)` with the owning
user and the identity used. On every inbound event whose sender is the recipient user, it sets:

```
authored_by: "human" | "runtime"
```

One field, four consumers:

- **Echo suppression**: the runtime ignores its own posts as triggers but still records them.
- **Loop control**: the dispatcher counts consecutive `runtime`-authored messages in a thread across all users
  and refuses to post past `BOT_ROUND_LIMIT`. This replaces `bot_id`-based detection, which no longer works when
  agents post as people.
- **Takeover detection**: a `human`-authored message from the owner in a thread flips that thread to
  `handed_over` in the runtime (§4.7).
- **Training filter**: only `human`-authored messages are learning samples (§5).

### 3.5 Outbound operations

The runtime → dispatcher message set grows from `send_message` to:

| Op | Notes |
| --- | --- |
| `post_message { conversation, thread_ts?, text, identity }` | `identity: { as: "user" } \| { as: "bot", persona?: { name, icon } }`. Dispatcher checks the identity is allowed for the conversation (bot must be a member; user must have authorized `chat:write`). |
| `update_message { conversation, ts, text }` | only for runtime-authored ts in `SentMessageLog` |
| `add_reaction { conversation, ts, name, identity }` | optional |
| `set_status { text, emoji, expires_at }` | the "AI replying" marker, cleared on takeover or idle |
| `hitl_request { request_id, kind, conversation, thread_ts, draft?, question?, options }` | dispatcher renders a Block Kit DM from the bot to the owner |
| `hitl_cancel { request_id }` | e.g. run timed out |
| `ack { event_id }` | lets the dispatcher drop buffered events |

Replies over 4000 characters are split by the runtime, as today.

### 3.6 HITL over Slack

A `hitl_request` becomes a DM from the bot to the owner containing the thread context, the draft (if any), the
agent's question (if escalating), and buttons: **Send**, **Edit & send** (opens a modal), **Reject**,
**Answer** (for escalations, opens a modal with a text input), **Take over** (marks the thread handed over).
Block action and view submission handlers translate to:

```
hitl_resolution { request_id, verdict: "send" | "send_edited" | "reject" | "answer" | "take_over", text?, reason? }
```

delivered to the runtime over the same WebSocket. If the runtime is offline the resolution is buffered like any
event. The desktop modal, when present, consumes the same `hitl_request` and produces the same resolution;
whichever surface answers first wins and the other is dismissed.

### 3.7 Wire protocol v2

All frames are JSON with a `type` discriminator and are zod-validated on both ends. Shared schemas live in a
small package published from the dispatcher repo (or vendored) so runtime and dispatcher cannot drift again.

Server → runtime:

```
{ type: "event",   event_id, team, owner, stream: "observe" | "trigger", kind, authored_by?, raw, enriched, thread?: { ts, context_ts[] } }
{ type: "hitl_resolution", request_id, verdict, text?, reason? }
{ type: "session", state: "replaced" | "reauthorize" | "revoked", detail? }
{ type: "result",  op_id, ok, ts?, error? }          // outcome of an outbound op
{ type: "pong" }
```

Runtime → server: the ops in §3.5 plus `{ type: "ping" }`, each carrying an `op_id`.

Binding and connection flow keeps the current shape (`POST /runtime/otp` with `RUNTIME_SECRET`, `/connect
<code>` in Slack, `GET /runtime/ws?token=<runtimeId>`) with two changes: the runtime id is minted client-side
and stable per install (already the case in twin-runtime), and reconnects present the same id.

### 3.8 Offline policy

- As-bot conversations: the dispatcher may post an offline notice, as today.
- As-user conversations: never post anything on the user's behalf while offline.
- All events for an offline user are appended to `EventBuffer` (bounded, e.g. 500 events / 24 h). On
  reconnect the dispatcher replays them with `replayed: true`; the runtime records them all and decides whether
  a trigger is still worth acting on given its age.

### 3.9 Deployment

One codebase, two entry points:

- **Cloudflare**: `wrangler deploy`, KV + DO bindings as today.
- **k8s**: a Bun container running the Bun platform adapter, Redis for every stateful port, a
  `Deployment` with N replicas behind an ingress; Redis pub/sub carries fan-out to whichever replica holds the
  user's socket. Private deployments create their own Slack app and set the same secrets.

The dispatcher never stores message content beyond the offline buffer and the sent-log. Both have TTLs.

## 4. Runtime

### 4.1 Packages

```
twin-runtime/
  core/          pure TS (existing) — policy, pipeline, memory, learning, protocol client
  tools/         tool registry: capabilities declared once with @chaos/capability
  adapters/      claude-code, openai-compatible, anthropic — implementations of AgentRunner
  server/        headless host: WS to dispatcher, local HTTP (control API + web UI), MCP endpoint, process/fs ops
  web/           React panels (moved out of desktop/src), served by server/
  desktop/       Tauri shell: starts server/, shows web/, tray, keychain, lockfile
```

`desktop/src/runtime/index.ts` is dissolved into `server/` (wiring) and `core/` (logic). No UI code talks to
`core` directly; it talks to the control API.

### 4.2 Per-event pipeline

```
event ──► record (raw/threads, SQLite) ──► policy (FlowRule v2, thread state)
     ──► triage (cheap model: reply? role? urgency?) ──► draft (AgentRunner with tools)
     ──► decision: reply | silent | escalate ──► review (per policy) ──► grace period
     ──► post (identity per policy) ──► record outcome
```

- `observe` events stop after *record* unless they change thread state (owner posted → `handed_over`).
- `trigger` events go through *policy*; a `skip` rule or a `handed_over` thread ends there.
- Triage runs on every remaining trigger. It is the cost control: a small or local model answers "should the
  owner reply to this, and in which role" from the thread, the reply-policy artifact (§5) and the conversation's
  config. Phase 1 may implement triage as a fixed rule set; the interface is the same.
- The grace period timer is cancelled if the owner posts first (takeover) or the counterpart posts again (the
  run is re-triggered with the new context).

### 4.3 AgentRunner interface

```ts
interface AgentRunInput {
  run_id: string
  instructions: string                 // composed system prompt (memory indexes inlined)
  conversation: Turn[]                 // thread history, newest last, with authored_by
  tools: ToolHandle                    // registry view for this run (§4.4)
  attachments?: LocalFile[]
  budget: { timeout_ms: number; max_tokens?: number; max_tool_calls?: number }
  signal: AbortSignal
}

type AgentEvent =
  | { kind: "started" }
  | { kind: "text_delta"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool_call"; call_id: string; name: string; args: unknown }
  | { kind: "tool_result"; call_id: string; ok: boolean; summary: string }
  | { kind: "decision"; outcome: Decision; metrics?: Metrics }   // exactly once, terminal
  | { kind: "error"; error: string; metrics?: Metrics }          // terminal

type Decision =
  | { type: "reply"; text: string; identity?: "user" | "bot" }
  | { type: "silent"; reason: string }
  | { type: "escalate"; reason: string; question: string; draft?: string }

interface AgentRunner {
  describe(): { id: string; displayName: string; drivesToolLoop: boolean }
  run(input: AgentRunInput): AsyncIterable<AgentEvent>
  cancel(run_id: string): Promise<void>
}
```

The terminal `decision` is produced by the runtime, not parsed out of prose: it is whichever of
`propose_reply`, `stay_silent`, or `request_human_input` the model called last. A run that ends without calling
any of them is treated as `silent` with reason `no_decision` and logged as such. This removes the
`<escalate …/>` regex and the "final text is the reply" assumption.

`drivesToolLoop` distinguishes the two families:

- **API adapters** (`drivesToolLoop: false`): the runtime runs the loop. Model returns tool calls, the runtime
  executes them through the registry, feeds results back, repeats until a terminal tool is called or the budget
  is exhausted.
- **CLI adapters** (`drivesToolLoop: true`): the CLI runs its own loop. The runtime hands it the MCP endpoint
  for this run; tool calls arrive at the registry over MCP and are echoed into the event stream as `tool_call`
  / `tool_result` for logging. The Claude Code adapter passes `--mcp-config` pointing at the local server and
  `--allowedTools` restricted to the registry's tools plus read-only file tools.

### 4.4 Tool registry

Tools are declared once with `@chaos/capability` from `chaos/projects/packages/capability`: a zod input shape,
optional output schema, handler, `mcp: true`. The registry gives each run a `ToolHandle` scoped to
`{ run_id, owner, conversation }` so a tool cannot act outside its run. Two surfaces come from the same
declaration:

- an MCP server (Streamable HTTP on localhost, per-run bearer token) for CLI adapters;
- direct invocation for API adapters.

Core tools:

| Tool | Behaviour |
| --- | --- |
| `memory_search { query, layers?, limit }` | FTS5 over `patterns/`, `notes/`, `facts/`, `raw/threads/`; returns snippets with paths |
| `memory_read { path }` | read one memory file; path-jailed to the memory root |
| `slack_lookup { user_id \| channel_id }` | resolve names and metadata from the runtime's cache (populated by enrichment) |
| `thread_history { conversation, thread_ts, limit }` | the recorded thread, including runtime-authored turns |
| `propose_reply { text }` | terminal; records the draft |
| `stay_silent { reason }` | terminal |
| `request_human_input { reason, question, draft? }` | terminal from the model's point of view; the runtime raises HITL and, on `answer`, starts a continuation run with the answer appended |

Terminal tools end the run rather than block inside it. This keeps CLI processes short-lived and makes
continuation identical for both adapter families. Every tool call and result is appended to the task record
under `raw/tasks/`.

The remaining system-prompt sections (`identity.md`, `escalation.md`, thread format) are kept but rewritten to
describe the tools instead of the XML protocol; `memory-layout.md` describes `memory_search` instead of
`--add-dir`.

### 4.5 Adapters

| Adapter | Family | Phase |
| --- | --- | --- |
| `claude-code` | CLI via MCP | 1 |
| `openai-compatible` | API (llama.cpp on k8s, OpenAI, others) | 2, first as triage model |
| `anthropic` | API | 3 |

Per-conversation `adapter` selection lives in FlowRule v2; `triage_adapter` is a runtime-wide setting.

### 4.6 Conversation policy (FlowRule v2)

Stored as `policy/conversations.json` in the memory root (filesystem is truth), edited through the UI.

```ts
interface ConversationRule {
  match: { conversation?: string; kind?: "dm" | "mpim" | "private" | "public"; default?: true }
  action: "skip" | "observe_only" | "reply"
  identity: "user" | "bot"
  review: "every_reply" | "escalation_only" | "none"
  grace_seconds: number
  active_hours?: { tz: string; windows: [start, end][] }   // outside windows → observe_only unless overridden
  role?: string                                              // persona overlay set (existing roles/)
  adapter?: string
  status_marker: boolean
  react_as_user: boolean
}
```

Defaults shipped:

| Match | action | identity | review | grace |
| --- | --- | --- | --- | --- |
| `kind: dm`, `mpim`, `private` | reply | user | every_reply | 300 s |
| `kind: public` | reply | bot | escalation_only | 0 |

Hard rule outside the schema: if the counterpart asks whether they are talking to an AI or asks for the human,
the run must end in `request_human_input` and the thread flips to `handed_over`. Implemented in the fixed part
of the system prompt and enforced by a post-check on the transcript.

### 4.7 Thread state

```
auto ──(owner human-authored post | escalation | "take_over")──► handed_over ──(explicit resume)──► auto
```

- `handed_over` suppresses triage and drafting for that thread; observation continues.
- Resume is a reaction by the owner on any message in the thread (configurable emoji, default `:robot_face:`)
  or a button in the UI / HITL DM.
- State is persisted in SQLite and rebuilt from the task log if the cache is lost.

### 4.8 Memory

The existing layout stays (`system/`, `patterns/`, `notes/`, `facts/`, `raw/`, `db/`). Additions:

```
policy/
  conversations.json        # FlowRule v2
  reply-policy.md           # learned behavioural policy (§5), structured
episodes/
  <YYYY-MM>/<slug>.jsonl    # extracted episodes for learning
```

`raw/threads/` now records everything observed, so it grows faster. Retention is configurable per layer:
`raw/` keeps a rolling window (default 90 days), `episodes/` and distilled layers are kept.

## 5. Learning

### 5.1 Signals, ranked

| Signal | Source | Use |
| --- | --- | --- |
| Owner's human-authored reply with the context it answered | `observe` events, `authored_by: human` | gold (context → reply) pairs for style, content, and timing |
| Owner edits a runtime-authored message | `message_changed` on a `SentMessageLog` ts | precise correction |
| HITL `send_edited`, `reject`, `answer` | `hitl_resolution` | correction with reason |
| Takeover during grace period | thread state transition | agent should have stayed quiet, or trust is low here |
| Owner reactions given | `reaction_added` | weak preference |
| Owner did not reply | thread closes with no owner turn | negative sample for triage: when not to reply |

### 5.2 Episodes

A thread is closed when idle for N hours (default 6). On close, an extractor writes one episode per owner
decision point:

```jsonl
{ "thread": "...", "at": "...", "context": [...turns before], "owner_action": "replied" | "ignored" | "reacted",
  "owner_text": "...", "latency_s": 412, "agent_outcome": "silent" | "replied" | "escalated" | "taken_over",
  "corrections": [...], "conversation_kind": "dm", "counterpart": "U..." }
```

Episodes are the single input to distillation and to evaluation. Raw threads remain the audit trail.

### 5.3 Distillation

- Runs nightly (or on demand) over episodes since the last watermark, per topic file, as sketched in the existing
  `distillation.md` v0.2. Drafts still land as `_distill_<iso>.md`; the owner promotes them.
- New structured artifact `policy/reply-policy.md`: who the owner replies to, in which conversations, how fast,
  what they ignore, when they hand off. Rendered as tables, consumed by triage.
- `notes/` proposals from repeated corrections (existing v0.4 idea) stay as drafts.

### 5.4 Evaluation and trust

Replay: take episodes where the owner replied, run the current agent on the same context with posting
disabled, compare the draft to the owner's actual reply (LLM judge on intent and tone, plus owner spot checks).
Report per conversation kind and per counterpart. This number is shown next to the `review` setting in the UI so
loosening HITL is an informed decision.

### 5.5 Privacy and retention

- `raw/` contains other people's messages. Local mode: stays on the user's machine. Hosted mode: per-user
  volume, encrypted at rest, no cross-user access path in code.
- The dispatcher retains no message content beyond TTL'd buffers.
- Retention windows are configurable; deletion of a conversation from the UI removes its raw threads, episodes
  and cache rows, and is logged.

## 6. Deployment forms

| | Local | Hosted |
| --- | --- | --- |
| Host | Tauri shell embedding `server/` | one container per user running `server/` |
| Availability | while the machine is on; offline buffer covers gaps | always on |
| UI | Tauri window showing `web/` | `web/` over HTTPS behind auth |
| HITL | Slack DM (primary) + desktop modal | Slack DM |
| Model credentials | user's own CLI login / API key in keychain | per-user secret mounted into the container |
| Local tools (files, scripts) | available | not available in phase 1 |
| Memory | local directory, git-syncable | per-user volume |

A hosted-mode extension for local tools (a small MCP endpoint on the user's machine that the hosted runtime can
call through a tunnel) is deferred.

## 7. Migration plan

Phases are ordered by dependency. Each has an exit criterion that can be tested without the later phases.

### Phase 1 — dispatcher: ports, user auth, streams, tagging

Repo: `slack-dispatcher`.

1. Introduce `Ports` and move all KV/DO access behind them; Cloudflare implementations wrap existing code.
   In-memory implementations for tests. Exit: current behaviour unchanged, tests green against in-memory ports.
   **Done 2026-09-06** on `feature/ports`, together with the move to Bun.
2. Add per-user OAuth with `user_scope`, `UserCredentialStore` with encryption, `tokens_revoked` handling.
   **Done 2026-09-06** (dispatcher PR #7).
3. Subscribe to user events; implement `apps.event.authorizations.list` fan-out; delete `membership.ts` and the
   channel allowlist. **Done 2026-09-06** (dispatcher PR #9; the posting allowlist stays for bot identity).
4. Rewrite `classify.ts` for `observe` / `trigger` and subtypes; add `SentMessageLog` and `authored_by`.
   **Done 2026-09-06** (PR #9 for the log and tagging, PR #12 for the observe stream).
5. Protocol v2 frames and shared schema package; outbound ops incl. `identity`; `EventBuffer`. Schemas landed as
   `src/protocol/v2.ts` (dispatcher PR #10, 2026-09-06); v1 runtimes stay supported until they send `hello`.
   **Done 2026-09-06** (PR #11: negotiation, event frames, offline buffer, outbound ops, loop control).
6. HITL DM rendering and `hitl_resolution`.
7. Bun platform adapter with Redis; k8s manifests under `chaos/stacks/`. **Platform done 2026-09-06** (dispatcher
   PR #8); manifests pending.

Exit: a runtime stub connected over protocol v2 receives every event the user can see with correct
`authored_by`, can post as user and as bot, and receives HITL resolutions from Slack buttons.

### Phase 2 — runtime core: agent run, registry, silence

Repo: `twin-runtime`. Toolchain already moved to Bun (runtime PR #7, 2026-09-06).

1. `tools/` registry on `@chaos/capability`; MCP server; the seven core tools. **Done 2026-09-06** (runtime PR #8;
   the capability package is vendored as `packages/capability`).
2. `AgentRunner` interface; Claude Code adapter via MCP; delete `parseEscalate` and text-as-reply.
3. Pipeline (§4.2) with FlowRule v2, thread state, grace timer. Triage as rule set first.
4. Protocol v2 client replacing `transport.ts`; record `observe` events.
5. Rewrite `system/*.md` defaults for the tool-based protocol.

Exit: with the desktop app still as host, the twin observes all traffic, stays silent by default, replies in
configured conversations with the configured identity, and escalates via tool calls.

### Phase 3 — headless server and web UI

1. `server/` package: WS client, control API, static `web/`, process/fs ops for Node/Bun.
2. Move React panels to `web/`; they consume the control API only.
3. Container image; hosted deployment of one user under `chaos/stacks/`.
4. Tauri becomes a shell around `server/` + `web/`.

Exit: the same build runs as a container and inside Tauri.

### Phase 4 — learning

1. Episode extraction on thread close.
2. Incremental distillation over episodes; `policy/reply-policy.md`.
3. OpenAI-compatible adapter; triage on the local Qwen deployment.
4. Replay evaluation and trust display.

### Phase 5 — polish

Status marker automation, reactions as user, per-conversation adapter choice, Anthropic API adapter, retention
tooling.

## 8. Open questions

1. **Shared protocol package**: publish from the dispatcher repo to a private registry, or vendor the schema
   file into the runtime with a checksum test. Vendoring is simpler for two private repos.
2. **Triage model contract**: structured output (JSON: reply/skip, role, urgency) is required; confirm the
   llama.cpp server's grammar / JSON-schema mode is used rather than prompt-only.
3. **Hosted authentication for the web UI**: per-user secret link, OIDC, or Slack sign-in via the dispatcher.
4. **Enterprise Grid**: org-wide installs and `authorizations.list` behaviour differ; out of scope until a Grid
   workspace is available for testing.
5. **Episode extraction model**: deterministic (rule-based from events) is preferred for auditability; confirm
   nothing in §5.2 needs an LLM.
