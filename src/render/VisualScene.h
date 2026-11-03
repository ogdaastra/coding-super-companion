#pragma once

#include "SceneTypes.h"

#include <QColor>
#include <QHash>
#include <QString>
#include <QVector3D>
#include <memory>
#include <vector>

namespace nexus::render {

// Semantic description of a project node handed to the scene by the app layer.
struct SceneNode {
    QString key;          // stable id (e.g. relative path)
    QString label;        // short display label
    NodeKind kind = NodeKind::File;
    QVector3D position;
    float radius = 0.8f;
    QVector3D color{ 0.3f, 0.75f, 1.0f };
    int parent = -1;      // index into the same list, -1 for roots
    float importance = 0.f; // 0..1, drives label priority
};

struct SceneEdge {
    int a = -1;
    int b = -1;
    EdgeKind kind = EdgeKind::Import;
    float weight = 1.f;
};

struct SceneAgent {
    QString key;          // session id
    QString label;
    QVector3D color;
    int ring = 0;         // orbit slot
    bool active = false;
    bool simulated = false;
};

// GUI-thread scene state. Owns the authoritative instance arrays and publishes
// immutable copies to the renderer when they change. Offers semantic helpers that the
// telemetry layer uses to express events as light and motion.
class VisualScene
{
public:
    VisualScene();

    void setTime(float t) { m_time = t; }
    float time() const { return m_time; }

    // --- project graph -------------------------------------------------------------
    void setProjectGraph(const std::vector<SceneNode> &nodes, const std::vector<SceneEdge> &edges);
    void setProjectLayout(const std::vector<QVector3D> &positions, float staggerSeconds = 0.6f);
    int projectNodeCount() const { return int(m_projectMeta.size()); }
    int projectIndex(const QString &key) const { return m_keyToIndex.value(key, -1); }
    const SceneNode &projectNode(int i) const { return m_projectMeta[size_t(i)]; }
    const std::vector<SceneEdge> &projectEdges() const { return m_projectEdges; }
    QVector3D projectPosition(int i) const;   // current animated position
    QVector3D projectTarget(int i) const;     // final layout position

    // --- agents ----------------------------------------------------------------------
    void setAgents(const std::vector<SceneAgent> &agents);
    int agentIndex(const QString &key) const { return m_agentKeyToIndex.value(key, -1); }
    QVector3D agentPosition(int i) const;
    int agentCount() const { return int(m_agents.size()); }
    const SceneAgent &agent(int i) const { return m_agents[size_t(i)]; }

    // --- per-node state ----------------------------------------------------------------
    void markRead(int i, float delay = 0.f);
    void markWrite(int i, float delay = 0.f);
    void markError(int i, float delay = 0.f);
    void markPulse(int i, float delay = 0.f);
    void setHighlight(int i, float v);
    void clearHighlights();
    void setGitCode(int i, GitCode code);
    void setHeat(int i, float heat);
    void setDimmed(int i, bool dimmed);
    void setAllDimmed(bool dimmed);
    void pulseAgent(int agent);
    void activateEdgesAround(int node, float delay = 0.f, bool outgoing = true, bool incoming = true);

    // --- particles -----------------------------------------------------------------------
    void emitPath(const QVector3D &from, const QVector3D &to, const QVector3D &color, int count,
                  float life = 1.2f, float size = 0.35f, float spread = 0.4f, float stagger = 0.5f, float bend = 0.25f);
    void emitBurst(const QVector3D &at, const QVector3D &color, int count, float speed = 6.f,
                   float life = 1.4f, float size = 0.3f, float stagger = 0.05f);
    void emitShockRing(const QVector3D &at, const QVector3D &color, float radius, float life = 1.6f, float delay = 0.f);

    // --- publishing -------------------------------------------------------------------------
    std::shared_ptr<const std::vector<NodeInstance>> nodesSnapshot();
    std::shared_ptr<const std::vector<EdgeInstance>> edgesSnapshot();
    quint64 nodesVersion() const { return m_nodesVersion; }
    quint64 edgesVersion() const { return m_edgesVersion; }
    std::vector<SpawnCommand> takeSpawns();

    // picking over project + agent nodes; returns global instance index or -1
    int pick(const QVector3D &origin, const QVector3D &dir, float pixelTolerance, float pixelsPerUnitAt1,
             float *hitDistance = nullptr) const;
    // global instance index helpers
    int globalForProject(int i) const { return i < 0 ? -1 : m_projectBase + i; }
    int projectForGlobal(int g) const;
    int agentForGlobal(int g) const;
    QVector3D globalPosition(int g) const;
    float globalRadius(int g) const;

    const std::vector<NodeInstance> &instances() const { return m_nodes; }
    int agentBase() const { return m_agentBase; }
    int projectBase() const { return m_projectBase; }

    QVector3D nucleus() const { return QVector3D(0, 0, 0); }
    float nucleusRadius() const { return 4.2f; }

private:
    void buildStructure();
    void rebuildProjectEdges();
    void rebuildAgentInstances();
    void touchNodes() { ++m_nodesVersion; m_nodesDirty = true; }
    void touchEdges() { ++m_edgesVersion; m_edgesDirty = true; }
    QVector3D evalPosition(const NodeInstance &n) const;
    NodeInstance &projectInstance(int i) { return m_nodes[size_t(m_projectBase + i)]; }
    const NodeInstance &projectInstance(int i) const { return m_nodes[size_t(m_projectBase + i)]; }

    float m_time = 0.f;
    float m_transitionDuration = 1.8f;

    std::vector<NodeInstance> m_nodes;  // [core | lattice | project | agents]
    std::vector<EdgeInstance> m_edges;  // [structure | project | agent rings]
    int m_structureNodeCount = 0;
    int m_structureEdgeCount = 0;
    int m_projectBase = 0;
    int m_agentBase = 0;
    int m_projectEdgeBase = 0;

    std::vector<SceneNode> m_projectMeta;
    std::vector<SceneEdge> m_projectEdges;
    std::vector<std::vector<int>> m_adjOut;  // project edge indices by source node
    std::vector<std::vector<int>> m_adjIn;
    QHash<QString, int> m_keyToIndex;

    std::vector<SceneAgent> m_agents;
    QHash<QString, int> m_agentKeyToIndex;

    std::vector<SpawnCommand> m_spawns;
    float m_spawnSeed = 1.f;

    quint64 m_nodesVersion = 1;
    quint64 m_edgesVersion = 1;
    bool m_nodesDirty = true;
    bool m_edgesDirty = true;
    std::shared_ptr<const std::vector<NodeInstance>> m_nodesShared;
    std::shared_ptr<const std::vector<EdgeInstance>> m_edgesShared;
};

} // namespace nexus::render
