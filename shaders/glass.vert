#version 440
// Vertex stage for the glass ShaderEffect, compiled with the same GLSL targets as
// glass.frag so varyings match on every backend.

layout(location = 0) in vec4 qt_Vertex;
layout(location = 1) in vec2 qt_MultiTexCoord0;
layout(location = 0) out vec2 qt_TexCoord0;

layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    vec4 srcRect;
    vec2 itemSize;
    float chamfer;
    float lit;
    float tint;
    float fill;
    vec4 accent;
    float accentMix;
};

void main()
{
    qt_TexCoord0 = qt_MultiTexCoord0;
    gl_Position = qt_Matrix * qt_Vertex;
}
