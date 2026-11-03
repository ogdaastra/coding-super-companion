# NEXUS — Implementation Plan

Status legend: ✅ implemented and verified · 🟡 partially implemented · ⬜ not started.
This file is updated as work lands; it is the honest status of the product.

## Phase 0 — Research & planning
- ✅ Environment survey (OS, CPU/GPU, compilers, CMake, Qt, graphics APIs, Python, Claude Code)
- ✅ Claude Code integration research (hooks, status line, CLI, headless, settings)
- ✅ ARCHITECTURE, DESIGN_SYSTEM, EVENT_SCHEMA, IMPLEMENTATION_PLAN, README

## Phase 1 — Visual foundation
- ⬜ CMake project, Qt 6.8, shader compilation via `qt_add_shaders`
- ⬜ Application window, QML environment layout (top/left/right/bottom layers)
- ⬜ Design tokens (`Theme`), typography, icon set, chamfered glass panel material
- ⬜ QRhi renderer: HDR target, MSAA, depth
- ⬜ Environment shader (nebula, starfield, polar grid)
- ⬜ NEXUS CORE structure (shells, rings, nucleus)
- ⬜ Node impostors + halos, Bézier edge ribbons
- ⬜ GPU particle system (compute) + CPU fallback
- ⬜ Bloom chain + filmic composite
- ⬜ Orbit camera, springs, fly-to, presets, picking
- ⬜ Quality presets, frame-time HUD

## Phase 2 — Agent connection
- ⬜ `nexus-relay` (hook + status-line modes, spool fallback)
- ⬜ IngestServer (user-only socket, token auth, bounded queue)
- ⬜ Normaliser + redaction
- ⬜ SQLite EventStore (writer thread, WAL)
- ⬜ SessionEngine (state machine, tool pairing, files touched, commands)
- ⬜ Live activity stream
- ⬜ Agent state visualisation
- ⬜ Claude Code detection + setup wizard (diff preview, backup, test event, uninstall)
- ⬜ Simulation mode (clearly labelled)

## Phase 3 — Project intelligence
- ⬜ Indexer (`git ls-files` / walk with ignores), incremental watch
- ⬜ Source scanner (imports + symbols, multi-language) → dependency graph
- ⬜ Git service (status, diff, log, branch)
- ⬜ Layouts: galaxy, constellation, force-directed, layered, tree, heatmap
- ⬜ Selection, fly-to, dependency illumination, info panel

## Phase 4 — Advanced observability
- ⬜ Execution timeline (zoom/pan, lanes, durations, waiting gaps, milestones)
- ⬜ Historical playback driving the CORE
- ⬜ Change intelligence (status, diffs, per-event diffs, safe actions)
- ⬜ Command Centre (headless sessions via stream-json, terminal sessions, stop)
- ⬜ Multi-session monitoring, shared-file conflict detection
- ⬜ Knowledge atlas (docs/config/instructions, bookmarks, notes), search

## Phase 5 — Advanced graphics
- ⬜ Event signatures (shock rings, scan sweeps, error disturbance, completion wave)
- ⬜ Cinematic mode (auto camera choreography following activity)
- ⬜ Depth fog / focus falloff

## Phase 6 — Polish
- ⬜ Screenshot review pass on every screen
- ⬜ Performance profiling with measured numbers
- ⬜ Real Claude Code end-to-end test
- ⬜ Unit tests (normaliser, redaction, scanner, installer merge, store)

## Deliberately deferred (architecture supports them)
- tree-sitter / LSP analysers behind `SourceAnalyzer`
- Embedding-based semantic search (optional, local only)
- Launching additional agents automatically (never without explicit authorisation)
- Accept/reject of individual hunks (requires staging-area hunk editing)
