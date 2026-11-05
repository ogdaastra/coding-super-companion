# NEXUS — Implementation Plan & Status

Status legend: ✅ implemented and verified · 🟡 partial or limited · ⬜ not started.
This file is the honest status of the product. "Verified" means exercised in this
environment: built, run, screenshot-reviewed, and unit-tested where noted.

## Phase 0 — Research & planning ✅
- ✅ Environment survey (OS, CPU/GPU, compilers, CMake, Qt, graphics APIs, Python, Claude Code)
- ✅ Claude Code integration research (hooks, status line, CLI, headless, settings)
- ✅ ARCHITECTURE, DESIGN_SYSTEM, EVENT_SCHEMA, IMPLEMENTATION_PLAN, PERFORMANCE, README

## Phase 1 — Visual foundation ✅
- ✅ CMake project, Qt 6.8, shaders compiled by `qt_add_shaders` (SPIR-V/GLSL/HLSL/MSL)
- ✅ QRhi renderer in `QQuickRhiItem`: HDR RGBA16F target, MSAA with resolve, depth
- ✅ Verified on **Vulkan** and **OpenGL** (Linux) and **Direct3D 11** (Windows CI, WARP). Metal and
  D3D12 are supported by QRhi and the shaders are compiled for them, but they have **not been run**.
- ✅ Procedural environment (nebula volume, starfield, core light, polar grid)
- ✅ NEXUS CORE: nucleus plasma, geodesic shells, gyroscopic and partial rings, compass ticks
- ✅ Ray-cast node impostors (per-kind materials) + additive halos (selection reticle, git
  rings, failure disturbance)
- ✅ Bézier / spherical-arc / ring ribbons with flowing dashes and travelling energy packets
- ✅ GPU compute particles (dust, path pulses, bursts, shock rings) + CPU fallback
- ✅ Bloom chain (Karis prefilter, 13-tap down, tent up) + ACES composite, grade, vignette, dither
- ✅ Orbit camera (damped), eased fly-to, presets, idle drift, picking
- ✅ Quality presets; frame/GPU-time HUD (measured)
- ✅ QML environment: top command layer, rail, left module panel, right intelligence
  panel, bottom activity dock, chamfered glass material shader, custom vector icon set

## Phase 2 — Agent connection ✅
- ✅ `nexus-relay` (hook / statusline / probe; spool fallback; no stdout; exit 0)
- ✅ IngestServer (user-only socket, per-launch token, spool recovery, bounded queue)
- ✅ Normaliser + redaction (unit-tested)
- ✅ SQLite EventStore (writer thread, WAL, 30-day retention, history restore)
- ✅ SessionEngine (state machine with provenance, Pre/Post pairing, derived durations,
  permission waits, inferred tests, liveness via pid, stale detection) (unit-tested)
- ✅ Live activity stream with filters
- ✅ Agent state visualisation (glyphs, orbits, colours by state)
- ✅ Setup wizard: detect → relay → diff preview → backup + atomic apply → probe → uninstall
  (installer unit-tested). It has been exercised against temporary settings files. The real
  `~/.claude/settings.json` in this environment was deliberately left untouched.
- ✅ Simulation mode (labelled everywhere, excluded from history, no toasts)
- ✅ **Real Claude Code end-to-end test**: two concurrent real sessions (one launched
  externally with `--settings`, one launched by NEXUS) produced 19 events, including observed
  tool durations, stream-json usage and cost.

## Phase 3 — Project intelligence ✅ / 🟡
- ✅ Indexer (`git ls-files`, or a walk with ignores), parallel scanning, watcher with debounce
- 🟡 Source scanner: lexical, multi-language imports and symbols (unit-tested). It is **not**
  a full parser; tree-sitter / LSP analysers can replace it behind the `SourceScanner` interface.
- ✅ Git service (porcelain v2, numstat, log, diff, stage/unstage/discard-with-safety-copy) (unit-tested)
- ✅ Layouts: galaxy, constellation, force (Barnes–Hut), layered (SCC), cone tree, heatmap (unit-tested)
- ✅ Selection, fly-to, dependency illumination, node inspector
- 🟡 Re-index is full, not incremental per file (fast for small and medium repos; see PERFORMANCE.md)

## Phase 4 — Advanced observability ✅ / 🟡
- ✅ Execution timeline (GPU geometry, lanes, durations, waits, milestones, zoom/pan/scrub)
- ✅ Historical playback replaying events through the visual director (idle gaps compressed)
- ✅ Change intelligence (status, diffs, per-event diffs from Edit/Write inputs, attribution,
  stage, discard with safety copy, confirmed test runs)
- ✅ Command Centre (headless stream-json sessions, terminal sessions, stop with confirmation,
  external-session interrupt via SIGINT with pid verification on Linux)
- ✅ Multi-session monitoring, subagents, shared-file conflicts and overlaps
- 🟡 Knowledge atlas: instructions loaded, docs/config/build files, bookmarks with notes.
  There is no embedding search yet (optional feature, deferred).
- ✅ Search: files, directories and symbols (command palette and Universe panel)
- ✅ NEXUS MCP server (Python, stdlib): `nexus_milestone` (declared provenance),
  `nexus_shared_files` (cross-session conflict awareness), `nexus_recent_activity`.
  Verified with a real Claude Code session.
- 🟡 Accept/reject of individual hunks (whole-file stage/discard only)

## Phase 5 — Advanced graphics 🟡
- ✅ Event signatures (read streams, write pulses + dependent ripple, shock rings, failure
  disturbance, completion wave, prompt injection)
- ✅ Cinematic mode: chrome removed, title card, and camera choreography that sweeps toward
  the files agents are working on (at most one move every 4.5–7 s), then drifts home
- 🟡 Depth fog (in node shading); no depth of field
- ⬜ SSAO: investigated and not implemented. The scene has few occluding surfaces, so it is
  unlikely to improve the image.

## Environment configurability 🟡
- ✅ Fullscreen, cinematic and compact modes; collapsible activity dock
- ✅ Resizable dock and side panels (drag handles); preferences persisted with `QtCore.Settings`
- ⬜ Multiple named workspaces
- ⬜ Alternative colour themes (tokens are centralised in `Theme.qml`, but only one theme ships)

## Phase 6 — Polish 🟡
- ✅ Screenshot review passes; several layout, label and notification issues fixed
- 🟡 Performance measured on a software rasteriser only (see PERFORMANCE.md)
- ✅ Unit tests: 7 suites (redactor, normaliser, scanner + resolution, installer, git, session, layouts)
- 🟡 Windows: built in CI (`.github/workflows/windows.yml`, Qt 6.8.3, MSVC 2022), all 7 test suites
  pass, and the packaged app renders the full scene on Direct3D 11 (WARP software adapter on
  the runner). Not yet run on a Windows machine with a GPU, and hooks / relay / Command Centre
  have not been exercised against a real Claude Code session on Windows.
- ⬜ macOS build not yet produced or verified

## Deliberately deferred (the architecture supports them)
- tree-sitter / LSP analysers behind `SourceScanner`
- Embedding-based semantic search (optional, local only)
- Launching additional agents automatically (never without explicit authorisation)
- Hunk-level staging
