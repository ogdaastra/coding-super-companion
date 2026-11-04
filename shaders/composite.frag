#version 440
// Final composite: HDR scene + bloom → exposure → filmic tone map → split-tone grade →
// vignette → subtle radial chromatic fringe → sRGB encode → dithered grain.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform Post {
    vec4 params0;  // exposure, bloomIntensity, vignette, grain
    vec4 params1;  // time, chromatic, threshold, knee
    vec4 texel;    // 1/w, 1/h of output
    vec4 grade;    // shadowTint, highlightTint, saturation, contrast
    vec4 misc;     // flipY, aspect
} pp;

layout(binding = 1) uniform sampler2D sceneTex;
layout(binding = 2) uniform sampler2D bloomTex;

vec3 rrtAndOdtFit(vec3 v)
{
    vec3 a = v * (v + 0.0245786) - 0.000090537;
    vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
    return a / b;
}

vec3 acesFitted(vec3 color)
{
    const mat3 inputMat = mat3(0.59719, 0.07600, 0.02840,
                               0.35458, 0.90834, 0.13383,
                               0.04823, 0.01566, 0.83777);
    const mat3 outputMat = mat3(1.60475, -0.10208, -0.00327,
                               -0.53108, 1.10813, -0.07276,
                               -0.07367, -0.00605, 1.07602);
    color = inputMat * color;
    color = rrtAndOdtFit(color);
    color = outputMat * color;
    return clamp(color, 0.0, 1.0);
}

vec3 linearToSrgb(vec3 c)
{
    vec3 lo = c * 12.92;
    vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
    return mix(lo, hi, step(vec3(0.0031308), c));
}

float hash12(vec2 p)
{
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

void main()
{
    vec2 uv = v_uv;
    vec2 dir = uv - 0.5;
    float r2 = dot(dir, dir);

    float ca = pp.params1.y * r2;
    vec3 hdr;
    hdr.r = texture(sceneTex, uv - dir * ca).r;
    hdr.g = texture(sceneTex, uv).g;
    hdr.b = texture(sceneTex, uv + dir * ca).b;

    vec3 bloom = texture(bloomTex, uv).rgb;
    vec3 c = hdr + bloom * pp.params0.y;
    c *= pp.params0.x;

    vec3 mapped = acesFitted(c * 1.25);

    // Split-tone grade: cool, deep shadows; ice-white highlights.
    float l = dot(mapped, vec3(0.2126, 0.7152, 0.0722));
    vec3 shadowTint = vec3(0.88, 0.96, 1.12);
    vec3 highlightTint = vec3(0.97, 1.0, 1.03);
    mapped = mix(mapped, mapped * shadowTint, (1.0 - smoothstep(0.0, 0.35, l)) * pp.grade.x);
    mapped = mix(mapped, mapped * highlightTint, smoothstep(0.45, 1.0, l) * pp.grade.y);
    mapped = mix(vec3(l), mapped, pp.grade.z);
    mapped = clamp((mapped - 0.5) * pp.grade.w + 0.5, 0.0, 1.0);

    // Vignette (aspect-aware).
    vec2 vd = dir * vec2(pp.misc.y, 1.0);
    float vig = smoothstep(1.15, 0.25, length(vd) * 1.25);
    mapped *= mix(1.0 - pp.params0.z, 1.0, vig);

    vec3 srgb = linearToSrgb(max(mapped, vec3(0.0)));

    // Triangular-ish dither + film grain, essential on near-black gradients.
    vec2 px = uv / pp.texel.xy;
    float n = hash12(px + fract(pp.params1.x * 7.13) * 61.0) + hash12(px * 1.37 + 17.0) - 1.0;
    srgb += n * (pp.params0.w / 255.0);

    fragColor = vec4(srgb, 1.0);
}
