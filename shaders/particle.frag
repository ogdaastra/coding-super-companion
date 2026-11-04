#version 440

layout(location = 0) in vec2 v_corner;
layout(location = 1) in vec3 v_color;
layout(location = 2) flat in float v_type;
layout(location = 3) in float v_fade;

layout(location = 0) out vec4 fragColor;

void main()
{
    float d = length(v_corner);
    if (d > 1.0)
        discard;
    vec3 col;
    if (v_type > 4.5) {
        float ring = exp(-pow((d - 0.93) * 26.0, 2.0)) + exp(-pow((d - 0.80) * 60.0, 2.0)) * 0.3;
        col = v_color * ring;
    } else {
        float soft = exp(-d * d * 4.5);
        float core = exp(-d * d * 28.0);
        col = v_color * (soft * 0.55 + core * 1.6);
    }
    fragColor = vec4(col * v_fade, 0.0);
}
