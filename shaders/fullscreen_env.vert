#version 440
// Fullscreen triangle for the procedural environment. The fragment shader reconstructs
// world-space view rays from NDC, so no texture-coordinate convention is involved.
layout(location = 0) out vec2 v_ndc;

void main()
{
    vec2 p = vec2(float((gl_VertexIndex << 1) & 2), float(gl_VertexIndex & 2));
    v_ndc = p * 2.0 - 1.0;
    gl_Position = vec4(v_ndc, 0.0, 1.0);
}
