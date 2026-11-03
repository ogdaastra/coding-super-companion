#version 440
// Instanced sphere impostors. Layout transitions and activity decay are evaluated here
// from timestamps, so instance data only changes when the graph or an event changes.

layout(location = 0) in vec2 corner;          // per-vertex quad corner in [-1, 1]
layout(location = 1) in vec4 startRadius;     // xyz start position, w radius
layout(location = 2) in vec4 targetT0;        // xyz target position, w transition start
layout(location = 3) in vec4 color;           // rgb base colour (HDR), a opacity
layout(location = 4) in vec4 activity;        // lastRead, lastWrite, lastError, lastPulse
layout(location = 5) in vec4 misc;            // kind, highlight, heat, gitCode

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

layout(std140, binding = 1) uniform Pass {
    vec4 pass;  // x: 0 core, 1 halo
} ps;

layout(location = 0) out vec2 v_corner;
layout(location = 1) out vec3 v_viewPos;
layout(location = 2) out vec3 v_centerView;
layout(location = 3) out float v_radius;
layout(location = 4) out vec4 v_color;
layout(location = 5) out vec4 v_act;      // read, write, error, pulse intensities (0..1)
layout(location = 6) out vec4 v_misc;     // kind, highlight, heat, gitCode
layout(location = 7) out vec2 v_halo;     // x: halo scale (radii), y: coverage

float easeInOutCubic(float t)
{
    t = clamp(t, 0.0, 1.0);
    return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) * 0.5;
}

float decay(float stamp, float now, float rate)
{
    float age = now - stamp;
    return age >= 0.0 ? exp(-age * rate) : 0.0;
}

void main()
{
    float now = fr.cameraPos.w;
    float kind = misc.x;
    vec3 center;
    if (abs(kind - 3.0) < 0.5) {
        // Agent beacon: orbit around the nucleus. start = u*R, target = v*R, w = phase, heat = speed
        float theta = targetT0.w + now * misc.z;
        center = fr.nucleus.xyz + cos(theta) * startRadius.xyz + sin(theta) * targetT0.xyz;
    } else {
        float k = easeInOutCubic((now - targetT0.w) / max(fr.params.w, 1e-3));
        center = mix(startRadius.xyz, targetT0.xyz, k);
    }

    float aRead = decay(activity.x, now, 1.1);
    float aWrite = decay(activity.y, now, 0.55);
    float aError = decay(activity.z, now, 0.30);
    float aPulse = decay(activity.w, now, 1.8);
    v_act = vec4(aRead, aWrite, aError, aPulse);

    float radius = startRadius.w;
    float highlight = misc.y;
    vec3 viewCenter = (fr.view * vec4(center, 1.0)).xyz;
    float dist = max(-viewCenter.z, 0.05);

    // Minimum on-screen size keeps distant nodes from shimmering; coverage fades them.
    // abs(): the clip-space correction flips Y (negative [1][1]) on Vulkan
    float pxPerUnit = abs(fr.proj[1][1]) * 0.5 * fr.viewport.y / dist;
    float pxRadius = radius * pxPerUnit;
    float minPx = 1.35 * fr.params.z;
    float coverage = 1.0;
    if (pxRadius < minPx) {
        coverage = max(pxRadius / minPx, 0.08);
        radius = minPx / pxPerUnit;
    }

    float energy = aRead * 0.8 + aWrite * 1.6 + aError * 1.2 + aPulse * 0.9 + misc.z * 0.35;
    float haloScale = 1.0;
    vec3 viewPos;
    if (ps.pass.x < 0.5) {
        // Core: quad pushed toward the camera by one radius, slightly oversized so the
        // perspective silhouette of the sphere is always covered.
        viewPos = viewCenter + vec3(corner * radius * 1.32, radius);
    } else {
        haloScale = 2.4 + energy * 2.6 + highlight * 1.4 + step(0.5, misc.w) * 0.5;
        if (abs(kind - 4.0) < 0.5) haloScale = 5.5 + fr.params.x * 3.0;
        if (abs(kind - 5.0) < 0.5) haloScale = 3.0;
        viewPos = viewCenter + vec3(corner * radius * haloScale, 0.0);
    }

    v_corner = corner;
    v_viewPos = viewPos;
    v_centerView = viewCenter;
    v_radius = radius;
    v_color = vec4(color.rgb, color.a * coverage);
    v_misc = misc;
    v_halo = vec2(haloScale, coverage);
    gl_Position = fr.proj * vec4(viewPos, 1.0);
}
