#include "NexusRenderer.h"
#include "NexusViewport.h"
#include "RhiUtil.h"

#include <QElapsedTimer>
#include <algorithm>
#include <cmath>

namespace nexus::render {

namespace {
constexpr int kRibbonSegments = 40;
}

NexusRenderer::NexusRenderer() = default;

NexusRenderer::~NexusRenderer()
{
    releaseAll();
}

void NexusRenderer::releaseAll()
{
    m_bloom.release();
    m_particles.release();
    m_compositePs.reset();
    m_compositeSrb.reset();
    m_envPs.reset();
    m_nodeCorePs.reset();
    m_nodeHaloPs.reset();
    m_edgePs.reset();
    m_particlePs.reset();
    m_sceneRt.reset();
    m_sceneRp.reset();
    m_sceneTex.reset();
    m_sceneMsaa.reset();
    m_sceneDepth.reset();
    m_nodeBuf.reset();
    m_edgeBuf.reset();
    m_nodeCapacity = m_edgeCapacity = 0;
    m_nodesVersion = m_edgesVersion = ~0ull;
    m_srbFrame.reset();
    m_srbNodeCore.reset();
    m_srbNodeHalo.reset();
    m_frameUbo.reset();
    m_passCoreUbo.reset();
    m_passHaloUbo.reset();
    m_postUbo.reset();
    m_quadVbuf.reset();
    m_ribbonVbuf.reset();
    m_linearSampler.reset();
    m_hdrSize = {};
    m_msaa = 0;
    m_particleCapacity = 0;
    m_compositeRp = nullptr;
}

bool NexusRenderer::createStatic(QRhiResourceUpdateBatch *u)
{
    static const float quad[] = { -1.f, -1.f, 1.f, -1.f, -1.f, 1.f, 1.f, 1.f };
    m_quadVbuf.reset(m_rhi->newBuffer(QRhiBuffer::Immutable, QRhiBuffer::VertexBuffer, sizeof(quad)));
    if (!m_quadVbuf->create())
        return false;
    u->uploadStaticBuffer(m_quadVbuf.get(), quad);

    std::vector<float> ribbon;
    ribbon.reserve((kRibbonSegments + 1) * 4);
    for (int i = 0; i <= kRibbonSegments; ++i) {
        const float t = float(i) / float(kRibbonSegments);
        ribbon.insert(ribbon.end(), { t, -1.f, t, 1.f });
    }
    m_ribbonVertexCount = (kRibbonSegments + 1) * 2;
    m_ribbonVbuf.reset(m_rhi->newBuffer(QRhiBuffer::Immutable, QRhiBuffer::VertexBuffer,
                                        quint32(ribbon.size() * sizeof(float))));
    if (!m_ribbonVbuf->create())
        return false;
    u->uploadStaticBuffer(m_ribbonVbuf.get(), ribbon.data());

    m_frameUbo.reset(m_rhi->newBuffer(QRhiBuffer::Dynamic, QRhiBuffer::UniformBuffer, sizeof(FrameUniforms)));
    m_passCoreUbo.reset(m_rhi->newBuffer(QRhiBuffer::Dynamic, QRhiBuffer::UniformBuffer, 16));
    m_passHaloUbo.reset(m_rhi->newBuffer(QRhiBuffer::Dynamic, QRhiBuffer::UniformBuffer, 16));
    m_postUbo.reset(m_rhi->newBuffer(QRhiBuffer::Dynamic, QRhiBuffer::UniformBuffer, sizeof(PostUniforms)));
    if (!m_frameUbo->create() || !m_passCoreUbo->create() || !m_passHaloUbo->create() || !m_postUbo->create())
        return false;
    const float core[4] = { 0.f, 0.f, 0.f, 0.f };
    const float halo[4] = { 1.f, 0.f, 0.f, 0.f };
    u->updateDynamicBuffer(m_passCoreUbo.get(), 0, 16, core);
    u->updateDynamicBuffer(m_passHaloUbo.get(), 0, 16, halo);

    const auto vf = QRhiShaderResourceBinding::VertexStage | QRhiShaderResourceBinding::FragmentStage;
    m_srbFrame.reset(m_rhi->newShaderResourceBindings());
    m_srbFrame->setBindings({ QRhiShaderResourceBinding::uniformBuffer(0, vf, m_frameUbo.get()) });
    m_srbNodeCore.reset(m_rhi->newShaderResourceBindings());
    m_srbNodeCore->setBindings({ QRhiShaderResourceBinding::uniformBuffer(0, vf, m_frameUbo.get()),
                                 QRhiShaderResourceBinding::uniformBuffer(1, vf, m_passCoreUbo.get()) });
    m_srbNodeHalo.reset(m_rhi->newShaderResourceBindings());
    m_srbNodeHalo->setBindings({ QRhiShaderResourceBinding::uniformBuffer(0, vf, m_frameUbo.get()),
                                 QRhiShaderResourceBinding::uniformBuffer(1, vf, m_passHaloUbo.get()) });
    if (!m_srbFrame->create() || !m_srbNodeCore->create() || !m_srbNodeHalo->create())
        return false;

    m_linearSampler.reset(m_rhi->newSampler(QRhiSampler::Linear, QRhiSampler::Linear, QRhiSampler::None,
                                            QRhiSampler::ClampToEdge, QRhiSampler::ClampToEdge));
    return m_linearSampler->create();
}

bool NexusRenderer::createTargets(QSize hdrSize, int msaa)
{
    m_sceneRt.reset();
    m_sceneRp.reset();
    m_sceneTex.reset();
    m_sceneMsaa.reset();
    m_sceneDepth.reset();

    const QList<int> counts = m_rhi->supportedSampleCounts();
    int samples = 1;
    for (int c : counts)
        if (c <= msaa)
            samples = std::max(samples, c);
    m_msaa = samples;
    m_hdrSize = hdrSize;

    m_sceneTex.reset(m_rhi->newTexture(QRhiTexture::RGBA16F, hdrSize, 1, QRhiTexture::RenderTarget));
    if (!m_sceneTex->create())
        return false;
    m_sceneDepth.reset(m_rhi->newRenderBuffer(QRhiRenderBuffer::DepthStencil, hdrSize, samples));
    if (!m_sceneDepth->create())
        return false;

    QRhiTextureRenderTargetDescription desc;
    if (samples > 1) {
        m_sceneMsaa.reset(m_rhi->newRenderBuffer(QRhiRenderBuffer::Color, hdrSize, samples, {}, QRhiTexture::RGBA16F));
        if (!m_sceneMsaa->create())
            return false;
        QRhiColorAttachment att(m_sceneMsaa.get());
        att.setResolveTexture(m_sceneTex.get());
        desc.setColorAttachments({ att });
    } else {
        desc.setColorAttachments({ QRhiColorAttachment(m_sceneTex.get()) });
    }
    desc.setDepthStencilBuffer(m_sceneDepth.get());
    m_sceneRt.reset(m_rhi->newTextureRenderTarget(desc));
    m_sceneRp.reset(m_sceneRt->newCompatibleRenderPassDescriptor());
    m_sceneRt->setRenderPassDescriptor(m_sceneRp.get());
    if (!m_sceneRt->create())
        return false;

    if (!m_bloom.resize(m_rhi, m_sceneTex.get(), hdrSize, m_snap.quality.bloomLevels))
        return false;
    m_bloomLevels = m_snap.quality.bloomLevels;
    return createScenePipelines() && createComposite();
}

bool NexusRenderer::createScenePipelines()
{
    // Environment
    {
        PipelineDesc d;
        d.vs = loadShader(QStringLiteral("fullscreen_env.vert"));
        d.fs = loadShader(QStringLiteral("environment.frag"));
        d.sampleCount = m_msaa;
        d.srb = m_srbFrame.get();
        d.rp = m_sceneRp.get();
        m_envPs = makePipeline(m_rhi, d);
    }
    // Nodes: quad corners + per-instance NodeInstance
    QRhiVertexInputLayout nodeLayout;
    nodeLayout.setBindings({ { 2 * sizeof(float) },
                             { sizeof(NodeInstance), QRhiVertexInputBinding::PerInstance } });
    nodeLayout.setAttributes({
        { 0, 0, QRhiVertexInputAttribute::Float2, 0 },
        { 1, 1, QRhiVertexInputAttribute::Float4, 0 },
        { 1, 2, QRhiVertexInputAttribute::Float4, 16 },
        { 1, 3, QRhiVertexInputAttribute::Float4, 32 },
        { 1, 4, QRhiVertexInputAttribute::Float4, 48 },
        { 1, 5, QRhiVertexInputAttribute::Float4, 64 },
    });
    {
        PipelineDesc d;
        d.vs = loadShader(QStringLiteral("node.vert"));
        d.fs = loadShader(QStringLiteral("node.frag"));
        d.inputLayout = nodeLayout;
        d.topology = QRhiGraphicsPipeline::TriangleStrip;
        d.depthTest = true;
        d.depthWrite = true;
        d.sampleCount = m_msaa;
        d.srb = m_srbNodeCore.get();
        d.rp = m_sceneRp.get();
        m_nodeCorePs = makePipeline(m_rhi, d);

        d.depthWrite = false;
        d.blend = Blend::Additive;
        d.srb = m_srbNodeHalo.get();
        m_nodeHaloPs = makePipeline(m_rhi, d);
    }
    // Edges: ribbon strip + per-instance EdgeInstance
    {
        QRhiVertexInputLayout l;
        l.setBindings({ { 2 * sizeof(float) },
                        { sizeof(EdgeInstance), QRhiVertexInputBinding::PerInstance } });
        QList<QRhiVertexInputAttribute> attrs;
        attrs.append({ 0, 0, QRhiVertexInputAttribute::Float2, 0 });
        for (int i = 0; i < 7; ++i)
            attrs.append({ 1, i + 1, QRhiVertexInputAttribute::Float4, quint32(i * 16) });
        l.setAttributes(attrs.cbegin(), attrs.cend());
        PipelineDesc d;
        d.vs = loadShader(QStringLiteral("edge.vert"));
        d.fs = loadShader(QStringLiteral("edge.frag"));
        d.inputLayout = l;
        d.topology = QRhiGraphicsPipeline::TriangleStrip;
        d.blend = Blend::Additive;
        d.depthTest = true;
        d.sampleCount = m_msaa;
        d.srb = m_srbFrame.get();
        d.rp = m_sceneRp.get();
        m_edgePs = makePipeline(m_rhi, d);
    }
    // Particles: quad + per-instance Particle (first four vec4s)
    {
        QRhiVertexInputLayout l;
        l.setBindings({ { 2 * sizeof(float) },
                        { sizeof(Particle), QRhiVertexInputBinding::PerInstance } });
        l.setAttributes({
            { 0, 0, QRhiVertexInputAttribute::Float2, 0 },
            { 1, 1, QRhiVertexInputAttribute::Float4, 0 },
            { 1, 2, QRhiVertexInputAttribute::Float4, 16 },
            { 1, 3, QRhiVertexInputAttribute::Float4, 32 },
            { 1, 4, QRhiVertexInputAttribute::Float4, 48 },
        });
        PipelineDesc d;
        d.vs = loadShader(QStringLiteral("particle.vert"));
        d.fs = loadShader(QStringLiteral("particle.frag"));
        d.inputLayout = l;
        d.topology = QRhiGraphicsPipeline::TriangleStrip;
        d.blend = Blend::Additive;
        d.depthTest = true;
        d.sampleCount = m_msaa;
        d.srb = m_srbFrame.get();
        d.rp = m_sceneRp.get();
        m_particlePs = makePipeline(m_rhi, d);
    }
    return m_envPs && m_nodeCorePs && m_nodeHaloPs && m_edgePs && m_particlePs;
}

bool NexusRenderer::createComposite()
{
    if (!m_bloom.output())
        return false;
    m_compositeSrb.reset(m_rhi->newShaderResourceBindings());
    const auto vf = QRhiShaderResourceBinding::VertexStage | QRhiShaderResourceBinding::FragmentStage;
    m_compositeSrb->setBindings({
        QRhiShaderResourceBinding::uniformBuffer(0, vf, m_postUbo.get()),
        QRhiShaderResourceBinding::sampledTexture(1, QRhiShaderResourceBinding::FragmentStage, m_sceneTex.get(), m_linearSampler.get()),
        QRhiShaderResourceBinding::sampledTexture(2, QRhiShaderResourceBinding::FragmentStage, m_bloom.output(), m_linearSampler.get()),
    });
    if (!m_compositeSrb->create())
        return false;
    PipelineDesc d;
    d.vs = loadShader(QStringLiteral("fullscreen.vert"));
    d.fs = loadShader(QStringLiteral("composite.frag"));
    d.srb = m_compositeSrb.get();
    d.rp = renderTarget()->renderPassDescriptor();
    d.sampleCount = renderTarget()->sampleCount();
    m_compositePs = makePipeline(m_rhi, d);
    m_compositeRp = d.rp;
    return bool(m_compositePs);
}

void NexusRenderer::initialize(QRhiCommandBuffer *cb)
{
    if (m_rhi != rhi()) {
        releaseAll();
        m_rhi = rhi();
        QRhiResourceUpdateBatch *u = m_rhi->nextResourceUpdateBatch();
        if (!createStatic(u)) {
            qWarning("NEXUS: failed to create static render resources");
            u->release();
            return;
        }
        cb->resourceUpdate(u);
        m_stats.backend = QString::fromLatin1(m_rhi->backendName());
        m_stats.computeParticles = m_rhi->isFeatureSupported(QRhi::Compute);
    }
    m_outputSize = renderTarget()->pixelSize();
    m_targetsDirty = true;
}

void NexusRenderer::synchronize(QQuickRhiItem *item)
{
    auto *vp = static_cast<NexusViewport *>(item);
    vp->exchangeRenderData(m_snap, m_stats);
}

void NexusRenderer::growBuffer(std::unique_ptr<QRhiBuffer> &buf, quint32 &capacity, quint32 needed)
{
    if (buf && needed <= capacity)
        return;
    quint32 cap = std::max<quint32>(needed, 4096);
    cap = std::max(cap, capacity + capacity / 2);
    buf.reset(m_rhi->newBuffer(QRhiBuffer::Static, QRhiBuffer::VertexBuffer, cap));
    if (!buf->create()) {
        buf.reset();
        capacity = 0;
        return;
    }
    capacity = cap;
}

void NexusRenderer::uploadInstances(QRhiResourceUpdateBatch *u)
{
    if (m_snap.nodes && m_snap.nodesVersion != m_nodesVersion) {
        const quint32 bytes = quint32(m_snap.nodes->size() * sizeof(NodeInstance));
        m_nodeCount = int(m_snap.nodes->size());
        if (bytes > 0) {
            growBuffer(m_nodeBuf, m_nodeCapacity, bytes);
            if (m_nodeBuf)
                u->uploadStaticBuffer(m_nodeBuf.get(), 0, bytes, m_snap.nodes->data());
        }
        m_nodesVersion = m_snap.nodesVersion;
    }
    if (m_snap.edges && m_snap.edgesVersion != m_edgesVersion) {
        const quint32 bytes = quint32(m_snap.edges->size() * sizeof(EdgeInstance));
        m_edgeCount = int(m_snap.edges->size());
        if (bytes > 0) {
            growBuffer(m_edgeBuf, m_edgeCapacity, bytes);
            if (m_edgeBuf)
                u->uploadStaticBuffer(m_edgeBuf.get(), 0, bytes, m_snap.edges->data());
        }
        m_edgesVersion = m_snap.edgesVersion;
    }
}

void NexusRenderer::render(QRhiCommandBuffer *cb)
{
    if (!m_rhi || !m_frameUbo)
        return;
    QElapsedTimer timer;
    timer.start();

    const QualitySettings &q = m_snap.quality;
    const QSize hdrSize(std::max(16, int(std::lround(m_outputSize.width() * q.renderScale))),
                        std::max(16, int(std::lround(m_outputSize.height() * q.renderScale))));
    if (m_targetsDirty || hdrSize != m_hdrSize || q.msaa != m_requestedMsaa
        || q.bloomLevels != m_bloomLevels || m_compositeRp != renderTarget()->renderPassDescriptor()) {
        if (!createTargets(hdrSize, q.msaa)) {
            qWarning("NEXUS: failed to create render targets");
            return;
        }
        m_requestedMsaa = q.msaa;
        m_targetsDirty = false;
    }

    QRhiResourceUpdateBatch *u = m_rhi->nextResourceUpdateBatch();
    if (q.particleCapacity != m_particleCapacity || q.dustCount != m_dustCount) {
        m_particles.create(m_rhi, u, q.particleCapacity, q.dustCount, m_snap.nucleus, true);
        m_particleCapacity = q.particleCapacity;
        m_dustCount = q.dustCount;
        m_stats.computeParticles = m_particles.usesCompute();
    }

    // Frame uniforms
    const QMatrix4x4 corr = m_rhi->clipSpaceCorrMatrix();
    const QMatrix4x4 projC = corr * m_snap.proj;
    const QMatrix4x4 viewProj = projC * m_snap.view;
    FrameUniforms f{};
    storeMatrix(f.viewProj, viewProj);
    storeMatrix(f.view, m_snap.view);
    storeMatrix(f.proj, projC);
    storeMatrix(f.invViewProj, viewProj.inverted());
    store4(f.cameraPos, m_snap.cameraPos.x(), m_snap.cameraPos.y(), m_snap.cameraPos.z(), m_snap.time);
    store4(f.viewport, float(m_hdrSize.width()), float(m_hdrSize.height()),
           1.f / float(m_hdrSize.width()), 1.f / float(m_hdrSize.height()));
    store4(f.params, m_snap.globalActivity, m_rhi->isClipDepthZeroToOne() ? 1.f : 0.f,
           m_snap.pixelScale * q.renderScale, m_snap.transitionDuration);
    store4(f.cameraRight, m_snap.cameraRight.x(), m_snap.cameraRight.y(), m_snap.cameraRight.z(), 0.f);
    store4(f.cameraUp, m_snap.cameraUp.x(), m_snap.cameraUp.y(), m_snap.cameraUp.z(), 0.f);
    store4(f.nucleus, m_snap.nucleus.x(), m_snap.nucleus.y(), m_snap.nucleus.z(), m_snap.nucleusRadius);
    store4(f.tint, m_snap.tint);
    store4(f.mode, m_snap.mode);
    u->updateDynamicBuffer(m_frameUbo.get(), 0, sizeof(FrameUniforms), &f);

    uploadInstances(u);

    // Particle simulation (compute pass or CPU upload) before the scene pass.
    m_particles.simulate(cb, u, m_snap.time, std::clamp(m_snap.dt, 0.0f, 0.1f), m_snap.nucleus,
                         m_snap.globalActivity, m_snap.spawns);

    // ---------------------------------------------------------------- scene pass
    cb->beginPass(m_sceneRt.get(), QColor::fromRgbF(0.f, 0.f, 0.f, 1.f), { 1.0f, 0 }, u);
    u = nullptr;
    const QRhiViewport vp(0, 0, float(m_hdrSize.width()), float(m_hdrSize.height()));

    cb->setGraphicsPipeline(m_envPs.get());
    cb->setViewport(vp);
    cb->setShaderResources(m_srbFrame.get());
    cb->draw(3);

    if (m_nodeBuf && m_nodeCount > 0) {
        const QRhiCommandBuffer::VertexInput in[] = { { m_quadVbuf.get(), 0 }, { m_nodeBuf.get(), 0 } };
        cb->setGraphicsPipeline(m_nodeCorePs.get());
        cb->setViewport(vp);
        cb->setShaderResources(m_srbNodeCore.get());
        cb->setVertexInput(0, 2, in);
        cb->draw(4, quint32(m_nodeCount));
    }
    if (m_edgeBuf && m_edgeCount > 0) {
        const QRhiCommandBuffer::VertexInput in[] = { { m_ribbonVbuf.get(), 0 }, { m_edgeBuf.get(), 0 } };
        cb->setGraphicsPipeline(m_edgePs.get());
        cb->setViewport(vp);
        cb->setShaderResources(m_srbFrame.get());
        cb->setVertexInput(0, 2, in);
        cb->draw(quint32(m_ribbonVertexCount), quint32(m_edgeCount));
    }
    if (m_nodeBuf && m_nodeCount > 0) {
        const QRhiCommandBuffer::VertexInput in[] = { { m_quadVbuf.get(), 0 }, { m_nodeBuf.get(), 0 } };
        cb->setGraphicsPipeline(m_nodeHaloPs.get());
        cb->setViewport(vp);
        cb->setShaderResources(m_srbNodeHalo.get());
        cb->setVertexInput(0, 2, in);
        cb->draw(4, quint32(m_nodeCount));
    }
    if (m_particles.buffer()) {
        const QRhiCommandBuffer::VertexInput in[] = { { m_quadVbuf.get(), 0 }, { m_particles.buffer(), 0 } };
        cb->setGraphicsPipeline(m_particlePs.get());
        cb->setViewport(vp);
        cb->setShaderResources(m_srbFrame.get());
        cb->setVertexInput(0, 2, in);
        cb->draw(4, quint32(m_particles.capacity()));
    }
    cb->endPass();

    // ---------------------------------------------------------------- post
    const bool flipY = m_rhi->isYUpInNDC() && !m_rhi->isYUpInFramebuffer();
    PostUniforms post{};
    store4(post.params0, m_snap.exposure, m_snap.bloomIntensity, 0.42f, 1.6f);
    store4(post.params1, m_snap.time, 0.012f, 0.9f, 0.6f);
    store4(post.grade, 0.65f, 0.4f, 0.96f, 1.04f);
    QRhiResourceUpdateBatch *pu = nullptr;
    m_bloom.record(cb, pu, post, flipY);

    const QSize out = renderTarget()->pixelSize();
    store4(post.texel, 1.f / float(out.width()), 1.f / float(out.height()), 0.f, 0.f);
    store4(post.misc, flipY ? 1.f : 0.f, float(out.width()) / float(std::max(1, out.height())), 0.f, 0.f);
    pu = m_rhi->nextResourceUpdateBatch();
    pu->updateDynamicBuffer(m_postUbo.get(), 0, sizeof(PostUniforms), &post);

    cb->beginPass(renderTarget(), QColor::fromRgbF(0.f, 0.f, 0.f, 1.f), { 1.0f, 0 }, pu);
    cb->setGraphicsPipeline(m_compositePs.get());
    cb->setViewport({ 0, 0, float(out.width()), float(out.height()) });
    cb->setShaderResources(m_compositeSrb.get());
    cb->draw(3);
    cb->endPass();

    const double gpu = cb->lastCompletedGpuTime();
    m_stats.gpuMs = gpu > 0.0 ? float(gpu * 1000.0) : -1.f;
    m_stats.renderCpuMs = float(timer.nsecsElapsed()) / 1.0e6f;
    m_stats.nodeCount = m_nodeCount;
    m_stats.edgeCount = m_edgeCount;
    m_stats.particleCapacity = m_particles.capacity();
    m_stats.msaa = m_msaa;
    m_stats.targetSize = m_hdrSize;
}

} // namespace nexus::render
