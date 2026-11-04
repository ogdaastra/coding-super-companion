#version 440
// NEXUS environment: deep-space volume, fine starfield, the core's atmospheric light
// and a polar technical grid far below the structure. Output is linear HDR.

layout(location = 0) in vec2 v_ndc;
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

float hash13(vec3 p3)
{
    p3 = fract(p3 * 0.1031);
    p3 += dot(p3, p3.zyx + 31.32);
    return fract((p3.x + p3.y) * p3.z);
}

vec3 hash33(vec3 p3)
{
    p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yxz + 33.33);
    return fract((p3.xxy + p3.yxx) * p3.zyx);
}

float noise3(vec3 x)
{
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = hash13(i);
    float n100 = hash13(i + vec3(1, 0, 0));
    float n010 = hash13(i + vec3(0, 1, 0));
    float n110 = hash13(i + vec3(1, 1, 0));
    float n001 = hash13(i + vec3(0, 0, 1));
    float n101 = hash13(i + vec3(1, 0, 1));
    float n011 = hash13(i + vec3(0, 1, 1));
    float n111 = hash13(i + vec3(1, 1, 1));
    return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
               mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}

float fbm(vec3 p)
{
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; ++i) {
        v += a * noise3(p);
        p = p * 2.03 + vec3(17.1, 3.7, 9.2);
        a *= 0.5;
    }
    return v;
}

// One layer of stars on the direction sphere. Cells on a scaled direction lattice,
// each optionally containing one star. Sizes are kept close to a pixel.
vec3 starLayer(vec3 dir, float scale, float density, float time)
{
    vec3 p = dir * scale;
    vec3 cell = floor(p);
    vec3 h = hash33(cell);
    if (h.x > density)
        return vec3(0.0);
    vec3 starPos = cell + 0.2 + 0.6 * hash33(cell + 7.7);
    float d = length(p - starPos);
    float px = fwidth(p.x) + fwidth(p.y);
    float core = smoothstep(max(px * 1.25, 0.02), 0.0, d);
    float twinkle = 0.75 + 0.25 * sin(time * (0.6 + h.y * 2.3) + h.z * 40.0);
    vec3 tint = mix(vec3(0.70, 0.84, 1.00), vec3(0.86, 0.80, 1.00), h.y);
    tint = mix(tint, vec3(1.0, 0.92, 0.82), step(0.93, h.z) * 0.6);
    float mag = pow(h.z, 6.0) * 2.4 + 0.12;
    return tint * core * twinkle * mag;
}

void main()
{
    float near = fr.params.y > 0.5 ? 0.0 : -1.0;
    vec4 a = fr.invViewProj * vec4(v_ndc, near, 1.0);
    vec4 b = fr.invViewProj * vec4(v_ndc, 1.0, 1.0);
    vec3 ro = fr.cameraPos.xyz;
    vec3 rd = normalize(b.xyz / b.w - a.xyz / a.w);
    float time = fr.cameraPos.w;
    float activity = fr.params.x;

    // Base: near-black abyss with a faint midnight lift toward the zenith.
    vec3 abyss = vec3(0.0016, 0.0026, 0.0055);
    vec3 midnight = vec3(0.0042, 0.0085, 0.0210);
    vec3 col = mix(abyss, midnight, smoothstep(-0.6, 0.9, rd.y));

    // Deep-space volume: two slow noise fields, blue body with violet fringes.
    vec3 q = rd * 1.7 + vec3(0.0, time * 0.0025, 0.0);
    float n1 = fbm(q);
    float n2 = fbm(rd * 4.3 + vec3(n1 * 1.5, 11.0, 4.0));
    float cloud = smoothstep(0.42, 0.95, n1) * (0.45 + 0.55 * n2);
    vec3 nebulaBlue = vec3(0.008, 0.020, 0.052);
    vec3 nebulaViolet = vec3(0.020, 0.010, 0.046);
    col += mix(nebulaBlue, nebulaViolet, smoothstep(0.3, 0.8, n2)) * cloud * 1.35;
    // fine dust lanes that absorb a little light
    float lanes = smoothstep(0.55, 0.75, fbm(rd * 9.0 + 3.0));
    col *= 1.0 - lanes * 0.35;

    // Stars: three layers from dense/faint to sparse/bright.
    col += starLayer(rd, 220.0, 0.030, time) * 0.30;
    col += starLayer(rd, 110.0, 0.035, time) * 0.65;
    col += starLayer(rd, 55.0, 0.020, time) * 0.95;

    // Atmospheric light around the core, brighter with real agent activity.
    vec3 toCore = fr.nucleus.xyz - ro;
    float coreDist = length(toCore);
    vec3 dn = toCore / max(coreDist, 1e-3);
    float cosA = max(dot(rd, dn), 0.0);
    float glowTight = pow(cosA, 900.0 * clamp(coreDist / 160.0, 0.25, 4.0));
    float glowWide = pow(cosA, 24.0);
    float glowHaze = pow(cosA, 4.0);
    vec3 coreLight = vec3(0.10, 0.42, 0.75);
    col += coreLight * (glowTight * 0.20 + glowWide * 0.045 + glowHaze * 0.010) * (0.55 + activity * 1.2);

    // Polar technical grid on a plane far below the structure.
    float floorY = fr.nucleus.y - 78.0;
    if (rd.y < -0.001 && ro.y > floorY) {
        float t = (floorY - ro.y) / rd.y;
        vec3 hit = ro + rd * t;
        vec2 rel = hit.xz - fr.nucleus.xz;
        float r = length(rel);
        float theta = atan(rel.y, rel.x);

        float ringMinor = abs(fract(r / 12.0 + 0.5) - 0.5) * 12.0;
        float ringMajor = abs(fract(r / 60.0 + 0.5) - 0.5) * 60.0;
        float fwR = fwidth(r);
        float lineMinor = 1.0 - smoothstep(0.0, fwR * 1.2, ringMinor);
        float lineMajor = 1.0 - smoothstep(0.0, fwR * 1.6, ringMajor);

        float seg = theta / 6.2831853 * 72.0;
        float radial = abs(fract(seg + 0.5) - 0.5);
        float fwS = fwidth(seg);
        float lineRadial = (1.0 - smoothstep(0.0, fwS * 1.2, radial)) * step(24.0, r);
        float segMajor = theta / 6.2831853 * 12.0;
        float radialMajor = abs(fract(segMajor + 0.5) - 0.5);
        float lineRadialMajor = 1.0 - smoothstep(0.0, fwidth(segMajor) * 1.5, radialMajor);

        float fade = exp(-r / 210.0) * exp(-t / 600.0);
        float horizon = smoothstep(0.0, 0.18, -rd.y);
        vec3 gridColor = vec3(0.10, 0.28, 0.48);
        float g = lineMinor * 0.10 + lineMajor * 0.30 + lineRadial * 0.06 + lineRadialMajor * 0.18;
        col += gridColor * g * fade * horizon * 0.85;

        // Reflection of the core's light pooled on the grid plane.
        float pool = exp(-r * r / (2.0 * 70.0 * 70.0));
        col += vec3(0.03, 0.10, 0.20) * pool * 0.10 * (0.5 + activity) * horizon;
    }

    // Global alert tint (failures), applied very gently to the environment only.
    col = mix(col, col + fr.tint.rgb * 0.02, fr.tint.a);

    fragColor = vec4(col, 1.0);
}
