#version 440
// Node shading. Pass 0 ray-casts an exact sphere (with depth) and applies a per-kind
// material; pass 1 draws the additive halo: glow, selection reticle, git/conflict rings
// and the controlled red disturbance for failures.

layout(location = 0) in vec2 v_corner;
layout(location = 1) in vec3 v_viewPos;
layout(location = 2) in vec3 v_centerView;
layout(location = 3) in float v_radius;
layout(location = 4) in vec4 v_color;
layout(location = 5) in vec4 v_act;
layout(location = 6) in vec4 v_misc;
layout(location = 7) in vec2 v_halo;

layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform Frame {
    mat4 viewProj;
    mat4 view;
    mat4 proj;
    mat4 invViewProj;
    vec4 cameraPos;
    vec4 viewport;
    vec4 params;
    vec4 cameraRight;
    vec4 cameraUp;
    vec4 nucleus;
    vec4 tint;
    vec4 mode;
} fr;

layout(std140, binding = 1) uniform NodePass {
    vec4 passMode;
} ps;

const vec3 CYAN = vec3(0.247, 0.831, 1.000);
const vec3 ICE = vec3(0.608, 0.906, 1.000);
const vec3 GLACIER = vec3(0.867, 0.965, 1.000);
const vec3 VIOLET = vec3(0.604, 0.525, 1.000);
const vec3 AMBER = vec3(1.000, 0.710, 0.278);
const vec3 ALERT = vec3(1.000, 0.302, 0.369);
const vec3 AURORA = vec3(0.310, 0.890, 0.757);

float hash13(vec3 p3)
{
    p3 = fract(p3 * 0.1031);
    p3 += dot(p3, p3.zyx + 31.32);
    return fract((p3.x + p3.y) * p3.z);
}

float noise3(vec3 x)
{
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x),
                   mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x),
                   mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

float gridLine(float v, float cells)
{
    float x = v * cells;
    float d = abs(fract(x + 0.5) - 0.5);
    float w = fwidth(x);
    return 1.0 - smoothstep(0.0, w * 1.3, d);
}

vec3 gitColor(float code)
{
    if (code < 0.5) return vec3(0.0);
    if (code < 1.5) return CYAN;      // modified
    if (code < 2.5) return AURORA;    // added
    if (code < 3.5) return ALERT;     // deleted
    if (code < 4.5) return ICE * 0.8; // untracked
    return AMBER;                     // conflict
}

void main()
{
    float now = fr.cameraPos.w;
    float kind = v_misc.x;
    float highlight = v_misc.y;
    float heat = v_misc.z;
    float git = v_misc.w;
    float aRead = v_act.x, aWrite = v_act.y, aError = v_act.z, aPulse = v_act.w;

    if (ps.passMode.x < 0.5) {
        // ---------------------------------------------------------------- core
        vec3 rd = normalize(v_viewPos);
        vec3 c = v_centerView;
        float r = v_radius;
        float b = dot(rd, c);
        float cc = dot(c, c) - r * r;
        float h = b * b - cc;
        if (h < 0.0)
            discard;
        float t = b - sqrt(h);
        vec3 hit = rd * t;
        vec3 n = normalize(hit - c);
        vec3 V = -rd;
        vec3 nW = transpose(mat3(fr.view)) * n;   // world-space normal for procedural detail

        vec3 L = normalize(vec3(-0.45, 0.62, 0.64));
        vec3 L2 = normalize(vec3(0.75, -0.25, -0.55));
        float ndl = max(dot(n, L), 0.0);
        float ndv = max(dot(n, V), 0.0);
        vec3 H = normalize(L + V);
        float spec = pow(max(dot(n, H), 0.0), 72.0);
        float fres = pow(1.0 - ndv, 3.0);
        float rim2 = pow(max(dot(n, L2), 0.0), 2.0) * fres;

        // distance of the view ray to the sphere centre: 0 at centre, 1 at silhouette
        float dRay = length(cross(rd, c)) / r;
        float innerCore = exp(-dRay * dRay * 5.5);

        vec3 base = v_color.rgb;
        float emissive = 0.10 + heat * 0.55 + aRead * 1.4 + aWrite * 3.2 + aPulse * 1.6 + highlight * 0.9;
        vec3 actColor = base;
        actColor = mix(actColor, ICE, clamp(aRead, 0.0, 1.0) * 0.6);
        actColor = mix(actColor, GLACIER, clamp(aWrite, 0.0, 1.0) * 0.5);
        actColor = mix(actColor, ALERT, clamp(aError * 1.4, 0.0, 1.0));
        vec3 g = gitColor(git);

        vec3 col;
        if (abs(kind - 1.0) < 0.5) {
            // Directory: dark metallic hub with a lit meridian lattice
            // Directory hub: dark glass shell, a single lit equator band that tracks
            // the camera-facing hemisphere, and a bright inner core.
            float lat = asin(clamp(nW.y, -1.0, 1.0)) / 3.14159265 + 0.5;
            float equator = gridLine(lat, 1.0) * 0.0 + (1.0 - smoothstep(0.0, fwidth(lat) * 1.6, abs(lat - 0.5)));
            float bands = gridLine(lat, 4.0) * 0.35;
            vec3 metal = vec3(0.016, 0.022, 0.034) + base * 0.012;
            col = metal * (0.30 + ndl * 0.9) + vec3(0.75, 0.88, 1.0) * spec * 0.75;
            col += base * fres * (0.75 + emissive * 0.9);
            col += VIOLET * rim2 * 0.30;
            col += actColor * (equator * 0.55 + bands * 0.12) * (0.4 + emissive);
            col += actColor * innerCore * (0.10 + emissive * 0.5);
        } else if (abs(kind - 4.0) < 0.5) {
            // Nucleus: layered luminous plasma whose turbulence follows agent activity
            float act = fr.params.x;
            float n1 = noise3(nW * 3.2 + vec3(0.0, now * 0.12, 0.0));
            float n2 = noise3(nW * 8.0 - vec3(now * 0.25, 0.0, now * 0.1) + n1 * 2.0);
            float plasma = smoothstep(0.35, 0.9, n1 * 0.6 + n2 * 0.55);
            vec3 deep = vec3(0.02, 0.10, 0.24);
            vec3 hot = mix(CYAN, GLACIER, plasma);
            col = deep * (0.6 + ndl) + hot * plasma * (0.9 + act * 2.4);
            col += GLACIER * innerCore * (1.2 + act * 3.5);
            col += CYAN * fres * (1.4 + act * 2.0);
            col += VIOLET * rim2 * 0.6;
            col *= mix(vec3(1.0), vec3(1.0, 0.55, 0.55), fr.tint.a * 0.6);
        } else if (abs(kind - 3.0) < 0.5) {
            // Agent beacon: hot emissive marker with a glass rim
            col = base * (2.6 + emissive * 2.0) * (0.5 + innerCore) + GLACIER * fres * 1.5;
        } else if (abs(kind - 5.0) < 0.5) {
            // Lattice point (structure, not data): faint, cool
            col = base * (0.35 + innerCore * 0.8);
        } else if (abs(kind - 6.0) < 0.5) {
            // Knowledge: faceted crystal
            vec3 facet = normalize(floor(nW * 2.2 + 0.5));
            float fl = max(dot(transpose(mat3(fr.view)) * L, facet), 0.0);
            col = base * (0.05 + fl * 0.35) + base * fres * 0.9 + vec3(0.9, 0.95, 1.0) * spec * 0.6;
            col += actColor * innerCore * emissive * 0.8;
        } else {
            // File / symbol: glass bead with a luminous core
            vec3 glass = vec3(0.012, 0.018, 0.030) + base * 0.035;
            col = glass * (0.3 + ndl * 0.9);
            col += vec3(0.80, 0.92, 1.0) * spec * 0.85;
            col += base * fres * (0.30 + emissive * 0.35);
            col += VIOLET * rim2 * 0.18;
            col += actColor * innerCore * emissive * 0.9;
            col += g * fres * 0.9 + g * innerCore * 0.35;
        }

        // Depth fog toward the environment so distant structure recedes.
        float dist = length(hit);
        float fog = 1.0 - exp(-dist / 900.0);
        col = mix(col, vec3(0.002, 0.004, 0.010), fog * 0.75);

        fragColor = vec4(col * v_color.a, 1.0);
        vec4 clip = fr.proj * vec4(hit, 1.0);
        float ndcZ = clip.z / clip.w;
        gl_FragDepth = fr.params.y > 0.5 ? ndcZ : ndcZ * 0.5 + 0.5;
    } else {
        // ---------------------------------------------------------------- halo
        float hs = v_halo.x;
        float x = length(v_corner) * hs;          // distance from centre, in radii
        float angle = atan(v_corner.y, v_corner.x);
        float edge = smoothstep(hs, hs * 0.55, x);

        float energy = aRead * 0.7 + aWrite * 1.5 + aPulse * 0.8 + heat * 0.25 + highlight * 0.5;
        vec3 base = v_color.rgb;
        vec3 glowColor = base;
        glowColor = mix(glowColor, ICE, clamp(aRead, 0.0, 1.0) * 0.5);
        glowColor = mix(glowColor, GLACIER, clamp(aWrite, 0.0, 1.0) * 0.4);

        float falloff = exp(-max(x - 1.0, 0.0) * 2.2);
        float baseGlow = 0.018;
        if (abs(kind - 5.0) < 0.5) baseGlow = 0.05;
        if (abs(kind - 1.0) < 0.5) baseGlow = 0.03;
        vec3 col = glowColor * falloff * (baseGlow + energy * 0.55) * edge;

        if (abs(kind - 4.0) < 0.5) {
            float act = fr.params.x;
            float corona = exp(-max(x - 1.0, 0.0) * 0.9);
            col = mix(CYAN, ICE, 0.4) * corona * (0.12 + act * 0.35) * edge;
            // slow radiating rings from the nucleus
            float wave = fract(x * 0.35 - now * (0.18 + act * 0.25));
            col += CYAN * smoothstep(0.08, 0.0, abs(wave - 0.5)) * 0.05 * (0.4 + act) * edge * step(1.1, x);
        }

        // Git state ring
        float gitRing = exp(-pow((x - 1.45) * 14.0, 2.0)) * step(0.5, git);
        col += gitColor(git) * gitRing * 0.55;

        // Selection reticle: ring with rotating ticks
        if (highlight > 0.01) {
            float ring = exp(-pow((x - 1.9) * 22.0, 2.0));
            float ticks = step(0.55, fract(angle / 6.2831853 * 32.0 + now * 0.15));
            float outer = exp(-pow((x - 2.25) * 30.0, 2.0)) * ticks;
            col += GLACIER * (ring * 0.9 + outer * 0.6) * highlight;
        }

        // Controlled red disturbance for failures
        if (aError > 0.01) {
            float n = noise3(vec3(angle * 3.0, x * 2.0, now * 6.0));
            float shell = exp(-pow((x - 1.25 - n * 0.6) * 6.0, 2.0));
            col += ALERT * (shell * 0.9 + falloff * 0.25) * aError * edge;
        }

        fragColor = vec4(col * v_color.a, 0.0);
        gl_FragDepth = gl_FragCoord.z;
    }
}
