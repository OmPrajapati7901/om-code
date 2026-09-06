# LRN-06 and LRN-07a–d implementation evidence

Verified on 2026-09-06 on macOS arm64 with Node **24.20.0** and pnpm **11.25.0**.
Implementation and task acceptance checks pass. Changes remain uncommitted, so backlog rows
remain `half completed` pending the universal DoD-7 commit/evidence gate. This is not an M1
milestone completion claim: LRN-08 through LRN-11 still supply the fake provider, kernel and CLI.

## Reproducibility and full gate

A fresh copy in `/private/tmp/om-code-clean-n2rgip3v` excluded `node_modules`, build outputs,
Git metadata, `.env` files and raw `tmp/` captures. The clean install used only cached packages:

```sh
pnpm install --frozen-lockfile --offline --store-dir /Users/omprajapati/Library/pnpm/store
```

Result: 66 packages reused, zero downloaded, successful frozen-lockfile install. The packaged
`fs-native-extensions@1.5.0` addon loaded on Node 24 arm64; no Cargo setup was needed.
UUIDv7 uses pinned `uuid@14.0.2`; properties use pinned `fast-check@4.9.0`.

The final source and tests passed this command in that clean copy:

```sh
env PATH=/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin \
  /usr/bin/time -p /usr/bin/sandbox-exec \
  -p '(version 1) (allow default) (deny network*)' pnpm run check
```

Result: lint, typecheck, build and tests passed; **247 tests passed, one optional real-keychain
test skipped**. Full gate elapsed **10.65 seconds**, including the real child-process tests.
The suite ran with all network access denied. Manual commands below are separate from the
default suite; LRN-08's eventual socket guard receives no loopback exemption.

| Workspace | Passed | Skipped |
|---|---:|---:|
| protocol | 90 | 0 |
| storage | 58 | 1 |
| session | 2 | 0 |
| providers | 43 | 0 |
| root tests | 17 | 0 |
| cli | 37 | 0 |

## Journal contract and recovery evidence

`JournalWriter.open({ projectRoot, omHome?, sessionId, now?, newId? })` validates UUIDv7 session
IDs, resolves native project realpaths, acquires the permanent sibling lock, then verifies the
complete journal. `append(entry, { by, turn_id? })` snapshots inputs, serializes concurrent work,
assigns contiguous sequences, completes short writes and syncs each record before resolving.
`close()` drains queued work and releases descriptors/ownership idempotently. There is no
writer-owned turn state or tail-only verification option.

`JournalReader.readAll(sessionId, fromSeq?)` returns verified records and incomplete-tail
diagnostics. `read()` is the async record iterable convenience; use `readAll()` when diagnostics
are needed. Both read a captured descriptor extent and verify earlier records before filtering.
Readers never repair. Full verification currently allocates memory proportional to file size;
no large-session performance guarantee is claimed.

`materialize(records)` lives in `@om-code/session` and is pure. It preserves ordered messages,
metadata, calls/results, pending IDs, permissions, checkpoints, compactions and unknown entries.
Missing metadata or unknown entries produce diagnostics and do not advertise resumability.
Callers compose storage and session explicitly. Orchestration remains responsible for recording
`session_start` and turn ownership; LRN-29 will reconcile pending tool effects.

| Acceptance area | Executed evidence |
|---|---|
| AC-6.1/6.3 | `journal.test.ts`: concurrent appends, input snapshots, short writes, exact per-append flush count, queued close and backward timestamps |
| AC-6.2 | Numeric-looking keys, Unicode, escaping and `__proto__` canonicalization; invalid JSON values rejected; original unknown entries hash before protocol wrapping |
| AC-6.4 | `tests/journal-integration.test.ts`: 50 generated sequences up to 30 entries, independent conversation/pending/state reference, repeated read/fold stability and unchanged file bytes |
| Complete verification | Earlier corruption beyond 64 KB is found even when requesting later sequences; malformed lines, hashes, sequence gaps/regressions and incompatible schemas block writing |
| Failure durability | Partial write and sync failures poison the writer; reopening recovers without automatically replaying the uncertain append |
| Repair | Reader preserves damage; backup retains original bytes; replacement retains exact valid prefix plus one repair entry; backup-sync failure leaves original intact |
| AC-6.5 | Actual competing processes refuse promptly with holder PID; SIGKILL releases the OS lock and allows automatic reacquisition |
| Crash transaction | Child SIGKILL at backup-synced, replacement-synced and replacement-published stages preserves the acknowledged prefix and exactly one published repair entry after restart |
| Append crash | Child SIGKILL after write and after sync retains complete records without replay |
| AC-6.6 | Application directories 0700; journal/lock 0600; unexpected symlinks and invalid session IDs refused |

Repair is the sole journal replacement exception. It preserves and syncs a uniquely named
backup, writes the verified prefix plus an audit record to a private sibling temporary file,
syncs it, atomically renames it and syncs the directory. The lock inode never changes.
`repair.truncated_from` is the first discarded sequence; `reason` records classification,
backup basename and byte range. Terminated corruption, hash mismatches, incompatible entries
and zero-filled damage are never automatically truncated. Compaction stays append-only.

The explicit command `/opt/homebrew/opt/node@24/bin/node tests/manual/journal-demo.mjs` also
passed: refusal took **9 ms**, SIGKILL reacquisition succeeded, repaired sequence was **2**,
discarded byte range was **[247,261)**, directory/file modes matched, and lock inode identity
was preserved. These are process-crash observations. They do not establish power-loss or
drive-cache guarantees; no `F_FULLFSYNC` claim is made.

## Provider contract and acceptance evidence

`ModelProvider`, `ModelRequest`, normalized events, response snapshots and `ProviderError`
are owned by protocol. The adapter depends only on protocol. Configure `baseUrl`, credentials,
fetch injection, usage-request compatibility and timeout settings at adapter construction;
model IDs are opaque. `capabilities()` and a compatibility package are deferred.

`assistant_message` version 2 retains version-1 reading and records the terminal response
snapshot directly: text/thinking, indexed raw calls, usage, endpoint `stop_reason` and explicit
complete/interrupted outcome. Complete calls require IDs/names; malformed arguments remain
raw. Partial calls cannot be treated as executable calls. Recorded thinking is display/journal
content; vendor-specific replay is deferred.

The composition point can persist either terminal success or a typed partial without importing
provider internals:

```ts
import { ProviderError } from "@om-code/protocol";

try {
  for await (const event of provider.stream(request, signal)) {
    if (event.type === "message_stop") {
      await writer.append(
        { kind: "assistant_message", schemaVersion: 2, ...event.response },
        { by: "model", turn_id: turnId },
      );
    }
  }
} catch (error) {
  if (error instanceof ProviderError && error.partial) {
    await writer.append(
      { kind: "assistant_message", schemaVersion: 2, ...error.partial },
      { by: "model", turn_id: turnId },
    );
  }
  throw error;
}
```

| Acceptance area | Executed evidence |
|---|---|
| AC-7.1/7.2 | Shared scenario-factory contract suite; multiple text deltas observed before transport completion |
| AC-7.5 | Source-only model-name branch scan with planted positive/negative cases; full dependency lint remains LRN-14 |
| SSE framing | Every byte split of Unicode/CRLF fixture, LF/CR, comments, multiline data, final UTF-8 flush, malformed JSON and bounded events |
| AC-7.4 | Finish-chunk and late usage-only chunks; unknown/invalid counters stay unknown; genuine zeros survive; unknown usage survives journal round trip |
| Terminal outcome | Exactly one success after finish plus DONE/clean EOF; missing finish, stream read errors and malformed events preserve typed partials |
| AC-7.6 | Initial 429/5xx only, three total attempts, jitter, numeric/date Retry-After, 10-second delay cap, no transport/started-stream retry, response bodies disposed |
| AC-7.3 | Replayed credential-free Groq captures plus labeled synthetic interleaved/sparse call indices, fragmented names/arguments, conflicting identity rejection and exact malformed argument preservation |
| AC-7.7/7.8 | Text/tool disconnect and abort, cancellation before headers/during backoff, idle/deadline timeout, early consumer return; interrupted text and raw tool arguments persist/read back |
| Privacy | Existing secret sentinel guard scans generated journal/lock/backup trees and fixtures after a credential-authenticated fake HTTP error; echoed credentials are redacted from error output |

The adapter defaults to a 60-second idle read timeout and five-minute request deadline.
Reader cleanup, transport abort, timers and listeners are owned by the adapter. No storage
signal handlers, tool execution, argument repair, paid reasoning probe or model-name heuristics
were introduced.

## Explicit manual endpoint and socket checks

These commands were run with Node 24 after building; they are not default test hooks:

```sh
/opt/homebrew/opt/node@24/bin/node tests/manual/transport-close.mjs
/opt/homebrew/opt/node@24/bin/node --env-file=.env tests/manual/provider-smoke.mjs
```

The loopback demonstration observed socket closure after caller abort in **6 ms for text** and
**0 ms rounded for tools**, both below one second. It tests actual connection closure rather
than only iterator rejection.

The configured Groq endpoint (`https://api.groq.com/openai/v1`, `qwen/qwen3.8-27b`) passed both
smoke requests, each capped at 512 completion tokens. Credentials were not printed; captured
fixtures were checked against the actual key before the run.

| Request | Observed output | Events | Reported usage input/output/total |
|---|---|---|---|
| Text | `hello world`, stop `stop`, complete | 1 start, 2 text deltas, 1 stop | 18 / 3 / 21 |
| Forced function | `get_weather`, raw `{"city":"Paris"}`, stop `tool_calls`, complete | 1 start, 1 tool delta, 1 stop | 280 / 26 / 306 |

The function was requested and accumulated, not executed. No thinking text appeared in these
runs; reasoning-field preservation has synthetic coverage only. See [endpoint notes](endpoint-notes.md)
for historical capture provenance. Results establish this endpoint/model observation, not
universal provider compatibility or a paid reasoning requirement.
