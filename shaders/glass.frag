#version 440
// NEXUS glass material (Qt Quick ShaderEffect). A chamfered pane (top-left and
// bottom-right corners cut at 45°) that lets the blurred scene bleed through, with an
// edge lit from the upper-left and fine blue-noise grain.

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    vec4 srcRect;      // panel rectangle in backdrop texture coordinates
    vec2 itemSize;     // panel size in pixels
    float chamfer;     // corner cut in pixels
    float lit;         // edge light strength
    float tint;        // how much of the scene shows through
    float fill;        // base opacity
    vec4 accent;       // accent colour for the focus edge
    float accentMix;
};

layout(binding = 1) uniform sampler2D source;

float hash12(vec2 p)
{
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

void main()
{
    vec2 p = qt_TexCoord0 * itemSize;
    vec2 s = itemSize;
    float c = chamfer;
    float rectD = max(max(-p.x, p.x - s.x), max(-p.y, p.y - s.y));
    float tl = (c - (p.x + p.y)) * 0.70710678;
    float br = ((p.x + p.y) - (s.x + s.y - c)) * 0.70710678;
    float d = max(rectD, max(tl, br));
    float a = clamp(0.5 - d, 0.0, 1.0);
    if (a <= 0.0)
        discard;

    // scene behind the pane (quarter-res, mip-filtered texture)
    vec2 uv = srcRect.xy + qt_TexCoord0 * srcRect.zw;
    vec2 o = srcRect.zw / max(itemSize, vec2(1.0)) * 6.0;
    vec3 scene = texture(source, uv).rgb * 0.36
               + texture(source, uv + vec2(o.x, 0.0)).rgb * 0.16
               + texture(source, uv - vec2(o.x, 0.0)).rgb * 0.16
               + texture(source, uv + vec2(0.0, o.y)).rgb * 0.16
               + texture(source, uv - vec2(0.0, o.y)).rgb * 0.16;

    vec3 base = vec3(0.034, 0.046, 0.068);
    float vgrad = 1.0 - qt_TexCoord0.y * 0.25;
    vec3 col = base * vgrad + scene * tint;

    // edge: 1px line just inside the boundary, lit from the upper-left
    float edge = 1.0 - smoothstep(0.0, 1.25, abs(d + 0.75));
    float key = clamp(1.15 - (qt_TexCoord0.x * 0.55 + qt_TexCoord0.y * 0.75), 0.18, 1.0);
    vec3 edgeCol = mix(vec3(0.55, 0.78, 1.0) * 0.32, accent.rgb * 0.9, accentMix);
    col += edgeCol * edge * key * lit;
    // the chamfer facets catch a little extra light
    float facet = (1.0 - smoothstep(0.0, 1.5, abs(tl + 0.75))) * step(rectD, -0.5);
    col += vec3(0.75, 0.9, 1.0) * facet * 0.22 * lit;

    col += (hash12(p) - 0.5) * 0.012;
    float alpha = a * max(fill, edge * 0.9);
    fragColor = vec4(col * alpha, alpha) * qt_Opacity;
}
