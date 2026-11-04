#pragma once

#include <rhi/qrhi.h>
#include <QFile>
#include <rhi/qshader.h>
#include <QString>
#include <memory>

namespace nexus::render {

inline QShader loadShader(const QString &name)
{
    QFile f(QStringLiteral(":/shaders/") + name + QStringLiteral(".qsb"));
    if (!f.open(QIODevice::ReadOnly)) {
        qWarning("NEXUS: missing shader %s", qPrintable(name));
        return {};
    }
    return QShader::fromSerialized(f.readAll());
}

enum class Blend { None, Additive, Alpha };

struct PipelineDesc {
    QShader vs;
    QShader fs;
    QRhiVertexInputLayout inputLayout;
    QRhiGraphicsPipeline::Topology topology = QRhiGraphicsPipeline::Triangles;
    Blend blend = Blend::None;
    bool depthTest = false;
    bool depthWrite = false;
    int sampleCount = 1;
    QRhiShaderResourceBindings *srb = nullptr;
    QRhiRenderPassDescriptor *rp = nullptr;
};

inline std::unique_ptr<QRhiGraphicsPipeline> makePipeline(QRhi *rhi, const PipelineDesc &d)
{
    std::unique_ptr<QRhiGraphicsPipeline> ps(rhi->newGraphicsPipeline());
    ps->setShaderStages({ { QRhiShaderStage::Vertex, d.vs }, { QRhiShaderStage::Fragment, d.fs } });
    ps->setVertexInputLayout(d.inputLayout);
    ps->setTopology(d.topology);
    ps->setCullMode(QRhiGraphicsPipeline::None);
    ps->setDepthTest(d.depthTest);
    ps->setDepthWrite(d.depthWrite);
    ps->setDepthOp(QRhiGraphicsPipeline::LessOrEqual);
    ps->setSampleCount(d.sampleCount);
    if (d.blend != Blend::None) {
        QRhiGraphicsPipeline::TargetBlend tb;
        tb.enable = true;
        if (d.blend == Blend::Additive) {
            tb.srcColor = QRhiGraphicsPipeline::One;
            tb.dstColor = QRhiGraphicsPipeline::One;
            tb.srcAlpha = QRhiGraphicsPipeline::One;
            tb.dstAlpha = QRhiGraphicsPipeline::One;
        } else {
            tb.srcColor = QRhiGraphicsPipeline::SrcAlpha;
            tb.dstColor = QRhiGraphicsPipeline::OneMinusSrcAlpha;
            tb.srcAlpha = QRhiGraphicsPipeline::One;
            tb.dstAlpha = QRhiGraphicsPipeline::OneMinusSrcAlpha;
        }
        ps->setTargetBlends({ tb });
    }
    ps->setShaderResourceBindings(d.srb);
    ps->setRenderPassDescriptor(d.rp);
    if (!ps->create()) {
        qWarning("NEXUS: failed to create graphics pipeline");
        return nullptr;
    }
    return ps;
}

} // namespace nexus::render
