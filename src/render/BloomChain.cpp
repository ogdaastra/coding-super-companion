#include "BloomChain.h"
#include "RhiUtil.h"

#include <cstring>

namespace nexus::render {

void BloomChain::release()
{
    m_downPs.reset();
    m_upPs.reset();
    m_levels.clear();
    m_sampler.reset();
    m_source = nullptr;
}

bool BloomChain::resize(QRhi *rhi, QRhiTexture *source, QSize sourceSize, int levels)
{
    release();
    m_rhi = rhi;
    m_source = source;
    m_sourceSize = sourceSize;

    m_sampler.reset(rhi->newSampler(QRhiSampler::Linear, QRhiSampler::Linear, QRhiSampler::None,
                                    QRhiSampler::ClampToEdge, QRhiSampler::ClampToEdge));
    if (!m_sampler->create())
        return false;

    QSize size = sourceSize;
    for (int i = 0; i < levels; ++i) {
        size = QSize(qMax(1, size.width() / 2), qMax(1, size.height() / 2));
        if (size.width() < 4 || size.height() < 4)
            break;
        Level lv;
        lv.size = size;
        lv.tex.reset(rhi->newTexture(QRhiTexture::RGBA16F, size, 1, QRhiTexture::RenderTarget));
        if (!lv.tex->create())
            return false;

        lv.rtDown.reset(rhi->newTextureRenderTarget({ QRhiColorAttachment(lv.tex.get()) }));
        lv.rpDown.reset(lv.rtDown->newCompatibleRenderPassDescriptor());
        lv.rtDown->setRenderPassDescriptor(lv.rpDown.get());
        if (!lv.rtDown->create())
            return false;

        lv.rtUp.reset(rhi->newTextureRenderTarget({ QRhiColorAttachment(lv.tex.get()) },
                                                  QRhiTextureRenderTarget::PreserveColorContents));
        lv.rpUp.reset(lv.rtUp->newCompatibleRenderPassDescriptor());
        lv.rtUp->setRenderPassDescriptor(lv.rpUp.get());
        if (!lv.rtUp->create())
            return false;

        lv.uboDown.reset(rhi->newBuffer(QRhiBuffer::Dynamic, QRhiBuffer::UniformBuffer, sizeof(PostUniforms)));
        lv.uboUp.reset(rhi->newBuffer(QRhiBuffer::Dynamic, QRhiBuffer::UniformBuffer, sizeof(PostUniforms)));
        if (!lv.uboDown->create() || !lv.uboUp->create())
            return false;
        m_levels.push_back(std::move(lv));
    }
    if (m_levels.empty())
        return false;

    const auto stages = QRhiShaderResourceBinding::VertexStage | QRhiShaderResourceBinding::FragmentStage;
    for (size_t i = 0; i < m_levels.size(); ++i) {
        Level &lv = m_levels[i];
        QRhiTexture *src = (i == 0) ? m_source : m_levels[i - 1].tex.get();
        lv.srbDown.reset(rhi->newShaderResourceBindings());
        lv.srbDown->setBindings({
            QRhiShaderResourceBinding::uniformBuffer(0, stages, lv.uboDown.get()),
            QRhiShaderResourceBinding::sampledTexture(1, QRhiShaderResourceBinding::FragmentStage, src, m_sampler.get()),
        });
        if (!lv.srbDown->create())
            return false;
        if (i + 1 < m_levels.size()) {
            lv.srbUp.reset(rhi->newShaderResourceBindings());
            lv.srbUp->setBindings({
                QRhiShaderResourceBinding::uniformBuffer(0, stages, lv.uboUp.get()),
                QRhiShaderResourceBinding::sampledTexture(1, QRhiShaderResourceBinding::FragmentStage,
                                                          m_levels[i + 1].tex.get(), m_sampler.get()),
            });
            if (!lv.srbUp->create())
                return false;
        }
    }

    const QShader vs = loadShader(QStringLiteral("fullscreen.vert"));
    PipelineDesc down;
    down.vs = vs;
    down.fs = loadShader(QStringLiteral("bloom_down.frag"));
    down.srb = m_levels[0].srbDown.get();
    down.rp = m_levels[0].rpDown.get();
    m_downPs = makePipeline(rhi, down);
    if (!m_downPs)
        return false;

    if (m_levels.size() > 1) {
        PipelineDesc up;
        up.vs = vs;
        up.fs = loadShader(QStringLiteral("bloom_up.frag"));
        up.blend = Blend::Additive;
        up.srb = m_levels[0].srbUp.get();
        up.rp = m_levels[0].rpUp.get();
        m_upPs = makePipeline(rhi, up);
        if (!m_upPs)
            return false;
    }
    return true;
}

void BloomChain::record(QRhiCommandBuffer *cb, QRhiResourceUpdateBatch *&updates,
                        const PostUniforms &base, bool flipY)
{
    if (m_levels.empty() || !m_downPs)
        return;
    if (!updates)
        updates = m_rhi->nextResourceUpdateBatch();

    for (size_t i = 0; i < m_levels.size(); ++i) {
        Level &lv = m_levels[i];
        PostUniforms u = base;
        const QSize src = (i == 0) ? m_sourceSize : m_levels[i - 1].size;
        u.texel[0] = 1.0f / float(src.width());
        u.texel[1] = 1.0f / float(src.height());
        u.texel[2] = 1.0f;
        u.texel[3] = (i == 0) ? 1.0f : 0.0f;
        u.misc[0] = flipY ? 1.0f : 0.0f;
        updates->updateDynamicBuffer(lv.uboDown.get(), 0, sizeof(PostUniforms), &u);
        if (i + 1 < m_levels.size()) {
            PostUniforms uu = base;
            const QSize s = m_levels[i + 1].size;
            uu.texel[0] = 1.0f / float(s.width());
            uu.texel[1] = 1.0f / float(s.height());
            uu.texel[2] = 1.0f;  // upsample weight
            uu.texel[3] = 0.0f;
            uu.misc[0] = flipY ? 1.0f : 0.0f;
            updates->updateDynamicBuffer(lv.uboUp.get(), 0, sizeof(PostUniforms), &uu);
        }
    }

    const QColor clear(0, 0, 0, 0);
    for (size_t i = 0; i < m_levels.size(); ++i) {
        Level &lv = m_levels[i];
        cb->beginPass(lv.rtDown.get(), clear, { 1.0f, 0 }, updates);
        updates = nullptr;
        cb->setGraphicsPipeline(m_downPs.get());
        cb->setViewport({ 0, 0, float(lv.size.width()), float(lv.size.height()) });
        cb->setShaderResources(lv.srbDown.get());
        cb->draw(3);
        cb->endPass();
    }
    if (!m_upPs)
        return;
    for (int i = int(m_levels.size()) - 2; i >= 0; --i) {
        Level &lv = m_levels[size_t(i)];
        cb->beginPass(lv.rtUp.get(), clear, { 1.0f, 0 });
        cb->setGraphicsPipeline(m_upPs.get());
        cb->setViewport({ 0, 0, float(lv.size.width()), float(lv.size.height()) });
        cb->setShaderResources(lv.srbUp.get());
        cb->draw(3);
        cb->endPass();
    }
}

} // namespace nexus::render
