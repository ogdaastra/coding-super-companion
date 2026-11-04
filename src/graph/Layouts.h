#pragma once

#include <QString>
#include <QVector3D>
#include <vector>

namespace nexus::graph {

enum class LayoutKind { Galaxy = 0, Constellation = 1, Force = 2, Layered = 3, Tree = 4, Heatmap = 5 };

struct LayoutNode {
    int parent = -1;     // index of containing directory node, -1 for top-level
    bool isDir = false;
    float size = 1.f;    // relative visual size (files: f(lines))
    int order = 0;       // stable DFS order (used by spiral layouts)
};

struct LayoutEdge {
    int a = -1;
    int b = -1;
    bool containment = false;
    float weight = 1.f;
};

struct LayoutRequest {
    LayoutKind kind = LayoutKind::Galaxy;
    std::vector<LayoutNode> nodes;
    std::vector<LayoutEdge> edges;
    std::vector<QVector3D> initial;   // optional warm start (same size as nodes)
    unsigned seed = 1;
    float coreExclusion = 38.f;       // keep project nodes outside the NEXUS CORE
};

struct LayoutResult {
    std::vector<QVector3D> positions;
    LayoutKind kind = LayoutKind::Galaxy;
    int layers = 0;                   // layered layout: number of layers
    std::vector<int> layerOf;         // layered layout: layer per node
    qint64 elapsedMs = 0;
};

QString layoutName(LayoutKind k);
LayoutResult computeLayout(const LayoutRequest &req);

} // namespace nexus::graph
