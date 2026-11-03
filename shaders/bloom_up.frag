#version 440
// 3x3 tent upsample, blended additively into the next larger mip.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform Post {
    vec4 params0;
    vec4 params1;
    vec4 texel;
    vec4 grade;
    vec4 misc;
} pp;

layout(binding = 1) uniform sampler2D src;

void main()
{
    vec2 t = pp.texel.xy * 1.15;
    vec2 uv = v_uv;
    vec3 s = texture(src, uv).rgb * 4.0;
    s += (texture(src, uv + vec2(-t.x, 0.0)).rgb + texture(src, uv + vec2(t.x, 0.0)).rgb
        + texture(src, uv + vec2(0.0, -t.y)).rgb + texture(src, uv + vec2(0.0, t.y)).rgb) * 2.0;
    s += texture(src, uv + vec2(-t.x, -t.y)).rgb + texture(src, uv + vec2(t.x, -t.y)).rgb
       + texture(src, uv + vec2(-t.x, t.y)).rgb + texture(src, uv + vec2(t.x, t.y)).rgb;
    fragColor = vec4(s / 16.0 * pp.texel.z, 1.0);
}
