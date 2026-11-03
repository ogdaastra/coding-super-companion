# NEXUS — Architecture

NEXUS is a native, GPU-accelerated desktop environment for observing and directing
AI coding agents, with Claude Code as the primary integration. This document records
the architecture and the reasoning behind each major decision. It is a living document:
when the code and this file disagree, fix one of them.

---

## 1. Environment survey (Phase 0)

The project was bootstrapped in the following environment. The values matter because
several of the claims below (performance numbers in particular) were measured
there and *only* there.

| Item | Finding |
| --- | --- |
| OS | Ubuntu 24.04.5 LTS, Linux 6.18, x86_64 |
| CPU / RAM | 4 vCPU, 15 GiB |
| GPU | **None.** Rendering verified on Mesa `llvmpipe` (OpenGL 4.5 core) and `lavapipe` (Vulkan 1.4), i.e. CPU software rasterisers |
| Display | Headless; `Xvfb` used for launching and screenshots |
| Compilers | GCC 13.3, Clang (system), CMake 3.28, Ninja |
| Qt | System apt offers only Qt 6.4.2 (too old: no public `QQuickRhiItem`). Qt **6.8.3 LTS** installed via `aqtinstall` into `/opt/Qt/6.8.3/gcc_64` with `qtshadertools` |
| Python | 3.13 |
| Claude Code | `claude` 2.1.317 at `/opt/node22/bin/claude` |
| Docs consulted | `code.claude.com/docs/en/{hooks,statusline,cli-reference,headless,settings}` (fetched Nov 2026) |

Consequence: every frame-time figure produced in this environment is a *software
rasteriser* figure. They are useful for regressions, not for judging the 60/120 FPS
targets, which must be measured on real GPU hardware (see `PERFORMANCE.md`).

---

## 2. Technology decisions

### 2.1 Qt 6.8 LTS + Qt Quick (QML) for composition — chosen

* Native scene graph, hardware accelerated through **QRhi** (Vulkan, Metal, Direct3D 11/12,
  OpenGL). No browser, no webview, no HTML anywhere in the product.
* QML gives us fast iteration on the panel system, typography and micro-interactions
  while all heavy lifting stays in C++.
* 6.8 is an LTS release and the first LTS with the public (tech-preview) `QQuickRhiItem`,
  which lets a custom renderer draw directly into a texture that the scene graph
  composites without any extra copies.

### 2.2 Custom QRhi renderer instead of Qt Quick 3D — chosen

Qt Quick 3D was evaluated as the spatial layer. It is excellent for authored meshes and
PBR scenes, but the NEXUS CORE needs:

1. Tens of thousands of *dynamic* instanced impostors (ray-cast spheres) whose state is
   animated in the shader from event timestamps, so the CPU does not re-upload per frame.
2. Thousands of curved, flowing, anti-aliased ribbons (dependency edges) generated in the
   vertex shader.
3. A GPU **compute** particle simulation (pathway pulses, bursts, ambient curl-noise dust).
4. Full control of the HDR pipeline: bloom mip chain, filmic tone mapping, grading,
   grain/dither (essential on near-black gradients to avoid banding).

Quick 3D exposes instancing and post effects, but not compute, and expressing (2) and (3)
through its `Model`/`Effect` abstraction would be awkward and slower. Writing directly
against **QRhi** keeps the same cross-API portability Qt Quick 3D has (we inherit
Vulkan/Metal/D3D/GL from Qt) while giving full control. Shaders are written once in
Vulkan-style GLSL 440 and compiled by `qsb` (Qt Shader Tools) into SPIR-V, GLSL, HLSL and
MSL at build time.

### 2.3 Unreal Engine — rejected

Unreal would give a superb 3D viewport but is a poor fit for the rest of the product:
dense, text-heavy, accessible panels; native file dialogs; process management;
multi-gigabyte toolchain; long iteration loops; licensing considerations; and it cannot
be built in our CI-style environment. The NEXUS CORE does not need a general-purpose
game engine — it needs a small, focused, data-driven renderer, which we own.

### 2.4 Electron / Tauri / any webview — rejected (hard requirement)

### 2.5 Telemetry transport: async command hooks → `nexus-relay` → local socket — chosen

Claude Code offers command, HTTP, MCP-tool, prompt and agent hook handlers.

* **HTTP hooks** were considered. They need no helper binary, but they fail (silently,
  as a non-blocking error) whenever NEXUS is not running, so events are lost; and there
  is no way to recover them later.
* **Command hooks with `async: true`** run in the background and never block Claude Code.
  Our handler is a tiny native binary, `nexus-relay`, launched in **exec form** (`args`),
  which means Claude Code itself is the relay's parent process — the relay therefore
  reports the real Claude Code PID, enabling process monitoring and safe interruption.
* The relay forwards the hook JSON over a **user-only local socket** (`QLocalServer`
  with `UserAccessOption`, socket inside the per-user runtime directory) authenticated
  by a random 256-bit token stored in a `0600` file. If NEXUS is not running, the relay
  appends the event to a **spool file**; NEXUS ingests spooled events on start-up
  ("recovery after application restart").
* The relay **never prints to stdout** (async-hook stdout is delivered back to Claude as
  context) and always exits 0, so it can never alter Claude Code's behaviour.

### 2.6 Sessions launched from NEXUS: `--settings` injection — chosen

`claude --settings '<inline json>'` overrides settings for one session only. Sessions
started from the Command Centre receive NEXUS hooks this way, so they are fully
observable **without modifying any user configuration**. Headless sessions additionally
use `-p --output-format stream-json --verbose`, giving assistant text and real usage
figures from the structured stream instead of scraping terminal output.

### 2.7 Context / token figures — observed only

Two sources of *reported* values exist and both are used when available:

* the **status line** JSON (`context_window.used_percentage`, token totals, cost, model,
  rate limits) — captured when the user opts into the NEXUS status-line relay;
* the **stream-json** `result`/`assistant` messages for headless sessions.

If neither is present the UI states "Unavailable" with the reason. Nothing is estimated.

### 2.8 Persistence: SQLite via Qt SQL — chosen

Bundled with Qt, zero extra dependency, robust, WAL mode allows a writer thread and
reader threads concurrently. Stores events, sessions, bookmarks and notes.

### 2.9 Project analysis: built-in lexical structural scanner — chosen for v1

A C++ scanner extracts imports/includes and top-level symbols for C/C++, Python,
JavaScript/TypeScript, Go, Rust, Java/Kotlin/C#, QML, GLSL, CMake and Markdown links,
then resolves them to files in the project. It is fast (runs on a worker thread), has no
dependencies and produces *real* dependency edges. It is not a full parser: it can miss
macro-generated includes, dynamic imports and symbols in unusual formatting. The
`SourceAnalyzer` interface is designed so a tree-sitter or LSP-backed analyser can replace
it per language (see `IMPLEMENTATION_PLAN.md`). tree-sitter was investigated: the runtime
is small, but each grammar is a large generated C file that must be vendored or fetched at
build time; this is deferred, not rejected.

### 2.10 Git: the `git` CLI — chosen

`git status --porcelain=v2`, `git diff`, `git log` run asynchronously via `QProcess`.
The CLI is universally installed, authoritative (respects the user's config, hooks,
attributes), and avoids a libgit2 dependency.

### 2.11 Python — used where it adds value, never required

The core application, relay and analysis are C++. Python is reserved for optional
integrations (an MCP server through which an agent can *declare* milestones/notes, and a
future tree-sitter analysis worker). NEXUS must run fully without Python.

---

## 3. Process & thread model

```
 ┌──────────────── Claude Code (any number of sessions) ────────────────┐
 │  hooks (async, exec form)          status line (optional)            │
 └───────────┬───────────────────────────────┬──────────────────────────┘
             │ stdin JSON                     │ stdin JSON
             ▼                                ▼
      ┌────────────┐                   ┌────────────┐
      │ nexus-relay│ hook              │ nexus-relay│ statusline (prints status, forwards)
      └─────┬──────┘                   └─────┬──────┘
            │  framed JSON + token over QLocalSocket (user-only)
            │  └─ fallback: spool/*.jsonl  (ingested on NEXUS start)
            ▼
 ╔══════════════════════════════ NEXUS process ══════════════════════════════╗
 ║  [Ingest thread]  IngestServer → validate → Normalizer → Redactor          ║
 ║         │                                                                   ║
 ║         ▼  queued signal (bounded)                                          ║
 ║  [GUI thread]  EventBus ─┬─► SessionEngine (state machines, agents)         ║
 ║                          ├─► ActivityModel / TimelineModel (QML models)     ║
 ║                          ├─► ProjectGraph (activity, touched files)         ║
 ║                          └─► VisualEventQueue ──► NexusViewport              ║
 ║         │                                                                   ║
 ║         ▼  queued                                                           ║
 ║  [Store thread]   EventStore (SQLite WAL, batched transactions)             ║
 ║  [Worker pool]    ProjectIndexer, SourceScanner, GraphLayout, Git, Search  ║
 ║  [Render thread]  NexusRenderer (QRhi): scene → HDR → bloom → composite    ║
 ╚═════════════════════════════════════════════════════════════════════════════╝
```

Rules:

* The **render thread never blocks** on I/O. It receives immutable snapshots of scene
  data in `synchronize()` (GUI thread blocked, typically < 0.2 ms) and owns all GPU
  resources.
* The **GUI thread never performs I/O** larger than a settings read. Filesystem walks,
  parsing, layout, git and SQLite all run on workers and report back with queued signals.
* Queues between threads are **bounded**. If the ingest queue overflows (an agent
  producing thousands of events per second), the oldest *visual* events are coalesced;
  stored events are never dropped silently — an overflow counter is surfaced in the
  System panel.

---

## 4. Module map

| Module | Directory | Responsibility |
| --- | --- | --- |
| core | `src/core` | Event schema, event bus, redaction, paths, logging, settings |
| ingest | `src/ingest` | Local socket server, spool recovery, hook/status-line normalisation |
| store | `src/store` | SQLite persistence, history queries |
| session | `src/session` | Session/agent state machines, tool-call pairing, models for QML |
| project | `src/project` | Indexing, scanning, dependency graph, git, file watching |
| graph | `src/graph` | Layout algorithms (galaxy, constellation, force, layered, tree, heatmap) |
| render | `src/render` | `NexusViewport` (QQuickRhiItem), renderer, camera, particles, post-processing |
| integration | `src/integration` | Claude Code detection, hook installer, session launcher, terminal launch |
| sim | `src/sim` | Clearly-labelled simulated telemetry for demos/tests |
| app | `src/app` | Composition root, QML context, command routing |
| relay | `relay/` | `nexus-relay` hook/status-line forwarder |
| shaders | `shaders/` | GLSL 440 sources compiled by `qsb` |
| qml | `qml/` | Design system, panels, environment layout |

---

## 5. Rendering architecture

### 5.1 Frame graph

```
 scene pass (HDR RGBA16F, MSAA 1/4×, depth)
   1. environment   – procedural nebula + starfield from inverse view-projection rays
   2. structure     – geodesic shells, gyroscopic rings, polar grid (instanced ribbons)
   3. edges         – quadratic Bézier ribbons, flowing dashes, activity energy
   4. node cores    – ray-cast sphere impostors (glass/metal shading, fresnel, emissive)
   5. node halos    – additive glow quads (state colour, selection, conflict)
   6. particles     – instanced billboards fed by the compute simulation buffer
 bloom
   prefilter (Karis average, soft knee) → 6-level 13-tap downsample → tent upsample
 composite (into the QQuickRhiItem colour buffer)
   exposure → filmic tone map → split-tone grade → vignette → chromatic fringe → dither grain
```

### 5.2 Data flow into the renderer

Scene state lives on the GUI thread inside `NexusViewport`:

* **Node instances** carry *start/target position + transition start time* and
  *last-read/last-write/last-error timestamps*. The vertex/fragment shaders evaluate the
  eased transition and the activity decay themselves, so instance buffers are only
  re-uploaded when the graph or an event changes — not every frame.
* **Particle spawns** are queued as compact spawn commands; the compute shader writes
  new particles into a ring buffer and integrates all live particles. A CPU fallback is
  used when `QRhi::Compute` is unsupported.
* **Labels** are not rasterised in 3D. The viewport projects a budgeted set of labelled
  nodes and publishes screen positions to a fixed-size QML model, so typography is
  rendered by Qt's text engine (crisp, hinted, accessible).

### 5.3 Camera

Orbit camera with critically-damped springs on yaw, pitch, distance and target; smooth
fly-to with eased (`easeInOutCubic`-shaped) transitions, presets, idle drift, picking by
CPU ray–sphere tests against current node positions.

### 5.4 Quality presets

| Preset | Render scale | MSAA | Bloom levels | Particles | Glass blur |
| --- | --- | --- | --- | --- | --- |
| Low | 0.75 | 1× | 4 | 8 k | off |
| Medium | 1.0 | 1× | 5 | 32 k | on |
| High | 1.0 | 4× | 6 | 64 k | on |
| Ultra | 1.25 | 4× | 6 | 192 k | on |

---

## 6. Security model

* **Monitoring and control are separate.** Ingest only *records*; it can never cause a
  command to run. Commands are only ever executed from explicit user actions in the
  Command Centre and Change Review, each behind a confirmation when consequential.
* **No network listeners.** IPC is a local socket restricted to the current user and
  authenticated with a per-install token. There is no remote control surface.
* **Redaction before persistence/logging.** API keys (`sk-ant-…`, `sk-…`, AWS, GitHub,
  Slack), bearer tokens, private-key blocks, URL credentials and `*_TOKEN=`/`*_SECRET=`
  style assignments are masked in stored payloads and logs. Large file contents in tool
  inputs/responses are truncated.
* **User configuration is never modified silently.** The setup wizard shows the exact
  diff of `settings.json`, writes a timestamped backup, writes atomically, and offers a
  one-click uninstall that removes only NEXUS handlers.
* **Destructive git actions** (restore/discard) require confirmation, and NEXUS stashes a
  copy of the current file content in its data directory first, so even an accepted
  discard is recoverable.
* **Project-root awareness.** File actions are refused for paths outside the selected
  project root.
* **No project content leaves the machine.** NEXUS makes no outbound network calls.
