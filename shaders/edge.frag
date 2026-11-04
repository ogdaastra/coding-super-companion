#version 440

layout(location = 0) in vec4 v_color;
layout(location = 1) in vec2 v_tSide;
layout(location = 2) in vec4 v_params;
layout(location = 3) in vec4 v_extra;
layout(location = 4) in float v_widthPx;
layout(location = 5) in float v_depthFade;

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

const vec3 GLACIER = vec3(0.867, 0.965, 1.000);

void main()
{
    float now = fr.cameraPos.w;
    float t = v_tSide.x;
    float side = abs(v_tSide.y);
    float kind = v_params.y;

    // Analytic AA across the ribbon plus a soft energy profile toward the centre line.
    float aa = 1.0 - smoothstep(1.0 - 1.5 / max(v_widthPx, 1.0), 1.0, side);
    if (side > 1.0) aa = max(0.0, 1.0 - (side - 1.0) * v_widthPx);
    float profile = mix(1.0, exp(-side * side * 2.2), 0.6);
    float thin = min(v_widthPx, 1.0);

    float intensity = 1.0;

    // Flow: dashes moving from A to B convey dependency direction.
    float flowSpeed = v_extra.y;
    float dashDensity = v_extra.z;
    if (flowSpeed > 0.0 && v_params.x < 1.5) {
        float d = fract(t * dashDensity - now * flowSpeed);
        float dash = smoothstep(0.0, 0.08, d) * smoothstep(0.55, 0.25, d);
        intensity = 0.35 + dash * 0.9;
    }

    // Activity: an energy packet travelling along the edge after an event.
    float lastAct = v_extra.x;
    float age = now - lastAct;
    vec3 col = v_color.rgb;
    if (age >= 0.0 && age < 3.0 && v_params.x < 1.5) {
        float head = clamp(age / 0.9, 0.0, 1.2);
        float packet = exp(-pow((t - head) * 9.0, 2.0)) * (1.0 - smoothstep(0.9, 1.2, head));
        float afterglow = exp(-age * 1.4) * 0.6;
        intensity += packet * 5.0 + afterglow;
        col = mix(col, GLACIER, clamp(packet, 0.0, 1.0) * 0.7);
    }

    // Structural rings fade toward their ends when partial.
    if (v_params.x > 1.5 && v_params.w < 0.999) {
        intensity *= smoothstep(0.0, 0.08, t) * smoothstep(1.0, 0.92, t);
    }

    float a = aa * profile * thin * v_color.a * intensity * mix(0.35, 1.0, v_depthFade);
    fragColor = vec4(col * a, 0.0);
}
