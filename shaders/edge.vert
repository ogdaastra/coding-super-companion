#version 440
// Screen-space ribbons generated from per-instance curve descriptions.
// mode 0: quadratic Bézier between two (animated) endpoints, bent toward the nucleus
// mode 1: spherical arc around the nucleus (geodesic lattice)
// mode 2: circle / partial arc (gyroscopic rings), optionally rotating

layout(location = 0) in vec2 tSide;         // x: t along curve [0,1], y: side (-1 | 1)
layout(location = 1) in vec4 inA;           // A start xyz, transition start
layout(location = 2) in vec4 inAT;          // A target xyz
layout(location = 3) in vec4 inB;           // B start xyz, transition start
layout(location = 4) in vec4 inBT;          // B target xyz
layout(location = 5) in vec4 inColor;       // rgb HDR, a opacity
layout(location = 6) in vec4 inParams;      // mode, kind, width px, curvature | arcFraction
layout(location = 7) in vec4 inExtra;       // lastActivity, flowSpeed, dashDensity, phase | rotSpeed

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

layout(location = 0) out vec4 v_color;
layout(location = 1) out vec2 v_tSide;
layout(location = 2) out vec4 v_params;
layout(location = 3) out vec4 v_extra;
layout(location = 4) out float v_widthPx;
layout(location = 5) out float v_depthFade;

float easeInOutCubic(float t)
{
    t = clamp(t, 0.0, 1.0);
    return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) * 0.5;
}

vec3 curvePoint(float t, vec3 pa, vec3 pb, float mode, float shape)
{
    if (mode < 0.5) {
        vec3 mid = (pa + pb) * 0.5;
        vec3 ctrl = mix(mid, fr.nucleus.xyz, shape);
        float u = 1.0 - t;
        return u * u * pa + 2.0 * u * t * ctrl + t * t * pb;
    } else if (mode < 1.5) {
        vec3 ra = pa - fr.nucleus.xyz;
        vec3 rb = pb - fr.nucleus.xyz;
        vec3 dir = normalize(mix(ra, rb, t));
        return fr.nucleus.xyz + dir * mix(length(ra), length(rb), t);
    } else {
        float theta = 6.2831853 * t * shape + inExtra.w * fr.cameraPos.w + inExtra.z;
        return inA.xyz + cos(theta) * inAT.xyz + sin(theta) * inB.xyz;
    }
}

void main()
{
    float now = fr.cameraPos.w;
    float mode = inParams.x;
    float t = tSide.x;
    vec3 pa = inA.xyz;
    vec3 pb = inB.xyz;
    if (mode < 1.5) {
        float dur = max(fr.params.w, 1e-3);
        pa = mix(inA.xyz, inAT.xyz, easeInOutCubic((now - inA.w) / dur));
        pb = mix(inB.xyz, inBT.xyz, easeInOutCubic((now - inB.w) / dur));
    }

    vec3 P = curvePoint(t, pa, pb, mode, inParams.w);
    vec3 P2 = curvePoint(clamp(t + 0.01, 0.0, 1.0), pa, pb, mode, inParams.w);
    vec3 P0 = curvePoint(clamp(t - 0.01, 0.0, 1.0), pa, pb, mode, inParams.w);

    vec4 clipP = fr.viewProj * vec4(P, 1.0);
    vec4 clipN = fr.viewProj * vec4(P2, 1.0);
    vec4 clipB = fr.viewProj * vec4(P0, 1.0);

    float wClamp = 1e-4;
    vec2 sP = clipP.xy / max(clipP.w, wClamp) * fr.viewport.xy;
    vec2 sN = clipN.xy / max(clipN.w, wClamp) * fr.viewport.xy;
    vec2 sB = clipB.xy / max(clipB.w, wClamp) * fr.viewport.xy;
    vec2 dir = sN - sB;
    float len = length(dir);
    dir = len > 1e-5 ? dir / len : vec2(1.0, 0.0);
    vec2 normal = vec2(-dir.y, dir.x);

    float widthPx = max(inParams.z * fr.params.z, 0.5);
    float padded = widthPx + 1.5;   // room for analytic anti-aliasing
    vec2 offsetNdc = normal * tSide.y * padded * 0.5 / fr.viewport.xy * 2.0;
    clipP.xy += offsetNdc * clipP.w;
    if (clipP.w <= 0.0)
        clipP = vec4(2.0, 2.0, 2.0, 1.0);  // behind the camera: outside the clip volume

    float dist = length(P - fr.cameraPos.xyz);
    v_depthFade = exp(-dist / 700.0);
    v_color = inColor;
    v_tSide = vec2(t, tSide.y * padded / widthPx);
    v_params = inParams;
    v_extra = inExtra;
    v_widthPx = widthPx;
    gl_Position = clipP;
}
