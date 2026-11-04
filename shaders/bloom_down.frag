#version 440
// 13-tap downsample (Jimenez, "Next Generation Post Processing in Call of Duty: AW").
// The first level applies a soft-knee threshold and a Karis average to suppress fireflies.

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

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

vec3 prefilter(vec3 c)
{
    float threshold = pp.params1.z;
    float knee = threshold * pp.params1.w + 1e-4;
    float br = max(c.r, max(c.g, c.b));
    float rq = clamp(br - threshold + knee, 0.0, 2.0 * knee);
    rq = (rq * rq) / (4.0 * knee);
    float w = max(rq, br - threshold) / max(br, 1e-4);
    return c * w;
}

vec3 karis(vec3 a, vec3 b, vec3 c, vec3 d)
{
    float wa = 1.0 / (1.0 + luma(a));
    float wb = 1.0 / (1.0 + luma(b));
    float wc = 1.0 / (1.0 + luma(c));
    float wd = 1.0 / (1.0 + luma(d));
    return (a * wa + b * wb + c * wc + d * wd) / (wa + wb + wc + wd);
}

void main()
{
    vec2 t = pp.texel.xy;
    vec2 uv = v_uv;
    vec3 a = texture(src, uv + t * vec2(-2.0, -2.0)).rgb;
    vec3 b = texture(src, uv + t * vec2( 0.0, -2.0)).rgb;
    vec3 c = texture(src, uv + t * vec2( 2.0, -2.0)).rgb;
    vec3 d = texture(src, uv + t * vec2(-2.0,  0.0)).rgb;
    vec3 e = texture(src, uv).rgb;
    vec3 f = texture(src, uv + t * vec2( 2.0,  0.0)).rgb;
    vec3 g = texture(src, uv + t * vec2(-2.0,  2.0)).rgb;
    vec3 h = texture(src, uv + t * vec2( 0.0,  2.0)).rgb;
    vec3 i = texture(src, uv + t * vec2( 2.0,  2.0)).rgb;
    vec3 j = texture(src, uv + t * vec2(-1.0, -1.0)).rgb;
    vec3 k = texture(src, uv + t * vec2( 1.0, -1.0)).rgb;
    vec3 l = texture(src, uv + t * vec2(-1.0,  1.0)).rgb;
    vec3 m = texture(src, uv + t * vec2( 1.0,  1.0)).rgb;

    vec3 result;
    if (pp.texel.w > 0.5) {
        vec3 g0 = karis(j, k, l, m);
        vec3 g1 = karis(a, b, d, e);
        vec3 g2 = karis(b, c, e, f);
        vec3 g3 = karis(d, e, g, h);
        vec3 g4 = karis(e, f, h, i);
        result = g0 * 0.5 + (g1 + g2 + g3 + g4) * 0.125;
        result = prefilter(result);
    } else {
        result = e * 0.125;
        result += (a + c + g + i) * 0.03125;
        result += (b + d + f + h) * 0.0625;
        result += (j + k + l + m) * 0.125;
    }
    fragColor = vec4(max(result, vec3(0.0)), 1.0);
}
