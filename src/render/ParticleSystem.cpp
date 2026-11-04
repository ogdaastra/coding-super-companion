#include "ParticleSystem.h"
#include "RhiUtil.h"

#include <QRandomGenerator>
#include <algorithm>
#include <cmath>
#include <cstring>

namespace nexus::render {

namespace {

float hash11(float p)
{
    p = p * 0.1031f;
    p -= std::floor(p);
    p *= p + 33.33f;
    p *= p + p;
    return p - std::floor(p);
}

QVector3D randomDir(QRandomGenerator &rng)
{
    const float z = float(rng.generateDouble()) * 2.f - 1.f;
    const float phi = float(rng.generateDouble()) * 6.2831853f;
    const float r = std::sqrt(std::max(0.f, 1.f - z * z));
    return { r * std::cos(phi), z, r * std::sin(phi) };
}

QVector3D hashDir(float seed)
{
    const float z = hash11(seed) * 2.f - 1.f;
    const float phi = hash11(seed + 17.13f) * 6.2831853f;
    const float r = std::sqrt(std::max(0.f, 1.f - z * z));
    return { r * std::cos(phi), z, r * std::sin(phi) };
}

QVector3D v3(const float *f) { return { f[0], f[1], f[2] }; }

QVector3D bezier(const QVector3D &a, const QVector3D &c, const QVector3D &b, float t)
{
    const float u = 1.f - t;
    return u * u * a + 2.f * u * t * c + t * t * b;
}

} // namespace

void ParticleSystem::release()
{
    m_pipeline.reset();
    m_srb.reset();
    m_simUbo.reset();
    m_spawnBuf.reset();
    m_particles.reset();
    m_cpu.clear();
    m_capacity = 0;
    m_dust = 0;
    m_ringBase = 0;
}

bool ParticleSystem::create(QRhi *rhi, QRhiResourceUpdateBatch *updates, int capacity, int dustCount,
                            const QVector3D &nucleus, bool allowCompute)
{
    release();
    m_rhi = rhi;
    m_capacity = std::max(capacity, 1024);
    m_dust = std::clamp(dustCount, 0, m_capacity - 512);
    m_compute = allowCompute && rhi->isFeatureSupported(QRhi::Compute);

    // Initial state: dust distributed in a thick, slightly flattened shell; ring slots dead.
    m_cpu.assign(size_t(m_capacity), Particle{});
    QRandomGenerator rng(0x9E3779B9u);
    for (int i = 0; i < m_dust; ++i) {
        Particle &p = m_cpu[size_t(i)];
        const float u = float(rng.generateDouble());
        const float r = DustField::inner + (DustField::outer - DustField::inner) * std::pow(u, 1.35f);
        QVector3D d = randomDir(rng);
        d.setY(d.y() * (0.30f + 0.45f * float(rng.generateDouble())));
        d.normalize();
        const QVector3D pos = nucleus + d * r;
        store4(p.pos, pos.x(), pos.y(), pos.z(), 0.f);
        store4(p.vel, 0.f, 0.f, 0.f, 0.f);
        const float h = float(rng.generateDouble());
        QVector3D col = h < 0.70f ? QVector3D(0.30f, 0.62f, 0.95f)
                     : h < 0.90f ? QVector3D(0.60f, 0.86f, 1.00f)
                                 : QVector3D(0.55f, 0.45f, 1.00f);
        const float brightness = 0.10f + 0.30f * std::pow(float(rng.generateDouble()), 3.0f);
        col *= brightness * (r < 40.f ? 1.4f : 1.0f);
        const float size = 0.10f + 0.22f * float(rng.generateDouble());
        store4(p.color, col.x(), col.y(), col.z(), size);
        store4(p.a, pos.x(), pos.y(), pos.z(), float(ParticleType::Dust));
        store4(p.b, 0.f, 0.f, 0.f, float(rng.generateDouble()) * 100.f);
        store4(p.c, r, 0.f, 0.f, 0.f);
    }

    const quint32 bytes = quint32(m_capacity) * sizeof(Particle);
    QRhiBuffer::UsageFlags usage = QRhiBuffer::VertexBuffer;
    if (m_compute)
        usage |= QRhiBuffer::StorageBuffer;
    m_particles.reset(rhi->newBuffer(QRhiBuffer::Static, usage, bytes));
    if (!m_particles->create())
        return false;
    updates->uploadStaticBuffer(m_particles.get(), 0, bytes, m_cpu.data());

    if (m_compute) {
        m_spawnBuf.reset(rhi->newBuffer(QRhiBuffer::Static, QRhiBuffer::StorageBuffer,
                                        kMaxSpawnCommands * sizeof(SpawnCommand)));
        m_simUbo.reset(rhi->newBuffer(QRhiBuffer::Dynamic, QRhiBuffer::UniformBuffer, sizeof(SimUniforms)));
        if (!m_spawnBuf->create() || !m_simUbo->create())
            return false;
        m_srb.reset(rhi->newShaderResourceBindings());
        m_srb->setBindings({
            QRhiShaderResourceBinding::uniformBuffer(0, QRhiShaderResourceBinding::ComputeStage, m_simUbo.get()),
            QRhiShaderResourceBinding::bufferLoadStore(1, QRhiShaderResourceBinding::ComputeStage, m_particles.get()),
            QRhiShaderResourceBinding::bufferLoad(2, QRhiShaderResourceBinding::ComputeStage, m_spawnBuf.get()),
        });
        if (!m_srb->create())
            return false;
        m_pipeline.reset(rhi->newComputePipeline());
        m_pipeline->setShaderStage({ QRhiShaderStage::Compute, loadShader(QStringLiteral("particles.comp")) });
        m_pipeline->setShaderResourceBindings(m_srb.get());
        if (!m_pipeline->create()) {
            qWarning("NEXUS: compute pipeline creation failed; falling back to CPU particles");
            m_compute = false;
            m_pipeline.reset();
            m_srb.reset();
        } else {
            m_cpu.clear();
            m_cpu.shrink_to_fit();
        }
    }
    return true;
}

int ParticleSystem::prepareSpawns(std::vector<SpawnCommand> &spawns)
{
    const int ringCap = m_capacity - m_dust;
    if (spawns.size() > size_t(kMaxSpawnCommands))
        spawns.resize(kMaxSpawnCommands);
    int total = 0;
    for (SpawnCommand &s : spawns) {
        int count = int(s.params[0]);
        count = std::clamp(count, 0, ringCap - total);
        s.params[0] = float(count);
        s.params[1] = float(total);
        total += count;
    }
    return total;
}

void ParticleSystem::simulate(QRhiCommandBuffer *cb, QRhiResourceUpdateBatch *&updates, float time, float dt,
                              const QVector3D &nucleus, float activity, std::vector<SpawnCommand> &spawns)
{
    if (!m_particles)
        return;
    if (!updates)
        updates = m_rhi->nextResourceUpdateBatch();
    const int ringCap = m_capacity - m_dust;
    const int spawnCount = prepareSpawns(spawns);

    if (m_compute) {
        if (!spawns.empty())
            updates->uploadStaticBuffer(m_spawnBuf.get(), 0, quint32(spawns.size() * sizeof(SpawnCommand)), spawns.data());
        SimUniforms u{};
        store4(u.time, time, dt, float(m_dust), float(m_capacity));
        store4(u.spawn, float(m_ringBase), float(spawnCount), float(spawns.size()), float(ringCap));
        store4(u.nucleus, nucleus.x(), nucleus.y(), nucleus.z(), activity);
        store4(u.field, DustField::inner, DustField::outer, DustField::swirl, DustField::noiseScale);
        updates->updateDynamicBuffer(m_simUbo.get(), 0, sizeof(SimUniforms), &u);

        cb->beginComputePass(updates);
        updates = nullptr;
        cb->setComputePipeline(m_pipeline.get());
        cb->setShaderResources(m_srb.get());
        cb->dispatch((m_capacity + 255) / 256, 1, 1);
        cb->endComputePass();
    } else {
        cpuSpawn(spawns, spawnCount);
        cpuStep(time, dt, nucleus, activity);
        updates->uploadStaticBuffer(m_particles.get(), 0, quint32(m_capacity * sizeof(Particle)), m_cpu.data());
    }
    if (ringCap > 0)
        m_ringBase = (m_ringBase + spawnCount) % ringCap;
    spawns.clear();
}

void ParticleSystem::cpuSpawn(const std::vector<SpawnCommand> &spawns, int spawnCount)
{
    const int ringCap = m_capacity - m_dust;
    for (const SpawnCommand &s : spawns) {
        const int count = int(s.params[0]);
        const int start = int(s.params[1]);
        for (int j = 0; j < count; ++j) {
            const int slot = m_dust + (m_ringBase + start + j) % ringCap;
            Particle &p = m_cpu[size_t(slot)];
            const float seed = s.params[2] + float(j) * 1.6180339f;
            const float spread = s.params[3];
            const float type = s.p0[3];
            const QVector3D a = v3(s.p0) + hashDir(seed + 1.f) * spread * hash11(seed + 11.f);
            const QVector3D b = v3(s.p1) + hashDir(seed + 2.f) * spread * hash11(seed + 12.f);
            const QVector3D c = v3(s.extra) + hashDir(seed + 3.f) * spread * 2.f * hash11(seed + 13.f);
            const float life = s.p1[3] * (0.75f + 0.5f * hash11(seed + 4.f));
            const float delay = s.extra[3] * hash11(seed + 5.f);
            store4(p.a, a.x(), a.y(), a.z(), type);
            store4(p.b, b.x(), b.y(), b.z(), seed);
            store4(p.c, c.x(), c.y(), c.z(), 0.f);
            store4(p.pos, a.x(), a.y(), a.z(), -delay);
            store4(p.vel, 0.f, 0.f, 0.f, life);
            store4(p.color, s.color[0], s.color[1], s.color[2], s.color[3] * (0.6f + 0.8f * hash11(seed + 6.f)));
            if (type > 2.5f && type < 3.5f) {
                const float speed = s.p1[0] * (0.35f + 0.65f * hash11(seed + 13.f));
                const QVector3D v = hashDir(seed + 7.f) * speed;
                store4(p.vel, v.x(), v.y(), v.z(), life);
                store4(p.pos, s.p0[0], s.p0[1], s.p0[2], -delay);
            } else if (type > 4.5f) {
                store4(p.pos, s.p0[0], s.p0[1], s.p0[2], -delay);
                p.color[3] = s.color[3];
            }
        }
    }
    Q_UNUSED(spawnCount);
}

void ParticleSystem::cpuStep(float time, float dt, const QVector3D &nucleus, float activity)
{
    for (int i = 0; i < m_capacity; ++i) {
        Particle &p = m_cpu[size_t(i)];
        const float type = p.a[3];
        if (type < 0.5f)
            continue;
        if (type < 1.5f) {
            const QVector3D pos = v3(p.pos);
            const QVector3D rel = pos - nucleus;
            const float r = rel.length();
            const QVector3D tangent = QVector3D::crossProduct(QVector3D(0, 1, 0), rel + QVector3D(1e-3f, 1e-3f, 1e-3f)).normalized();
            const float swirl = DustField::swirl * (1.f + activity * 1.6f) / std::sqrt(std::max(r, 1.f));
            const float s = DustField::noiseScale;
            const float seed = p.b[3];
            const QVector3D wander(std::sin(rel.y() * s + time * 0.07f + seed),
                                   std::sin(rel.z() * s + time * 0.05f + seed * 1.7f),
                                   std::sin(rel.x() * s + time * 0.06f + seed * 2.3f));
            QVector3D v = tangent * swirl * 6.f + wander * 0.35f;
            v += -rel.normalized() * (r - p.c[0]) * 0.05f;
            const QVector3D np = pos + v * dt;
            store4(p.vel, v.x(), v.y(), v.z(), p.vel[3]);
            store4(p.pos, np.x(), np.y(), np.z(), p.pos[3] + dt);
            continue;
        }
        if (p.pos[3] < 0.f) {
            p.pos[3] += dt;
            continue;
        }
        p.pos[3] += dt;
        const float life = p.vel[3];
        if (p.pos[3] > life) {
            p.a[3] = 0.f;
            continue;
        }
        const float k = p.pos[3] / life;
        if (type < 2.5f) {
            const float e = k * k * (3.f - 2.f * k);
            const QVector3D prev = v3(p.pos);
            const QVector3D np = bezier(v3(p.a), v3(p.c), v3(p.b), e);
            const QVector3D v = (np - prev) / std::max(dt, 1e-4f);
            store4(p.vel, v.x(), v.y(), v.z(), life);
            p.pos[0] = np.x(); p.pos[1] = np.y(); p.pos[2] = np.z();
        } else if (type < 3.5f) {
            QVector3D v = v3(p.vel);
            const QVector3D np = v3(p.pos) + v * dt;
            v *= std::exp(-dt * 2.2f);
            store4(p.vel, v.x(), v.y(), v.z(), life);
            p.pos[0] = np.x(); p.pos[1] = np.y(); p.pos[2] = np.z();
        } else if (type < 4.5f) {
            QVector3D rel = v3(p.pos) - nucleus;
            const float ang = dt * 0.8f;
            const float cs = std::cos(ang), sn = std::sin(ang);
            rel = QVector3D(cs * rel.x() - sn * rel.z(), rel.y(), sn * rel.x() + cs * rel.z());
            const QVector3D np = nucleus + rel;
            p.pos[0] = np.x(); p.pos[1] = np.y(); p.pos[2] = np.z();
        }
    }
}

} // namespace nexus::render
