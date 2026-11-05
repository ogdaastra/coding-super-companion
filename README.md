# NEXUS

> **Also in this repository: [NEUROFORM](neuroform/README.md)**, a browser-native
> artificial brain observatory: a spiking neural network simulated in Rust/WebAssembly
> and explored in real-time 3D (WebGPU with WebGL2 fallback). It is independent of
> NEXUS and lives entirely in [`neuroform/`](neuroform/).

**A native, GPU-accelerated command environment for AI coding agents.**
NEXUS makes the activity of Claude Code visible, understandable and controllable. It
renders your project as a living 3D structure, the *NEXUS CORE*, and lights it up with
what the agent actually does: files read and written, commands run, tests failed,
permissions waited on, turns completed. All of it comes from real telemetry.

It is a native Qt 6 / C++20 application with a custom QRhi renderer (Vulkan, Metal,
Direct3D, OpenGL). There is no browser, no Electron and no webview.

---

## What it does

| Area | What you get |
| --- | --- |
| **NEXUS CORE** | HDR scene: procedural environment, geodesic core lattice, gyroscopic rings, ray-cast node impostors, flowing Bézier dependency ribbons, GPU compute particles, bloom and filmic tone mapping. Agents orbit the core as beacons; every event has a visual signature. |
| **Project Universe** | git-aware indexer plus a multi-language structural scanner (imports and symbols for C/C++, Python, JS/TS, Go, Rust, Java/Kotlin, C#, QML, GLSL, CMake, Markdown). Six layouts: hierarchical galaxy, dependency constellation, force-directed (Barnes–Hut), layered architecture, directory cone tree, activity heatmap. Select a node to fly to it and light up its dependencies. |
| **Agent Observatory** | Live activity stream, a GPU-drawn execution timeline (tool-call durations, permission waits, milestones, zoom/pan/scrub, historical playback), per-session state machine with *observed / derived / inferred* provenance, session intelligence (task, tools, files, commands, tests, errors), and context/token/cost figures only when Claude Code reports them. |
| **Change Intelligence** | git status, diffs, commit log, attribution of changes to agent sessions, per-event diffs reconstructed from Edit/Write tool inputs, and safe actions: stage, unstage, discard (confirmed, with a recoverable safety copy), run tests (confirmed), open in editor or terminal. |
| **Command Centre** | Start headless sessions (`claude -p`, stream-json) or interactive sessions in your terminal, both with NEXUS telemetry injected through `--settings`, so your configuration is never touched. Stop or interrupt sessions only with confirmation. |
| **Multi-Agent Network** | Every session is an agent with its own colour, orbit, lane, state and history. Subagents are tracked. Files written by two sessions are flagged as conflicts; files touched by two sessions are flagged as overlaps. |
| **Knowledge Atlas** | Instructions loaded by agents (`InstructionsLoaded`), documentation, configuration and build files, and bookmarks with notes. |

**What NEXUS does not do:** it cannot see model reasoning, attention or memory. It shows
what Claude Code reports through hooks, the status line and stream-json, and it labels
anything inferred.

---

## Build

Requirements: CMake ≥ 3.21, a C++20 compiler, and **Qt ≥ 6.7** (6.8 LTS is the reference)
with the `qtshadertools` module.

```bash
# Qt 6.8 via the official installer, or:
pip install aqtinstall
aqt install-qt linux desktop 6.8.3 linux_gcc_64 -m qtshadertools --outputdir ~/Qt

cmake -S . -B build -G Ninja -DCMAKE_PREFIX_PATH=~/Qt/6.8.3/gcc_64 -DCMAKE_BUILD_TYPE=Release
cmake --build build
ctest --test-dir build --output-on-failure
```

Linux also needs the usual xcb and Vulkan/GL development packages, for example
`libxkbcommon-dev libxcb-cursor0 libvulkan-dev libgl1-mesa-dev`.

## Run

```bash
./build/src/nexus --project /path/to/your/repo
```

| Option | Purpose |
| --- | --- |
| `--backend=vulkan\|opengl\|metal\|d3d11\|d3d12` | Choose the graphics API (default: platform choice) |
| `--project <dir>` | Open a project on start (the last project is remembered) |
| `--simulate` | Start the clearly labelled simulation (synthetic events) |
| `--launch "<task>"` | Start a headless Claude Code session with this task (same path as the Command Centre) |
| `--module <name>`, `--layout <0-5>`, `--select <path>` | Initial state |
| `--screenshot <png> --screenshot-delay <ms>` | Capture the window and quit (automated visual review) |

## Connect Claude Code

Open **Setup** (gear icon, or `Ctrl+8`):

1. NEXUS detects `claude` and its version.
2. It locates `nexus-relay`, the tiny native hook handler next to the NEXUS executable.
3. **Preview** shows the exact diff to `~/.claude/settings.json` (all projects) or
   `.claude/settings.local.json` (this project only). **Apply** writes a timestamped
   backup first, then replaces the file atomically. It refuses to write if the file
   changed after the preview, and it never touches a file it cannot parse.
4. **Send test event** proves the path relay → socket → NEXUS.

Hooks are installed as `async` command hooks in exec form, so they never block or alter
Claude Code. An existing status line is preserved: NEXUS chains to it. **Preview removal**
removes only NEXUS's handlers.

Sessions started from the Command Centre do not need any installation.

### Optional: NEXUS MCP server

`nexus_mcp.py` is a Python server that uses only the standard library. It lets an agent
**declare** milestones on its own timeline lane (labelled `declared`) and ask which files
*other* live sessions have recently written, so concurrent agents can avoid conflicting
edits. Register it with:

```bash
claude mcp add nexus -- python3 /path/to/build/src/nexus_mcp.py --relay /path/to/build/src/nexus-relay
```

## Security & privacy

* **No network listeners.** IPC is a local socket restricted to the current user
  (`0700` directory, user-only socket), authenticated by a per-launch 256-bit token
  stored in a `0600` file.
* **Monitoring never executes anything.** Commands run only from explicit, confirmed
  user actions.
* **Secrets are redacted** before storage or display: API keys, tokens, JWTs, private
  keys, URL credentials and `*_SECRET=`-style assignments. Large file contents are
  truncated.
* **Destructive git actions** are confirmed, and a copy of the file goes to
  `<data>/safety/` first.
* **NEXUS makes no outbound network connections.** Data stays in the platform's local
  application data directory (on Linux, `~/.local/share/Nexus/NEXUS`): `events.db`,
  `spool/`, `safety/`.

## Layout

Drag the edges of the side panels and the activity dock to resize them. NEXUS remembers
these sizes, the quality preset and the last project.

## Keyboard

`Ctrl K` search and commands · `Ctrl 1–8` modules · `C` cinematic mode · `F11` fullscreen ·
`R` reset camera · `Space` replay/pause history · `L` back to live · `Ctrl J` dock ·
`Ctrl B` compact · `Esc` clear selection.

## Documentation

* [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): technology decisions, process and thread model, rendering
* [docs/EVENT_SCHEMA.md](docs/EVENT_SCHEMA.md): wire format, normalised events, state machine, storage
* [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md): colour, type, shape, materials, motion
* [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md): honest status of every feature
* [docs/PERFORMANCE.md](docs/PERFORMANCE.md): what has been measured, and where

## Licence notes

Bundled fonts: Inter (OFL-1.1) and JetBrains Mono (licence included in `assets/fonts/`).
