#pragma once

#include "BloomChain.h"
#include "ParticleSystem.h"
#include "RenderSnapshot.h"

#include <QQuickRhiItemRenderer>
#include <rhi/qrhi.h>
#include <memory>

namespace nexus::render {

class NexusRenderer : public QQuickRhiItemRenderer
{
public:
    NexusRenderer();
    ~NexusRenderer() override;

protected:
    void initialize(QRhiCommandBuffer *cb) override;
    void synchronize(QQuickRhiItem *item) override;
    void render(QRhiCommandBuffer *cb) override;

private:
    void releaseAll();
    bool createStatic(QRhiResourceUpdateBatch *u);
    bool createTargets(QSize hdrSize, int msaa);
    bool createScenePipelines();
    bool createComposite();
    void uploadInstances(QRhiResourceUpdateBatch *u);
    void growBuffer(std::unique_ptr<QRhiBuffer> &buf, quint32 &capacity, quint32 needed);

    QRhi *m_rhi = nullptr;
    RenderSnapshot m_snap;
    RenderStats m_stats;

    // static resources
    std::unique_ptr<QRhiBuffer> m_quadVbuf;
    std::unique_ptr<QRhiBuffer> m_ribbonVbuf;
    int m_ribbonVertexCount = 0;
    std::unique_ptr<QRhiBuffer> m_frameUbo;
    std::unique_ptr<QRhiBuffer> m_passCoreUbo;
    std::unique_ptr<QRhiBuffer> m_passHaloUbo;
    std::unique_ptr<QRhiBuffer> m_postUbo;
    std::unique_ptr<QRhiShaderResourceBindings> m_srbFrame;
    std::unique_ptr<QRhiShaderResourceBindings> m_srbNodeCore;
    std::unique_ptr<QRhiShaderResourceBindings> m_srbNodeHalo;
    std::unique_ptr<QRhiSampler> m_linearSampler;

    // instance data
    std::unique_ptr<QRhiBuffer> m_nodeBuf;
    quint32 m_nodeCapacity = 0;
    std::unique_ptr<QRhiBuffer> m_edgeBuf;
    quint32 m_edgeCapacity = 0;
    quint64 m_nodesVersion = ~0ull;
    quint64 m_edgesVersion = ~0ull;
    int m_nodeCount = 0;
    int m_edgeCount = 0;

    // HDR scene target
    std::unique_ptr<QRhiTexture> m_sceneTex;
    std::unique_ptr<QRhiRenderBuffer> m_sceneMsaa;
    std::unique_ptr<QRhiRenderBuffer> m_sceneDepth;
    std::unique_ptr<QRhiTextureRenderTarget> m_sceneRt;
    std::unique_ptr<QRhiRenderPassDescriptor> m_sceneRp;
    QSize m_hdrSize;
    int m_msaa = 0;           // effective sample count
    int m_requestedMsaa = -1; // sample count asked for by the quality preset

    // pipelines
    std::unique_ptr<QRhiGraphicsPipeline> m_envPs;
    std::unique_ptr<QRhiGraphicsPipeline> m_nodeCorePs;
    std::unique_ptr<QRhiGraphicsPipeline> m_nodeHaloPs;
    std::unique_ptr<QRhiGraphicsPipeline> m_edgePs;
    std::unique_ptr<QRhiGraphicsPipeline> m_particlePs;
    std::unique_ptr<QRhiGraphicsPipeline> m_compositePs;
    std::unique_ptr<QRhiShaderResourceBindings> m_compositeSrb;
    QRhiRenderPassDescriptor *m_compositeRp = nullptr;

    BloomChain m_bloom;
    ParticleSystem m_particles;
    int m_particleCapacity = 0;
    int m_dustCount = 0;
    int m_bloomLevels = 0;

    QSize m_outputSize;
    bool m_targetsDirty = true;
};

} // namespace nexus::render
