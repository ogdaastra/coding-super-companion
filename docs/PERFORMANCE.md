# NEXUS — Performance

> **Status: the 60 / 120 FPS targets have NOT been verified.** Everything below was
> measured on a machine **without a GPU**, using Mesa's CPU software rasterisers
> (`llvmpipe` for OpenGL 4.5, `lavapipe` for Vulkan 1.4). Those numbers are useful for
> regression tracking. They say nothing about behaviour on real graphics hardware.
> Re-run the benchmark on a real GPU before making any claim.

## How to measure

```bash
./build/src/nexus --backend=vulkan --quality 2 --project <repo> --benchmark 10
```

`--benchmark N` waits 3 s, records N seconds of wall-clock frame times from the GUI
frame loop, plus GPU frame times reported by `QRhiCommandBuffer::lastCompletedGpuTime()`
(GPU timestamps are enabled in `QQuickGraphicsConfiguration`), prints statistics and
quits. The HUD and the System tab show the same live values.

## Results — software rasteriser (no GPU), 4 vCPU, 2026-11-04

Scene: this repository (160 files, 310 dependency edges). That is 614 node instances
including the core lattice, and 1,766 ribbon instances. The full UI is visible.

| Backend | Quality | Target | MSAA | Particles | Frame mean | p95 | FPS | GPU (timestamps) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Vulkan (lavapipe) | Low | 1260×750 | 1× | 8k (compute) | 260.8 ms | 320.5 ms | 3.8 | 140.3 ms |
| Vulkan (lavapipe) | High | 1680×1000 | 4× | 64k (compute) | 329.1 ms | 358.0 ms | 3.0 | 222.1 ms |
| OpenGL (llvmpipe) | Low | 1260×750 | 1× | 8k (compute) | 166.7 ms | 191.1 ms | 6.0 | 132.2 ms |
| OpenGL (llvmpipe) | High | 1680×1000 | 4× | 64k (compute) | 311.3 ms | 336.6 ms | 3.2 | 242.1 ms |

The software rasteriser shares the 4 CPU cores with the application, so frame time is
higher than "GPU" time. On real hardware the expected cost is dominated by:

1. **Environment pass.** Full-screen fbm noise (3 fbm evaluations per pixel). It is the
   first candidate to bake into a cubemap if it shows up in a GPU profile.
2. **Bloom.** 6 down and 5 up passes at half resolution and below.
3. **Glass panels.** A ShaderEffectSource of the viewport at ¼ resolution plus 5 taps per
   pane pixel.

### Larger project (software rasteriser)

Qt's own header tree (`/opt/Qt/6.8.3/gcc_64/include`): **4,437 files, 11,433 resolved
includes, 47,959 symbols, 339 directories**. Indexing took **339–391 ms** on 4 cores. The
scene has 5,207 node instances and 17,399 ribbon instances. Rendering ran at **2.3 FPS**
on OpenGL/llvmpipe (Medium preset, 442 ms mean frame), which is roughly proportional to
the geometry. To stay legible at this density, ribbon intensity scales with edge count
(see `VisualScene::rebuildProjectEdges`).

## Design choices that bound the cost

* Instance buffers are re-uploaded only when the graph or an event changes. Layout
  transitions and activity decay are evaluated in shaders from timestamps.
* Particles are simulated in a compute shader (CPU fallback when compute is
  unavailable). Spawning is a ring buffer with no allocations.
* Labels are projected for at most 40 candidates, every second frame.
* Layout, indexing, git and SQLite run on worker threads. The GUI and render threads
  never wait on them.
* Quality presets scale render resolution, MSAA, bloom depth, particle count and glass.

## To do on real hardware

* Record the table above on an NVIDIA, AMD, Apple-silicon and Intel iGPU machine.
* Measure a large repository (10k+ files) for indexing time, layout time per
  algorithm, and frame time with ~30k node and ~60k edge instances.
* Profile with RenderDoc or Xcode GPU capture to rank the passes.
