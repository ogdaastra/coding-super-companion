#version 440

layout(location = 0) in vec2 corner;
layout(location = 1) in vec4 pPos;    // xyz, age
layout(location = 2) in vec4 pVel;    // xyz, life
layout(location = 3) in vec4 pColor;  // rgb, size
layout(location = 4) in vec4 pA;      // start xyz, type

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

layout(location = 0) out vec2 v_corner;
layout(location = 1) out vec3 v_color;
layout(location = 2) flat out float v_type;
layout(location = 3) out float v_fade;

void main()
{
    float type = pA.w;
    float age = pPos.w;
    float life = pVel.w;
    if (type < 0.5 || age < 0.0 || (type > 1.5 && age > life)) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        v_corner = vec2(0.0); v_color = vec3(0.0); v_type = 0.0; v_fade = 0.0;
        return;
    }

    float size = pColor.a;
    float fade = 1.0;
    vec3 right = fr.cameraRight.xyz;
    vec3 up = fr.cameraUp.xyz;
    vec2 c = corner;

    if (type < 1.5) {
        // dust: twinkle, dimmer far away, brighter when the agent is active
        float tw = 0.6 + 0.4 * sin(fr.cameraPos.w * 0.9 + pVel.x * 3.0 + pPos.x);
        fade = tw * (0.55 + fr.params.x * 0.9);
    } else {
        float k = age / max(life, 1e-3);
        fade = smoothstep(0.0, 0.08, k) * (1.0 - smoothstep(0.65, 1.0, k));
        if (type > 4.5) {
            size = pColor.a * (0.15 + 0.85 * sqrt(k));
            fade = (1.0 - k) * (1.0 - k);
        }
    }

    // Motion stretch along the screen-projected velocity.
    if (type > 1.5 && type < 4.5) {
        vec3 v = pVel.xyz;
        vec3 vp = v - dot(v, normalize(fr.cameraPos.xyz - pPos.xyz)) * normalize(fr.cameraPos.xyz - pPos.xyz);
        float speed = length(vp);
        if (speed > 1e-3) {
            vec3 ax = vp / speed;
            vec3 ay = normalize(cross(ax, normalize(fr.cameraPos.xyz - pPos.xyz)));
            right = ax * (1.0 + min(speed * 0.06, 5.0));
            up = ay;
        }
    }

    vec3 world = pPos.xyz + (right * c.x + up * c.y) * size;
    v_corner = c;
    v_color = pColor.rgb;
    v_type = type;
    v_fade = fade;
    gl_Position = fr.viewProj * vec4(world, 1.0);
}
