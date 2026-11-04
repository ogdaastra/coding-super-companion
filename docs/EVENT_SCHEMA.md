# NEXUS — Event Schema

Version: **1**. Every piece of telemetry in NEXUS is normalised into a `NexusEvent`
before it reaches the event bus, the store or the renderer. Raw inputs are kept (redacted
and size-capped) in `payload` so that nothing is lost by normalisation.

## 1. Wire format: relay → NEXUS

`nexus-relay` writes one JSON object per line (`\n` terminated, UTF-8) to the local socket:

```json
{
  "nexus": 1,
  "token": "<64 hex chars>",
  "channel": "hook",            // "hook" | "statusline" | "probe"
  "captured_ms": 1762212345678,  // relay wall clock when stdin was read (ms since epoch)
  "relay_pid": 4242,
  "parent_pid": 4100,            // in exec-form hooks this is the Claude Code process
  "payload": { ...verbatim Claude Code hook/status-line JSON... }
}
```

* Messages with a missing/incorrect token are dropped and counted (`System → Rejected`).
* Lines longer than 8 MiB are rejected. The relay truncates oversize fields before sending.
* When the socket is unavailable the same line (including token-less form — the token is
  stripped before spooling) is appended to `<data>/spool/<yyyy-mm-dd>.jsonl` under a lock
  file. NEXUS ingests and deletes spool files at start-up.

## 2. Normalised event

```jsonc
{
  "v": 1,
  "id": "e3b0c442-…",            // NEXUS-assigned UUID
  "seq": 1842,                   // monotonic per store
  "ts": 1762212345678,           // capture time (relay) or receive time (ms)
  "source": "hook",              // hook | statusline | stream | simulation | system
  "simulated": false,            // true ONLY for source == simulation
  "session_id": "abc123",
  "agent_id": null,              // subagent / teammate id when present
  "agent_type": null,            // e.g. "Explore"
  "kind": "tool.post",           // see §3
  "category": "write",           // see §4 (tool events only)
  "tool_name": "Edit",
  "tool_use_id": "toolu_01…",
  "files": ["/abs/path/src/main.cpp"],
  "command": "ctest --output-on-failure",   // redacted
  "duration_ms": 412,            // when reported by Claude Code or derived from pairing
  "ok": true,
  "error": null,                 // redacted, ≤ 4 KiB
  "cwd": "/abs/project",
  "summary": "Edit src/main.cpp",           // one-line, human readable
  "provenance": "observed",      // observed | derived | inferred
  "payload": { … }               // redacted original input, size-capped
}
```

### Provenance

| Value | Meaning | Example |
| --- | --- | --- |
| `observed` | Directly reported by Claude Code | `PostToolUse` with `duration_ms` |
| `derived` | Computed exactly from observed facts | duration from paired Pre/Post timestamps |
| `inferred` | Heuristic classification of observed facts | "test run" from a Bash command matching `pytest`/`ctest`/… |
| `declared` | Self-reported by the agent, not observed behaviour | a milestone sent through the NEXUS MCP server |

The UI must label inferred facts as such.

## 3. Event kinds

| `kind` | Source hook event | Notes |
| --- | --- | --- |
| `session.start` | `SessionStart` | `payload.source`: startup/resume/clear/compact/fork; `model` if present |
| `session.end` | `SessionEnd` | `payload.reason` |
| `prompt.submit` | `UserPromptSubmit` | prompt text stored redacted, ≤ 2 KiB |
| `tool.pre` | `PreToolUse` | begins a tool call |
| `tool.post` | `PostToolUse` | `ok = true`; `duration_ms` observed when present |
| `tool.fail` | `PostToolUseFailure` | `ok = false`; `error`; `is_interrupt` |
| `permission.request` | `PermissionRequest` | session enters *waiting for permission* |
| `permission.denied` | `PermissionDenied` | auto-mode denial |
| `notification` | `Notification` | `notification_type` (`permission_prompt`, `idle_prompt`, …) |
| `subagent.start` / `subagent.stop` | `SubagentStart` / `SubagentStop` | creates/ends a child agent |
| `task.created` / `task.completed` | `TaskCreated` / `TaskCompleted` | |
| `turn.stop` | `Stop` | `last_assistant_message` kept (≤ 4 KiB) as the turn summary |
| `turn.fail` | `StopFailure` | `error` type (`rate_limit`, `overloaded`, …) |
| `compact.pre` / `compact.post` | `PreCompact` / `PostCompact` | |
| `cwd.changed` | `CwdChanged` | |
| `instructions.loaded` | `InstructionsLoaded` | feeds the Knowledge Atlas |
| `model.switch` | `PostModelSwitch` | `from_model` / `to_model` |
| `status.update` | status line | context window, cost, model, rate limits |
| `stream.message` | headless `stream-json` | assistant text / usage for NEXUS-launched sessions |
| `stream.result` | headless `stream-json` | final result, cost, usage |
| `agent.milestone` | `NexusMilestone` (NEXUS MCP server) | provenance `declared`; attributed to a session by Claude Code pid |
| `system.*` | NEXUS itself | e.g. `system.setup_test`, `system.overflow` |
| `unknown` | anything else | kept verbatim; never discarded |

## 4. Tool categories

| Category | Tools |
| --- | --- |
| `read` | Read, NotebookRead, LS |
| `write` | Edit, MultiEdit, Write, NotebookEdit |
| `search` | Grep, Glob, ToolSearch |
| `exec` | Bash, PowerShell, BashOutput, KillShell, Monitor |
| `web` | WebFetch, WebSearch |
| `agent` | Agent, Task, SendMessage |
| `task` | TaskCreate, TaskUpdate, TaskList, TaskGet, TodoWrite |
| `mcp` | any `mcp__<server>__<tool>` |
| `other` | everything else |

File paths are extracted from `tool_input.file_path`, `tool_input.notebook_path`,
`tool_input.path` (search roots) and `tool_response.filePath`.

## 5. Session state machine

```
            SessionStart                   UserPromptSubmit
  (none) ───────────────► Idle ─────────────────────────────► Running
                            ▲                                   │  ▲
                 Stop       │         PreToolUse                ▼  │ PostToolUse / Failure
                 ┌──────────┴─────── Completed ◄──── Stop ── ExecutingTool
                 │                                              │
                 │      PermissionRequest / Notification(permission_prompt)
                 │                                              ▼
                 │                                     WaitingPermission
                 │  StopFailure                                 │ (next Pre/PostToolUse)
                 └────────────── Failed ◄───────────────────────┘
  SessionEnd from any state ──► Ended
  No events for 30 min and process not alive ──► Stale (inferred)
```

`Running` between a prompt and the first tool call is **derived** (the agent is
processing; NEXUS cannot see model reasoning). `Notification(idle_prompt)` moves a
session to `AwaitingInput`.

## 6. SQLite storage

```sql
CREATE TABLE events (
  seq          INTEGER PRIMARY KEY AUTOINCREMENT,
  id           TEXT UNIQUE NOT NULL,
  ts           INTEGER NOT NULL,
  source       TEXT NOT NULL,
  simulated    INTEGER NOT NULL DEFAULT 0,
  session_id   TEXT,
  agent_id     TEXT,
  kind         TEXT NOT NULL,
  category     TEXT,
  tool_name    TEXT,
  tool_use_id  TEXT,
  files        TEXT,      -- JSON array
  duration_ms  INTEGER,
  ok           INTEGER,
  summary      TEXT,
  provenance   TEXT,
  payload      TEXT       -- redacted JSON
);
CREATE INDEX events_session_ts ON events(session_id, ts);
CREATE INDEX events_ts ON events(ts);

CREATE TABLE sessions (
  session_id   TEXT PRIMARY KEY,
  first_ts     INTEGER, last_ts INTEGER,
  cwd          TEXT, project_root TEXT,
  model        TEXT, title TEXT,
  state        TEXT, simulated INTEGER DEFAULT 0,
  claude_pid   INTEGER
);

CREATE TABLE bookmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_root TEXT NOT NULL, path TEXT NOT NULL,
  note TEXT, created_ts INTEGER NOT NULL
);
```
