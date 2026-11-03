#pragma once

#include "SceneTypes.h"

#include <rhi/qrhi.h>
#include <memory>
#include <vector>

namespace nexus::render {

// Physically-inspired bloom: prefiltered 13-tap downsample chain followed by a tent
// upsample that accumulates additively back up the chain. Output: level 0 (half res).
class BloomChain
{
public:
    void release();
    // (Re)creates size-dependent resources. Returns false on failure.
    bool resize(QRhi *rhi, QRhiTexture *source, QSize sourceSize, int levels);
    void record(QRhiCommandBuffer *cb, QRhiResourceUpdateBatch *&updates,
                const PostUniforms &base, bool flipY);
    QRhiTexture *output() const { return m_levels.empty() ? nullptr : m_levels[0].tex.get(); }
    int levelCount() const { return int(m_levels.size()); }

private:
    struct Level {
        std::unique_ptr<QRhiTexture> tex;
        std::unique_ptr<QRhiTextureRenderTarget> rtDown;
        std::unique_ptr<QRhiTextureRenderTarget> rtUp;
        std::unique_ptr<QRhiRenderPassDescriptor> rpDown;
        std::unique_ptr<QRhiRenderPassDescriptor> rpUp;
        std::unique_ptr<QRhiBuffer> uboDown;
        std::unique_ptr<QRhiBuffer> uboUp;
        std::unique_ptr<QRhiShaderResourceBindings> srbDown;  // samples previous level (or source)
        std::unique_ptr<QRhiShaderResourceBindings> srbUp;    // samples next smaller level
        QSize size;
    };

    QRhi *m_rhi = nullptr;
    QRhiTexture *m_source = nullptr;
    QSize m_sourceSize;
    std::vector<Level> m_levels;
    std::unique_ptr<QRhiSampler> m_sampler;
    std::unique_ptr<QRhiGraphicsPipeline> m_downPs;
    std::unique_ptr<QRhiGraphicsPipeline> m_upPs;
};

} // namespace nexus::render
