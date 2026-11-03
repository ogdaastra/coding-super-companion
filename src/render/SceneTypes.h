#pragma once

// GPU-facing data layouts shared by the GUI-thread scene (NexusViewport) and the
// render-thread renderer (NexusRenderer). Every struct here is mirrored exactly in
// the GLSL sources under shaders/. Change both together.

#include <QVector3D>
#include <QVector4D>
#include <QMatrix4x4>
#include <array>
#include <cstdint>
#include <vector>

namespace nexus::render {

// Node kinds, mirrored in node.vert / node.frag.
enum class NodeKind : int {
    File = 0,
    Directory = 1,
    Symbol = 2,
    Agent = 3,      // orbiting agent beacon; position evaluated in-shader from orbit params
    Nucleus = 4,    // the central agent core
    Lattice = 5,    // structural chassis point (not project data)
    Knowledge = 6,  // documentation / configuration / instructions
};

// Git state codes stored in NodeInstance::misc.w
enum class GitCode : int { Clean = 0, Modified = 1, Added = 2, Deleted = 3, Untracked = 4, Conflict = 5 };

// 80 bytes, per-instance vertex data.
struct NodeInstance {
    float startPos[3];  float radius;           // attr: vec4 startRadius
    float targetPos[3]; float transitionStart;  // attr: vec4 targetT0   (seconds, renderer clock)
    float color[4];                             // attr: vec4 color      (rgb HDR base, a = opacity)
    float act[4];                               // attr: vec4 activity   (lastRead, lastWrite, lastError, lastPulse)
    float misc[4];                              // attr: vec4 misc       (kind, highlight, heat, gitCode)
};
static_assert(sizeof(NodeInstance) == 80);

// Edge render modes
enum class EdgeMode : int { Bezier = 0, SphericalArc = 1, Ring = 2 };
// Edge semantic kinds
enum class EdgeKind : int { Containment = 0, Import = 1, Structure = 2, AgentLink = 3, Knowledge = 4 };

// 112 bytes, per-instance. For Ring mode: a = centre, aT = u*radius, b = v*radius.
struct EdgeInstance {
    float a[3];  float tA;       // endpoint A start position, transition start
    float aT[3]; float pad0;     // endpoint A target position
    float b[3];  float tB;       // endpoint B start position, transition start
    float bT[3]; float pad1;     // endpoint B target position
    float color[4];              // rgb HDR, a = opacity
    float params[4];             // mode, kind, width(px), curvature | arcFraction
    float extra[4];              // lastActivity, flowSpeed, dashDensity, phase/rotationSpeed
};
static_assert(sizeof(EdgeInstance) == 112);

// Particle types, mirrored in particles.comp / particle.vert
enum class ParticleType : int { Dead = 0, Dust = 1, Path = 2, Burst = 3, Orbit = 4, ShockRing = 5 };

// 96 bytes, std430-compatible (all vec4).
struct Particle {
    float pos[4];    // xyz, w = age (s); age < 0 means delayed start
    float vel[4];    // xyz, w = life (s)
    float color[4];  // rgb HDR, a = size (world units)
    float a[4];      // path: start xyz, type
    float b[4];      // path: end xyz, seed
    float c[4];      // path: control xyz, flags
};
static_assert(sizeof(Particle) == 96);

// 80 bytes, std430. A request to spawn `count` particles of one type.
struct SpawnCommand {
    float p0[4];      // start xyz, type
    float p1[4];      // end xyz, life
    float color[4];   // rgb HDR, size
    float params[4];  // count, prefixStart, seed, spread
    float extra[4];   // control xyz (path), stagger (s)
};
static_assert(sizeof(SpawnCommand) == 80);

// std140 frame uniforms shared by every scene shader. 416 bytes.
struct FrameUniforms {
    float viewProj[16];     // clipCorr * proj * view
    float view[16];
    float proj[16];
    float invViewProj[16];  // inverse(clipCorr * proj * view)
    float cameraPos[4];     // xyz, w = time (s)
    float viewport[4];      // w, h, 1/w, 1/h (pixels of the HDR target)
    float params[4];        // globalActivity, depthZeroToOne, pixelScale, transitionDuration
    float cameraRight[4];
    float cameraUp[4];
    float nucleus[4];       // xyz, w = nucleus radius
    float tint[4];          // rgb global alert tint, a = intensity
    float mode[4];          // vizMode, selectedPulse, focusActive, heatScale
};
static_assert(sizeof(FrameUniforms) == 64 * 4 + 16 * 8);

struct PostUniforms {
    float params0[4];  // exposure, bloomIntensity, vignette, grain
    float params1[4];  // time, chromatic, threshold, knee
    float texel[4];    // 1/w, 1/h of source, upsample weight, isFirst
    float grade[4];    // shadow tint strength, highlight tint strength, saturation, contrast
    float misc[4];     // flipY, aspect, 0, 0
};
static_assert(sizeof(PostUniforms) == 80);

struct SimUniforms {
    float time[4];   // t, dt, ambientCount, totalCount
    float spawn[4];  // ringBase, spawnCount, cmdCount, ringCapacity
    float nucleus[4];// xyz, globalActivity
    float field[4];  // dust radius inner, outer, swirl, noiseScale
};

// Quality preset parameters.
struct QualitySettings {
    int preset = 2;            // 0 low … 3 ultra
    float renderScale = 1.0f;
    int msaa = 4;
    int bloomLevels = 6;
    int particleCapacity = 65536;
    int dustCount = 12000;
    bool glass = true;

    static QualitySettings fromPreset(int p);
};

inline QualitySettings QualitySettings::fromPreset(int p)
{
    QualitySettings q;
    q.preset = p;
    switch (p) {
    case 0: q.renderScale = 0.75f; q.msaa = 1; q.bloomLevels = 4; q.particleCapacity = 8192;  q.dustCount = 2500;  q.glass = false; break;
    case 1: q.renderScale = 1.0f;  q.msaa = 1; q.bloomLevels = 5; q.particleCapacity = 32768; q.dustCount = 7000;  q.glass = true;  break;
    case 3: q.renderScale = 1.25f; q.msaa = 4; q.bloomLevels = 6; q.particleCapacity = 196608; q.dustCount = 48000; q.glass = true; break;
    default: q.renderScale = 1.0f; q.msaa = 4; q.bloomLevels = 6; q.particleCapacity = 65536; q.dustCount = 14000; q.glass = true; break;
    }
    return q;
}

inline void storeMatrix(float dst[16], const QMatrix4x4 &m)
{
    // QMatrix4x4::constData() is column-major, which is what std140 mat4 expects.
    const float *s = m.constData();
    for (int i = 0; i < 16; ++i) dst[i] = s[i];
}

inline void store3(float dst[3], const QVector3D &v) { dst[0] = v.x(); dst[1] = v.y(); dst[2] = v.z(); }
inline void store4(float dst[4], const QVector4D &v) { dst[0] = v.x(); dst[1] = v.y(); dst[2] = v.z(); dst[3] = v.w(); }
inline void store4(float dst[4], float x, float y, float z, float w) { dst[0] = x; dst[1] = y; dst[2] = z; dst[3] = w; }

// The transition easing used by both the shader and CPU-side picking.
inline float easeInOutCubic(float t)
{
    t = t < 0.f ? 0.f : (t > 1.f ? 1.f : t);
    return t < 0.5f ? 4.f * t * t * t : 1.f - ((-2.f * t + 2.f) * (-2.f * t + 2.f) * (-2.f * t + 2.f)) / 2.f;
}

} // namespace nexus::render
