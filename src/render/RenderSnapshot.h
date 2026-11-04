#pragma once

#include "SceneTypes.h"

#include <QMatrix4x4>
#include <QVector3D>
#include <memory>
#include <vector>

namespace nexus::render {

// Everything the render thread needs for one frame. Built on the GUI thread and copied
// into the renderer in synchronize() while the GUI thread is blocked. Large arrays are
// shared immutable vectors, so a sync that does not change the graph copies no data.
struct RenderSnapshot {
    QMatrix4x4 view;
    QMatrix4x4 proj;          // uncorrected (OpenGL convention); renderer applies clipSpaceCorr
    QVector3D cameraPos;
    QVector3D cameraRight;
    QVector3D cameraUp;
    QVector3D nucleus;
    float nucleusRadius = 3.0f;
    float time = 0.0f;
    float dt = 0.016f;
    float globalActivity = 0.15f;
    float transitionDuration = 1.8f;
    float pixelScale = 1.0f;
    QVector4D tint;           // rgb + intensity (failure tint)
    QVector4D mode;           // vizMode, selectedPulse, focusActive, heatScale

    std::shared_ptr<const std::vector<NodeInstance>> nodes;
    quint64 nodesVersion = 0;
    std::shared_ptr<const std::vector<EdgeInstance>> edges;
    quint64 edgesVersion = 0;

    std::vector<SpawnCommand> spawns;  // consumed each frame

    QualitySettings quality;
    float exposure = 1.0f;
    float bloomIntensity = 0.85f;
};

// Stats flowing back from the render thread (written during synchronize()).
struct RenderStats {
    float gpuMs = -1.0f;       // -1 when timestamps are unavailable
    float renderCpuMs = 0.0f;  // time spent recording in render()
    int nodeCount = 0;
    int edgeCount = 0;
    int particleCapacity = 0;
    int msaa = 1;
    bool computeParticles = false;
    QString backend;
    QSize targetSize;
};

} // namespace nexus::render
