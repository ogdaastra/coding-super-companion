#pragma once

#include "SceneTypes.h"

#include <rhi/qrhi.h>
#include <QVector3D>
#include <memory>
#include <vector>

namespace nexus::render {

// Render-thread particle system. Uses a compute shader when QRhi::Compute is supported
// and an equivalent CPU integrator otherwise. Either way the result lives in one buffer
// that is bound as per-instance vertex input for drawing.
class ParticleSystem
{
public:
    static constexpr int kMaxSpawnCommands = 256;

    bool create(QRhi *rhi, QRhiResourceUpdateBatch *updates, int capacity, int dustCount,
                const QVector3D &nucleus, bool allowCompute);
    void release();

    // Records the compute pass (GPU) or uploads the CPU-integrated state. Must be called
    // outside of a render pass, before the scene pass that draws the particles.
    void simulate(QRhiCommandBuffer *cb, QRhiResourceUpdateBatch *&updates, float time, float dt,
                  const QVector3D &nucleus, float activity, std::vector<SpawnCommand> &spawns);

    QRhiBuffer *buffer() const { return m_particles.get(); }
    int capacity() const { return m_capacity; }
    int dustCount() const { return m_dust; }
    bool usesCompute() const { return m_compute; }

private:
    int prepareSpawns(std::vector<SpawnCommand> &spawns);
    void cpuSpawn(const std::vector<SpawnCommand> &spawns, int spawnCount);
    void cpuStep(float time, float dt, const QVector3D &nucleus, float activity);

    QRhi *m_rhi = nullptr;
    bool m_compute = false;
    int m_capacity = 0;
    int m_dust = 0;
    int m_ringBase = 0;

    std::unique_ptr<QRhiBuffer> m_particles;
    std::unique_ptr<QRhiBuffer> m_spawnBuf;
    std::unique_ptr<QRhiBuffer> m_simUbo;
    std::unique_ptr<QRhiShaderResourceBindings> m_srb;
    std::unique_ptr<QRhiComputePipeline> m_pipeline;

    std::vector<Particle> m_cpu;  // CPU fallback state (also used for the initial upload)
};

// Field parameters shared by the GPU and CPU integrators.
struct DustField {
    static constexpr float inner = 11.0f;
    static constexpr float outer = 175.0f;
    static constexpr float swirl = 0.55f;
    static constexpr float noiseScale = 0.045f;
};

} // namespace nexus::render
