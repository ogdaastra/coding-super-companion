#version 440
// Fullscreen triangle for texture-to-texture passes. uv = ndc * 0.5 + 0.5 is
// self-consistent on OpenGL and Vulkan; Metal and D3D need a flip, signalled by misc.x.

layout(std140, binding = 0) uniform Post {
    vec4 params0;
    vec4 params1;
    vec4 texel;
    vec4 grade;
    vec4 misc;
} pp;

layout(location = 0) out vec2 v_uv;

void main()
{
    vec2 p = vec2(float((gl_VertexIndex << 1) & 2), float(gl_VertexIndex & 2));
    vec2 ndc = p * 2.0 - 1.0;
    v_uv = ndc * 0.5 + 0.5;
    if (pp.misc.x > 0.5)
        v_uv.y = 1.0 - v_uv.y;
    gl_Position = vec4(ndc, 0.0, 1.0);
}
