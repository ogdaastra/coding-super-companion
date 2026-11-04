# NEXUS — Design System

NEXUS should read as an *instrument*: a precise, lit, layered environment. The 3D
viewport is always the dominant element; every panel is a pane of glass over it.

## 1. Principles

1. **Light is information.** Glow is reserved for things that are happening. An idle
   environment is dim, cool and slow. Brightness, warmth and motion rise with activity.
2. **Light illuminates surfaces.** Panels pick up a faint tint from the scene behind them
   (sampled, blurred viewport) and their edges catch light from the upper left. Nothing
   is fluorescent for its own sake.
3. **Precision over decoration.** Hairlines, registration ticks, tabular numerals, exact
   alignment on a 4 px grid. No decorative graphics in empty space — empty states explain.
4. **One shape language.** Chamfered (45° cut) corners, never generic rounded rectangles.
5. **Motion communicates.** Every animation encodes a state change, a direction of flow
   or a spatial relationship. Idle motion is procedural, slow and peripheral.

## 2. Colour

All values are sRGB. The renderer works in linear HDR and tone maps to these targets.

### Foundation

| Token | Hex | Use |
| --- | --- | --- |
| `void` | `#02040A` | Deepest background, letterbox |
| `abyss` | `#050912` | Environment base |
| `midnight` | `#0A1328` | Deep midnight blue, nebula body |
| `graphite` | `#0E141D` | Panel base (at 72–86 % opacity) |
| `graphiteRaised` | `#141B26` | Raised controls |
| `steel` | `#263142` | Inactive strokes, dividers |
| `hairline` | `#8CBEFF` @ 10 % | 1 px rules |

### Signal

| Token | Hex | Use |
| --- | --- | --- |
| `cyan` | `#3FD4FF` | Primary accent, write/edit energy, focus |
| `ice` | `#9BE7FF` | Reads, information flowing *in* |
| `glacier` | `#DDF6FF` | White-blue highlights, completion |
| `violet` | `#9A86FF` | Commands/exec, agents |
| `indigo` | `#5664D9` | Search, structure, secondary accent |
| `amber` | `#FFB547` | Waiting/permission, conflicts — used sparingly |
| `alert` | `#FF4D5E` | Failures — controlled, never large fills |
| `aurora` | `#4FE3C1` | Passing tests only |

### Text

| Token | Hex |
| --- | --- |
| `textPrimary` | `#E6F1FF` |
| `textSecondary` | `#9DB0C8` |
| `textTertiary` | `#62738B` |
| `textFaint` | `#3A4659` |

### Event signature colours

| Category | Colour | Visual signature in the CORE |
| --- | --- | --- |
| read | ice | particles stream *from* the file node *to* the nucleus |
| write | cyan → glacier core | energy pulse nucleus → file, then ripples along dependents |
| search | indigo | scanning sweep across the matched region |
| exec | violet | shock-ring at the nucleus |
| web | `#6FB7FF` | outward ray burst |
| agent | violet | sub-orbit spawned on the agent ring |
| mcp | `#5EE1E6` | ring glyph |
| waiting | amber | slow breathing of the agent ring |
| error | alert | controlled red disturbance (jitter + red halo) around the affected node |
| complete | glacier | settling wave propagating outward through touched nodes |

## 3. Typography

* **Inter** (UI) and **JetBrains Mono** (data, paths, code) — bundled, OFL licensed.
* Tabular numerals (`tnum`) everywhere numbers update live.
* Micro labels: uppercase, +12 % letter spacing, `textTertiary`.

| Role | Font | Size / weight | Tracking |
| --- | --- | --- | --- |
| Display | Inter Light | 34 / 300 | −1 % |
| Title | Inter SemiBold | 17 / 600 | 0 |
| Heading | Inter Medium | 13.5 / 500 | +1 % |
| Body | Inter | 12.5 / 400 | 0 |
| Caption | Inter | 11.5 / 400 | 0 |
| Micro | Inter SemiBold | 10 / 600, uppercase | +12 % |
| Data | JetBrains Mono | 11.5 / 400 | 0 |
| Metric | JetBrains Mono Medium | 20 / 500 | −2 % |

## 4. Space & shape

* 4 px base grid. Steps: 4, 8, 12, 16, 20, 24, 32, 48.
* Panel chamfer: 10 px. Control chamfer: 4 px. Chip chamfer: 3 px.
* Panel stroke: 1 px, linear gradient `glacier@22% → steel@40% → transparent` from the
  upper-left corner (the "key light").
* Corner registration ticks: 6 px L-marks in `cyan@55%` on focused panels.

## 5. Materials

| Material | Recipe |
| --- | --- |
| **Glass** | blurred viewport sample (¼ res, mip-filtered) × 0.55 + `graphite@80%`, 1.5 % blue noise, lit edge |
| **Holographic layer** | additive, scan-line free; fine 8 px technical grid at 4 % that fades with distance from the cursor |
| **Metal** (3D) | dark graphite base, GGX-like specular from a cool key light and a violet rim light |
| **Energy** (3D) | HDR emissive, feeds bloom; colour from event signature |
| **Lattice** (3D) | thin ribbons, depth-faded, 6–14 % brightness |

## 6. Motion

| Token | Duration | Curve | Use |
| --- | --- | --- | --- |
| `micro` | 120 ms | `outQuart` | hover, press |
| `standard` | 240 ms | `nexusOut` = cubic-bezier(0.16, 1, 0.3, 1) | panel content, chips |
| `emphasis` | 420 ms | `nexusOut` | panel open/close, mode change |
| `camera` | 900–1600 ms | `nexusInOut` = cubic-bezier(0.65, 0, 0.35, 1) | fly-to, presets |
| `layout` | 1800 ms | `nexusInOut` per node with stagger by graph distance | layout transitions |

Continuous camera input uses critically-damped springs (no overshoot). Nothing bounces.

## 7. Iconography

Custom stroke icons on a 20 px grid, 1.5 px stroke, square caps, drawn as vector paths
(`QtQuick.Shapes`) so they recolour and scale perfectly. No emoji anywhere.

## 8. States

* **Empty states** say what is missing and the one action that fixes it.
* **Loading** uses a thin indeterminate scan line along the panel's top edge plus
  determinate progress where the work is countable (files indexed / total).
* **Errors** are calm: alert-coloured hairline, plain-language message, details on demand.
* **Simulated data** always carries the amber-striped `SIMULATED` badge.
* **Inferred / unavailable** facts are shown in `textTertiary` with an explicit qualifier.
