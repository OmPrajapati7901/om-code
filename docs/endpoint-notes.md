# Endpoint notes — LRN-01 spike (Groq OpenAI-compatible)

- **Date:** 2026-09-05 · **Author:** spike run from macOS arm64, Node 26
- **Base URL:** `https://api.groq.com/openai/v1`
- **Model:** `qwen/qwen3.8-27b` (verified present via `GET /v1/models`)
- **Credential:** read from `GROQ_API_KEY` env var (local `.env`, untracked, never committed).
  No credential appears in this file or in any capture.
- **Spike script:** `tmp/lrn01-spike.mjs` — retained on disk untracked per developer
  request, **not committed** (deviation from AC-1.6 recorded; the commit contains
  no source code, only this note).

## AC-1.1 — Plain-text streaming shape (verbatim)

`POST /chat/completions` with `"stream": true` returns
`200` + `Content-Type: text/event-stream`. Body is SSE: one `data: <json>` line
per chunk, blank line separators, terminated by a literal `data: [DONE]` line.
A 16-token reply ("1..8, one per line") arrived as **18 data events, 16 with
`delta.content`** — true per-token streaming, not buffered whole.

First chunk (role only, empty content):

```text
data: {"id":"chatcmpl-eb726b0a-4767-4210-b7cb-a0eab644acf0","object":"chat.completion.chunk","created":1788653281,"model":"qwen/qwen3.8-27b","system_fingerprint":"fp_c7e30c203c","choices":[{"index":0,"delta":{"role":"assistant","content":""},"logprobs":null,"finish_reason":null}],"x_groq":{"id":"req_01m1t0p8hqed8rkpdv95zyzk1d","seed":1106560158}}
```

Mid-stream chunk (one token):

```text
data: {"id":"chatcmpl-eb726b0a-4767-4210-b7cb-a0eab644acf0","object":"chat.completion.chunk","created":1788653281,"model":"qwen/qwen3.8-27b","system_fingerprint":"fp_c7e30c203c","choices":[{"index":0,"delta":{"content":"1"},"logprobs":null,"finish_reason":null}]}
```

Final chunk carries `finish_reason: "stop"` **and** the usage object (see AC-1.3),
then `data: [DONE]`. Every chunk repeats the same `id` (`chatcmpl-…`).

## AC-1.2 — Forced tool-call streaming shape (verbatim)

Request with `tools: [get_weather]` + `tool_choice: {type: function,
function: {name: get_weather}}` returned 4 data events:

1. role-only chunk (`delta: {"role":"assistant","content":null}`)
2. **one** `delta.tool_calls` chunk with the **complete** call —
   `id`, `type: "function"`, full `function.name` and full `arguments`
   in a single fragment (`index: 0`):

```text
data: {"id":"chatcmpl-b769ef35-f305-44bd-947b-d6acdfd8c1ef","object":"chat.completion.chunk","created":1788653282,"model":"qwen/qwen3.8-27b","system_fingerprint":"fp_c7e30c203c","choices":[{"index":0,"delta":{"tool_calls":[{"id":"rz7mw54tk","type":"function","function":{"name":"get_weather","arguments":"{\"city\":\"Paris\"}"},"index":0}]},"logprobs":null,"finish_reason":null}]}
```

3. final chunk with `finish_reason: "tool_calls"` + usage
4. `data: [DONE]`

Recorded answers:

- **Deltas or one blob?** One blob: `arguments` arrived complete and valid as
  JSON on arrival (`{"city":"Paris"}`, 16 chars). A second probe with a 363-char
  argument payload (`write_note`, 3-sentence body) also arrived as a **single**
  fragment — no argument splitting observed up to ~360 chars.
- **Index/id correlation:** `index: 0` present on the fragment; `id`
  (`rz7mw54tk`, `tz1bn5je0` on second probe) is stable per call. Correlation key
  for accumulation: `index` (with `id` captured from the first fragment).
- **Adapter consequence (for LRN-07c):** implement accumulation keyed by
  `index` anyway — Groq does not fragment today, but longer payloads or other
  endpoints may. The LRN-07c fixture must reproduce *this* single-blob shape.

## AC-1.3 — Usage reporting

- **Returned: yes, final chunk only** — never per-chunk. The chunk bearing
  `finish_reason` (`stop` or `tool_calls`) carries usage **twice**: top-level
  `usage` and a duplicate under `x_groq.usage` (identical values).
- Text run: `{"queue_time":0.0312,"prompt_tokens":29,"prompt_time":0.0024,
  "completion_tokens":16,"completion_time":0.0321,"total_tokens":45,
  "total_time":0.0345}`.
- Tool run: prompt 276 / completion 26 / total 302 tokens.
- Groq-specific extras (`queue_time`, `*_time`) must be ignored by the adapter;
  map only prompt/completion/total tokens into the protocol `Usage` schema.
- If a future endpoint omits usage, record `unknown` (LRN-07b) — never zero.

## AC-1.4 — Failure paths (deliberately triggered)

1. **Invalid model id** (`no-such-model-xyz-123`, `stream: true`):
   fail-fast, **no SSE at all** — HTTP `404` + JSON error body:

   ```json
   {"error":{"message":"The model `no-such-model-xyz-123` does not exist or you do not have access to it.","type":"invalid_request_error","code":"model_not_found"}}
   ```

   Adapter rule: non-2xx on the POST is an immediate typed error (no retry for
   4xx except 429 — see below), never a truncated stream.

2. **Mid-stream disconnect** (client cancelled after 2 chunks): clean local
   abort, 2 events observed, no hang, no error from the endpoint side. Adapter
   rule (LRN-07d): surface a typed disconnect error + journal the partial
   assistant message.

3. **Rate limit (observed opportunistically):** HTTP `429` + JSON body
   `{"error":{"message":"Rate limit reached for model … OTPM: Limit 1000, Used
   657, Requested 600…","type":"tokens","code":"rate_limit_exceeded"}}`.
   Confirms LRN-07b: retry with backoff **only** on 429/5xx; any other 4xx fails
   immediately with the endpoint's message.

## AC-1.5 — Go / no-go

**GO on Groq (`https://api.groq.com/openai/v1`, model `qwen/qwen3.8-27b`).**
Streaming text deltas are truly incremental, forced tool calls arrive reliably
with complete valid-JSON arguments and stable `index`/`id`, usage is reported
on the final chunk, and both failure paths behave in the standard
OpenAI-compatible way. No fallback endpoint needed. Proceed to LRN-07a–d with
the shapes recorded above; keep accumulation defensive (keyed by `index`) in
case larger payloads fragment.

## AC-1.6 — Script disposal

Done: the spike script `tmp/lrn01-spike.mjs` was **deleted** after the run, per
the acceptance criterion — it was never committed and no source code is added by
this task. Retained on local disk, untracked and uncommitted, are only the raw
evidence captures (`tmp/lrn01-raw-*.sse`, `tmp/lrn01-summary.json`), kept as
source material for the LRN-07c fixture; they contain no credentials and must
stay out of the LRN-01 commit (`git status` for the commit shows only
`docs/endpoint-notes.md` and the backlog status update).
