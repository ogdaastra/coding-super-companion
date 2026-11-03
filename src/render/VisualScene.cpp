#include "VisualScene.h"

#include <QtMath>
#include <algorithm>
#include <array>
#include <cmath>
#include <map>

namespace nexus::render {

namespace {

constexpr float kNever = -1.0e4f;

struct Icosphere {
    std::vector<QVector3D> verts;
    std::vector<std::pair<int, int>> edges;
};

Icosphere makeIcosphere(int subdivisions)
{
    const float t = (1.f + std::sqrt(5.f)) / 2.f;
    std::vector<QVector3D> v = {
        { -1, t, 0 }, { 1, t, 0 }, { -1, -t, 0 }, { 1, -t, 0 },
        { 0, -1, t }, { 0, 1, t }, { 0, -1, -t }, { 0, 1, -t },
        { t, 0, -1 }, { t, 0, 1 }, { -t, 0, -1 }, { -t, 0, 1 },
    };
    for (auto &p : v) p.normalize();
    std::vector<std::array<int, 3>> f = {
        { 0, 11, 5 }, { 0, 5, 1 }, { 0, 1, 7 }, { 0, 7, 10 }, { 0, 10, 11 },
        { 1, 5, 9 }, { 5, 11, 4 }, { 11, 10, 2 }, { 10, 7, 6 }, { 7, 1, 8 },
        { 3, 9, 4 }, { 3, 4, 2 }, { 3, 2, 6 }, { 3, 6, 8 }, { 3, 8, 9 },
        { 4, 9, 5 }, { 2, 4, 11 }, { 6, 2, 10 }, { 8, 6, 7 }, { 9, 8, 1 },
    };
    for (int s = 0; s < subdivisions; ++s) {
        std::map<std::pair<int, int>, int> cache;
        auto mid = [&](int a, int b) {
            auto key = std::minmax(a, b);
            auto it = cache.find(key);
            if (it != cache.end()) return it->second;
            v.push_back(((v[size_t(a)] + v[size_t(b)]) * 0.5f).normalized());
            const int idx = int(v.size()) - 1;
            cache[key] = idx;
            return idx;
        };
        std::vector<std::array<int, 3>> nf;
        nf.reserve(f.size() * 4);
        for (const auto &tri : f) {
            const int a = mid(tri[0], tri[1]), b = mid(tri[1], tri[2]), c = mid(tri[2], tri[0]);
            nf.push_back({ tri[0], a, c });
            nf.push_back({ tri[1], b, a });
            nf.push_back({ tri[2], c, b });
            nf.push_back({ a, b, c });
        }
        f.swap(nf);
    }
    std::map<std::pair<int, int>, bool> seen;
    Icosphere out;
    out.verts = v;
    for (const auto &tri : f) {
        for (int k = 0; k < 3; ++k) {
            auto e = std::minmax(tri[size_t(k)], tri[size_t((k + 1) % 3)]);
            if (!seen[e]) {
                seen[e] = true;
                out.edges.push_back(e);
            }
        }
    }
    return out;
}

NodeInstance makeNode(const QVector3D &p, float radius, const QVector3D &color, NodeKind kind, float opacity = 1.f)
{
    NodeInstance n{};
    store3(n.startPos, p);
    n.radius = radius;
    store3(n.targetPos, p);
    n.transitionStart = kNever;
    store4(n.color, color.x(), color.y(), color.z(), opacity);
    store4(n.act, kNever, kNever, kNever, kNever);
    store4(n.misc, float(int(kind)), 0.f, 0.f, 0.f);
    return n;
}

EdgeInstance makeSegment(const QVector3D &a, const QVector3D &b, EdgeMode mode, EdgeKind kind,
                         const QVector3D &color, float width, float curvature, float alpha = 1.f)
{
    EdgeInstance e{};
    store3(e.a, a); e.tA = kNever;
    store3(e.aT, a);
    store3(e.b, b); e.tB = kNever;
    store3(e.bT, b);
    store4(e.color, color.x(), color.y(), color.z(), alpha);
    store4(e.params, float(int(mode)), float(int(kind)), width, curvature);
    store4(e.extra, kNever, 0.f, 0.f, 0.f);
    return e;
}

EdgeInstance makeRing(const QVector3D &centre, const QVector3D &axis, float radius, const QVector3D &color,
                      float width, float arcFraction, float rotSpeed, float phase, float alpha = 1.f)
{
    QVector3D n = axis.normalized();
    QVector3D helper = std::abs(n.y()) < 0.9f ? QVector3D(0, 1, 0) : QVector3D(1, 0, 0);
    QVector3D u = QVector3D::crossProduct(n, helper).normalized();
    QVector3D v = QVector3D::crossProduct(n, u).normalized();
    EdgeInstance e{};
    store3(e.a, centre); e.tA = kNever;
    store3(e.aT, u * radius);
    store3(e.b, v * radius); e.tB = kNever;
    store3(e.bT, v * radius);
    store4(e.color, color.x(), color.y(), color.z(), alpha);
    store4(e.params, float(int(EdgeMode::Ring)), float(int(EdgeKind::Structure)), width, arcFraction);
    store4(e.extra, kNever, 0.f, phase, rotSpeed);
    return e;
}

QVector3D v3(const float *f) { return { f[0], f[1], f[2] }; }

} // namespace

VisualScene::VisualScene()
{
    buildStructure();
}

void VisualScene::buildStructure()
{
    m_nodes.clear();
    m_edges.clear();

    const QVector3D cyan(0.247f, 0.831f, 1.0f);
    const QVector3D glacier(0.867f, 0.965f, 1.0f);
    const QVector3D violet(0.604f, 0.525f, 1.0f);

    // Nucleus
    m_nodes.push_back(makeNode(nucleus(), nucleusRadius(), QVector3D(0.25f, 0.80f, 1.0f), NodeKind::Nucleus));

    // Inner geodesic shell
    const float r1 = 8.6f;
    Icosphere inner = makeIcosphere(2);
    const int innerBase = int(m_nodes.size());
    for (const auto &p : inner.verts)
        m_nodes.push_back(makeNode(p * r1, 0.13f, QVector3D(0.35f, 0.70f, 1.0f) * 0.9f, NodeKind::Lattice));
    for (const auto &[a, b] : inner.edges)
        m_edges.push_back(makeSegment(inner.verts[size_t(a)] * r1, inner.verts[size_t(b)] * r1, EdgeMode::SphericalArc,
                                      EdgeKind::Structure, QVector3D(0.18f, 0.42f, 0.85f) * 0.55f, 1.0f, 0.f));
    Q_UNUSED(innerBase);

    // Equatorial band of a finer, larger geodesic lattice
    const float r2 = 13.5f;
    Icosphere band = makeIcosphere(3);
    std::vector<int> remap(band.verts.size(), -1);
    for (size_t i = 0; i < band.verts.size(); ++i) {
        if (std::abs(band.verts[i].y()) < 0.40f) {
            remap[i] = int(m_nodes.size());
            m_nodes.push_back(makeNode(band.verts[i] * r2, 0.09f, QVector3D(0.30f, 0.60f, 1.0f) * 0.75f, NodeKind::Lattice));
        }
    }
    for (const auto &[a, b] : band.edges) {
        if (remap[size_t(a)] < 0 || remap[size_t(b)] < 0)
            continue;
        m_edges.push_back(makeSegment(band.verts[size_t(a)] * r2, band.verts[size_t(b)] * r2, EdgeMode::SphericalArc,
                                      EdgeKind::Structure, QVector3D(0.14f, 0.30f, 0.70f) * 0.42f, 0.85f, 0.f));
    }

    // Gyroscopic instrument rings
    m_edges.push_back(makeRing(nucleus(), { 0.2f, 1.f, 0.1f }, 18.5f, QVector3D(0.25f, 0.65f, 1.0f) * 0.55f, 1.4f, 1.f, 0.03f, 0.f));
    m_edges.push_back(makeRing(nucleus(), { 1.f, 0.25f, 0.f }, 20.0f, violet * 0.40f, 1.0f, 1.f, -0.02f, 1.3f));
    m_edges.push_back(makeRing(nucleus(), { 0.f, 0.3f, 1.f }, 21.5f, cyan * 0.85f, 1.8f, 0.62f, 0.07f, 2.1f));
    m_edges.push_back(makeRing(nucleus(), { 0.f, 1.f, 0.f }, 23.5f, glacier * 0.75f, 2.6f, 0.16f, -0.11f, 0.4f));
    m_edges.push_back(makeRing(nucleus(), { 0.f, 1.f, 0.f }, 23.5f, QVector3D(0.20f, 0.45f, 0.85f) * 0.38f, 0.8f, 1.f, 0.f, 0.f));
    m_edges.push_back(makeRing(nucleus(), { 0.05f, 1.f, -0.08f }, 26.5f, violet * 0.55f, 1.5f, 0.07f, 0.16f, 3.0f));

    // Compass ticks on the equatorial reference ring
    for (int i = 0; i < 72; ++i) {
        const float ang = float(i) / 72.f * 6.2831853f;
        const QVector3D d(std::cos(ang), 0.f, std::sin(ang));
        const bool major = (i % 6) == 0;
        const float r0 = 23.9f;
        const float r1t = major ? 25.7f : 24.6f;
        m_edges.push_back(makeSegment(d * r0, d * r1t, EdgeMode::Bezier, EdgeKind::Structure,
                                      QVector3D(0.30f, 0.60f, 1.0f) * (major ? 0.65f : 0.35f), major ? 1.4f : 1.0f, 0.f));
    }

    // Faint orbital guides in the galactic plane
    for (float r : { 40.f, 66.f, 98.f, 132.f })
        m_edges.push_back(makeRing(nucleus(), { 0.f, 1.f, 0.f }, r, QVector3D(0.12f, 0.28f, 0.60f) * 0.20f, 0.8f, 1.f, 0.f, 0.f));

    m_structureNodeCount = int(m_nodes.size());
    m_structureEdgeCount = int(m_edges.size());
    m_projectBase = m_structureNodeCount;
    m_agentBase = m_projectBase;
    m_projectEdgeBase = m_structureEdgeCount;
    touchNodes();
    touchEdges();
}

QVector3D VisualScene::evalPosition(const NodeInstance &n) const
{
    if (int(n.misc[0]) == int(NodeKind::Agent)) {
        const float theta = n.transitionStart + m_time * n.misc[2];
        return nucleus() + std::cos(theta) * v3(n.startPos) + std::sin(theta) * v3(n.targetPos);
    }
    const float k = easeInOutCubic((m_time - n.transitionStart) / m_transitionDuration);
    return v3(n.startPos) + (v3(n.targetPos) - v3(n.startPos)) * k;
}

void VisualScene::setProjectGraph(const std::vector<SceneNode> &nodes, const std::vector<SceneEdge> &edges)
{
    // keep structure, rebuild project + agents
    m_nodes.resize(size_t(m_structureNodeCount));
    m_projectMeta = nodes;
    m_keyToIndex.clear();
    m_projectBase = m_structureNodeCount;
    for (size_t i = 0; i < nodes.size(); ++i) {
        const SceneNode &sn = nodes[i];
        m_keyToIndex.insert(sn.key, int(i));
        // new nodes grow out of the nucleus
        NodeInstance n = makeNode(nucleus(), sn.radius, sn.color, sn.kind);
        store3(n.targetPos, sn.position);
        n.transitionStart = m_time + 0.15f + 0.9f * float(i % 97) / 97.f;
        m_nodes.push_back(n);
    }
    // Only valid edges are kept so that project edge i maps to m_edges[m_projectEdgeBase + i].
    m_projectEdges.clear();
    m_projectEdges.reserve(edges.size());
    for (const SceneEdge &e : edges)
        if (e.a >= 0 && e.a < int(nodes.size()) && e.b >= 0 && e.b < int(nodes.size()) && e.a != e.b)
            m_projectEdges.push_back(e);
    m_adjOut.assign(nodes.size(), {});
    m_adjIn.assign(nodes.size(), {});
    for (size_t e = 0; e < m_projectEdges.size(); ++e) {
        m_adjOut[size_t(m_projectEdges[e].a)].push_back(int(e));
        m_adjIn[size_t(m_projectEdges[e].b)].push_back(int(e));
    }
    m_agentBase = int(m_nodes.size());
    rebuildAgentInstances();
    rebuildProjectEdges();
    touchNodes();
}

void VisualScene::setProjectLayout(const std::vector<QVector3D> &positions, float stagger)
{
    const int n = std::min<int>(int(positions.size()), projectNodeCount());
    float maxR = 1.f;
    for (int i = 0; i < n; ++i)
        maxR = std::max(maxR, positions[size_t(i)].length());
    for (int i = 0; i < n; ++i) {
        NodeInstance &ni = projectInstance(i);
        const QVector3D cur = evalPosition(ni);
        store3(ni.startPos, cur);
        store3(ni.targetPos, positions[size_t(i)]);
        ni.transitionStart = m_time + stagger * (positions[size_t(i)].length() / maxR);
        m_projectMeta[size_t(i)].position = positions[size_t(i)];
    }
    rebuildProjectEdges();
    touchNodes();
}

QVector3D VisualScene::projectPosition(int i) const
{
    if (i < 0 || i >= projectNodeCount()) return {};
    return evalPosition(projectInstance(i));
}

QVector3D VisualScene::projectTarget(int i) const
{
    if (i < 0 || i >= projectNodeCount()) return {};
    return v3(projectInstance(i).targetPos);
}

void VisualScene::rebuildProjectEdges()
{
    m_edges.resize(size_t(m_structureEdgeCount));
    m_projectEdgeBase = m_structureEdgeCount;
    for (const SceneEdge &se : m_projectEdges) {
        if (se.a < 0 || se.b < 0 || se.a >= projectNodeCount() || se.b >= projectNodeCount())
            continue;
        const NodeInstance &na = projectInstance(se.a);
        const NodeInstance &nb = projectInstance(se.b);
        QVector3D color;
        float width = 1.0f, curvature = 0.f, flow = 0.f, dash = 0.f, alpha = 1.f;
        switch (se.kind) {
        case EdgeKind::Containment:
            color = QVector3D(0.20f, 0.45f, 0.85f) * 0.40f; width = 0.9f; curvature = 0.04f; break;
        case EdgeKind::Import:
            color = QVector3D(0.30f, 0.72f, 1.00f) * 0.55f; width = 1.25f; curvature = 0.22f; flow = 0.22f; dash = 5.f; break;
        case EdgeKind::Knowledge:
            color = QVector3D(0.60f, 0.52f, 1.00f) * 0.45f; width = 1.0f; curvature = 0.12f; flow = 0.12f; dash = 3.f; break;
        default:
            color = QVector3D(0.3f, 0.6f, 1.f) * 0.3f; break;
        }
        EdgeInstance e{};
        store3(e.a, v3(na.startPos)); e.tA = na.transitionStart;
        store3(e.aT, v3(na.targetPos));
        store3(e.b, v3(nb.startPos)); e.tB = nb.transitionStart;
        store3(e.bT, v3(nb.targetPos));
        store4(e.color, color.x(), color.y(), color.z(), alpha);
        store4(e.params, float(int(EdgeMode::Bezier)), float(int(se.kind)), width, curvature);
        store4(e.extra, kNever, flow, dash, 0.f);
        m_edges.push_back(e);
    }
    // Agent orbits
    for (size_t i = 0; i < m_agents.size(); ++i) {
        const NodeInstance &an = m_nodes[size_t(m_agentBase) + i];
        const QVector3D u = v3(an.startPos), v = v3(an.targetPos);
        const float radius = u.length();
        const QVector3D axis = QVector3D::crossProduct(u, v).normalized();
        const QVector3D c = m_agents[i].color;
        const float speed = an.misc[2];
        const float phase = an.transitionStart;
        const float act = m_agents[i].active ? 1.f : 0.45f;
        // full orbit
        EdgeInstance ring = makeRing(nucleus(), axis, radius, c * 0.30f * act, 1.1f, 1.f, 0.f, 0.f);
        // basis must match the beacon's (u, v) exactly for the comet tail to line up
        store3(ring.aT, u); store3(ring.b, v); store3(ring.bT, v);
        m_edges.push_back(ring);
        // comet tail trailing the beacon
        EdgeInstance tail = ring;
        const float frac = 0.10f;
        store4(tail.color, c.x() * 1.4f * act, c.y() * 1.4f * act, c.z() * 1.4f * act, 1.f);
        store4(tail.params, float(int(EdgeMode::Ring)), float(int(EdgeKind::AgentLink)), 2.4f, frac);
        store4(tail.extra, kNever, 0.f, phase - frac * 6.2831853f, speed);
        m_edges.push_back(tail);
    }
    touchEdges();
}

void VisualScene::setAgents(const std::vector<SceneAgent> &agents)
{
    m_agents = agents;
    m_agentKeyToIndex.clear();
    for (size_t i = 0; i < agents.size(); ++i)
        m_agentKeyToIndex.insert(agents[i].key, int(i));
    rebuildAgentInstances();
    rebuildProjectEdges();
    touchNodes();
}

void VisualScene::rebuildAgentInstances()
{
    m_nodes.resize(size_t(m_agentBase));
    for (size_t i = 0; i < m_agents.size(); ++i) {
        const SceneAgent &a = m_agents[i];
        const int slot = a.ring;
        const float radius = 30.f + 3.4f * float(slot);
        // distinct, deterministic orbital planes (golden-angle precession)
        const float tilt = 0.30f + 0.22f * float(slot % 4);
        const float az = float(slot) * 2.39996323f;
        const QVector3D axis(std::sin(tilt) * std::cos(az), std::cos(tilt), std::sin(tilt) * std::sin(az));
        QVector3D helper = std::abs(axis.y()) < 0.9f ? QVector3D(0, 1, 0) : QVector3D(1, 0, 0);
        const QVector3D u = QVector3D::crossProduct(axis, helper).normalized() * radius;
        const QVector3D v = QVector3D::crossProduct(axis.normalized(), u.normalized()).normalized() * radius;
        NodeInstance n = makeNode(u, a.active ? 0.85f : 0.6f, a.color, NodeKind::Agent);
        store3(n.startPos, u);
        store3(n.targetPos, v);
        n.transitionStart = float(slot) * 1.7f;          // phase
        n.misc[2] = a.active ? 0.26f : 0.08f;            // angular speed
        m_nodes.push_back(n);
    }
}

QVector3D VisualScene::agentPosition(int i) const
{
    if (i < 0 || i >= agentCount()) return nucleus();
    return evalPosition(m_nodes[size_t(m_agentBase + i)]);
}

void VisualScene::markRead(int i, float delay)
{
    if (i < 0 || i >= projectNodeCount()) return;
    projectInstance(i).act[0] = m_time + delay;
    touchNodes();
}

void VisualScene::markWrite(int i, float delay)
{
    if (i < 0 || i >= projectNodeCount()) return;
    projectInstance(i).act[1] = m_time + delay;
    touchNodes();
}

void VisualScene::markError(int i, float delay)
{
    if (i < 0 || i >= projectNodeCount()) return;
    projectInstance(i).act[2] = m_time + delay;
    touchNodes();
}

void VisualScene::markPulse(int i, float delay)
{
    if (i < 0 || i >= projectNodeCount()) return;
    projectInstance(i).act[3] = m_time + delay;
    touchNodes();
}

void VisualScene::pulseAgent(int agent)
{
    if (agent < 0 || agent >= agentCount()) return;
    m_nodes[size_t(m_agentBase + agent)].act[3] = m_time;
    touchNodes();
}

void VisualScene::setHighlight(int i, float v)
{
    if (i < 0 || i >= projectNodeCount()) return;
    if (projectInstance(i).misc[1] == v) return;
    projectInstance(i).misc[1] = v;
    touchNodes();
}

void VisualScene::clearHighlights()
{
    bool changed = false;
    for (int i = 0; i < projectNodeCount(); ++i) {
        if (projectInstance(i).misc[1] != 0.f) {
            projectInstance(i).misc[1] = 0.f;
            changed = true;
        }
    }
    if (changed) touchNodes();
}

void VisualScene::setGitCode(int i, GitCode code)
{
    if (i < 0 || i >= projectNodeCount()) return;
    const float c = float(int(code));
    if (projectInstance(i).misc[3] == c) return;
    projectInstance(i).misc[3] = c;
    touchNodes();
}

void VisualScene::setHeat(int i, float heat)
{
    if (i < 0 || i >= projectNodeCount()) return;
    if (std::abs(projectInstance(i).misc[2] - heat) < 1e-3f) return;
    projectInstance(i).misc[2] = heat;
    touchNodes();
}

void VisualScene::setDimmed(int i, bool dimmed)
{
    if (i < 0 || i >= projectNodeCount()) return;
    const float a = dimmed ? 0.22f : 1.f;
    if (projectInstance(i).color[3] == a) return;
    projectInstance(i).color[3] = a;
    touchNodes();
}

void VisualScene::setAllDimmed(bool dimmed)
{
    for (int i = 0; i < projectNodeCount(); ++i)
        projectInstance(i).color[3] = dimmed ? 0.22f : 1.f;
    // edges follow node dimming
    for (size_t e = size_t(m_projectEdgeBase); e < m_edges.size(); ++e)
        m_edges[e].color[3] = dimmed ? 0.25f : 1.f;
    touchNodes();
    touchEdges();
}

void VisualScene::activateEdgesAround(int node, float delay, bool outgoing, bool incoming)
{
    if (node < 0 || node >= projectNodeCount()) return;
    auto activate = [&](int edgeIdx, bool restoreAlpha) {
        // project edges map 1:1 into m_edges after the structure block, in order, for valid edges
        const size_t idx = size_t(m_projectEdgeBase + edgeIdx);
        if (idx < m_edges.size()) {
            m_edges[idx].extra[0] = m_time + delay;
            if (restoreAlpha) m_edges[idx].color[3] = 1.f;
        }
    };
    if (outgoing)
        for (int e : m_adjOut[size_t(node)]) activate(e, true);
    if (incoming)
        for (int e : m_adjIn[size_t(node)]) activate(e, true);
    touchEdges();
}

void VisualScene::emitPath(const QVector3D &from, const QVector3D &to, const QVector3D &color, int count,
                           float life, float size, float spread, float stagger, float bend)
{
    SpawnCommand s{};
    store4(s.p0, from.x(), from.y(), from.z(), float(int(ParticleType::Path)));
    store4(s.p1, to.x(), to.y(), to.z(), life);
    store4(s.color, color.x(), color.y(), color.z(), size);
    store4(s.params, float(count), 0.f, m_spawnSeed, spread);
    const QVector3D mid = (from + to) * 0.5f;
    const QVector3D ctrl = mid + (nucleus() - mid) * bend + QVector3D(0, (from - to).length() * 0.08f, 0);
    store4(s.extra, ctrl.x(), ctrl.y(), ctrl.z(), stagger);
    m_spawnSeed += 13.37f;
    m_spawns.push_back(s);
}

void VisualScene::emitBurst(const QVector3D &at, const QVector3D &color, int count, float speed, float life,
                            float size, float stagger)
{
    SpawnCommand s{};
    store4(s.p0, at.x(), at.y(), at.z(), float(int(ParticleType::Burst)));
    store4(s.p1, speed, 0.f, 0.f, life);
    store4(s.color, color.x(), color.y(), color.z(), size);
    store4(s.params, float(count), 0.f, m_spawnSeed, 0.2f);
    store4(s.extra, at.x(), at.y(), at.z(), stagger);
    m_spawnSeed += 7.77f;
    m_spawns.push_back(s);
}

void VisualScene::emitShockRing(const QVector3D &at, const QVector3D &color, float radius, float life, float delay)
{
    SpawnCommand s{};
    store4(s.p0, at.x(), at.y(), at.z(), float(int(ParticleType::ShockRing)));
    store4(s.p1, at.x(), at.y(), at.z(), life);
    store4(s.color, color.x(), color.y(), color.z(), radius);
    store4(s.params, 1.f, 0.f, m_spawnSeed, 0.f);
    store4(s.extra, at.x(), at.y(), at.z(), delay);
    m_spawnSeed += 3.1f;
    m_spawns.push_back(s);
}

std::shared_ptr<const std::vector<NodeInstance>> VisualScene::nodesSnapshot()
{
    if (m_nodesDirty || !m_nodesShared) {
        m_nodesShared = std::make_shared<const std::vector<NodeInstance>>(m_nodes);
        m_nodesDirty = false;
    }
    return m_nodesShared;
}

std::shared_ptr<const std::vector<EdgeInstance>> VisualScene::edgesSnapshot()
{
    if (m_edgesDirty || !m_edgesShared) {
        m_edgesShared = std::make_shared<const std::vector<EdgeInstance>>(m_edges);
        m_edgesDirty = false;
    }
    return m_edgesShared;
}

std::vector<SpawnCommand> VisualScene::takeSpawns()
{
    std::vector<SpawnCommand> out;
    out.swap(m_spawns);
    return out;
}

int VisualScene::projectForGlobal(int g) const
{
    if (g >= m_projectBase && g < m_agentBase) return g - m_projectBase;
    return -1;
}

int VisualScene::agentForGlobal(int g) const
{
    if (g >= m_agentBase && g < m_agentBase + agentCount()) return g - m_agentBase;
    return -1;
}

QVector3D VisualScene::globalPosition(int g) const
{
    if (g < 0 || g >= int(m_nodes.size())) return nucleus();
    return evalPosition(m_nodes[size_t(g)]);
}

float VisualScene::globalRadius(int g) const
{
    if (g < 0 || g >= int(m_nodes.size())) return 1.f;
    return m_nodes[size_t(g)].radius;
}

int VisualScene::pick(const QVector3D &origin, const QVector3D &dir, float pixelTolerance, float pixelsPerUnitAt1,
                      float *hitDistance) const
{
    int best = -1;
    float bestT = 1e30f;
    const int end = m_agentBase + agentCount();
    for (int g = m_projectBase; g < end; ++g) {
        const NodeInstance &n = m_nodes[size_t(g)];
        if (n.color[3] < 0.3f) continue; // dimmed nodes are not pickable
        const QVector3D c = evalPosition(n);
        const QVector3D oc = c - origin;
        const float tc = QVector3D::dotProduct(oc, dir);
        if (tc <= 0.f) continue;
        const float d2 = oc.lengthSquared() - tc * tc;
        const float ppu = pixelsPerUnitAt1 / std::max(tc, 0.01f);
        const float r = std::max(n.radius, pixelTolerance / ppu);
        if (d2 > r * r) continue;
        const float t = tc - std::sqrt(std::max(r * r - d2, 0.f));
        if (t < bestT) {
            bestT = t;
            best = g;
        }
    }
    if (hitDistance) *hitDistance = bestT;
    return best;
}

} // namespace nexus::render
