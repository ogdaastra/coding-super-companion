#include "VisualDirector.h"
#include "ProjectScene.h"

#include "render/NexusViewport.h"
#include "session/SessionEngine.h"

#include <QColor>
#include <QFileInfo>
#include <algorithm>

namespace nexus::app {

using core::NexusEvent;
using namespace nexus::render;
using session::AgentState;

namespace {
const QVector3D kIce(0.55f, 0.88f, 1.0f);
const QVector3D kCyan(0.25f, 0.83f, 1.0f);
const QVector3D kGlacier(0.85f, 0.96f, 1.0f);
const QVector3D kViolet(0.62f, 0.52f, 1.0f);
const QVector3D kIndigo(0.42f, 0.48f, 1.0f);
const QVector3D kAmber(1.0f, 0.68f, 0.26f);
const QVector3D kAlert(1.0f, 0.28f, 0.34f);
const QVector3D kAurora(0.31f, 0.89f, 0.76f);
const QVector3D kWeb(0.44f, 0.72f, 1.0f);

QVector3D hexColor(const QString &hex)
{
    const QColor c(hex);
    return { float(c.redF()), float(c.greenF()), float(c.blueF()) };
}
} // namespace

VisualDirector::VisualDirector(session::SessionEngine *engine, ProjectScene *project, QObject *parent)
    : QObject(parent), m_engine(engine), m_project(project)
{
    connect(engine, &session::SessionEngine::eventIngested, this, [this](const NexusEvent &e, int, bool live) {
        if (live) play(e);
    });
    connect(engine, &session::SessionEngine::agentsChanged, this, &VisualDirector::syncAgents);
    connect(engine, &session::SessionEngine::sessionUpdated, this, [this](const QString &) {
        // state changes (e.g. waiting for permission) alter agent colour/speed
        syncAgents();
    });
    connect(engine, &session::SessionEngine::activityChanged, this, [this]() {
        if (m_vp) m_vp->setActivity(m_engine->activity());
    });
    connect(project, &ProjectScene::sceneRebuilt, this, [this]() {
        syncAgents();
        applyHeat();
    });
    m_heatTimer.setInterval(2000);
    connect(&m_heatTimer, &QTimer::timeout, this, &VisualDirector::applyHeat);
    m_heatTimer.start();
    m_alertDecay.setSingleShot(true);
    connect(&m_alertDecay, &QTimer::timeout, this, [this]() { if (m_vp) m_vp->setAlert(0.0); });
}

void VisualDirector::setViewport(NexusViewport *vp)
{
    m_vp = vp;
    syncAgents();
}

void VisualDirector::setHeatMode(bool on)
{
    if (on == m_heatMode) return;
    m_heatMode = on;
    applyHeat();
    emit heatModeChanged();
}

void VisualDirector::applyHeat()
{
    if (!m_vp || !m_project->hasProject()) return;
    const QVariantMap heat = m_engine->heatByFile();
    QVariantMap byKey;
    for (auto it = heat.cbegin(); it != heat.cend(); ++it) {
        const QString rel = m_project->relativePath(it.key());
        if (!rel.isEmpty()) byKey.insert(rel, m_heatMode ? it.value() : QVariant(0.0));
    }
    m_project->setHeatValues(byKey);
}

void VisualDirector::syncAgents()
{
    if (!m_vp) return;
    std::vector<SceneAgent> agents;
    for (const auto &[id, s] : m_engine->allSessions()) {
        if (s->state == AgentState::Ended || s->state == AgentState::Stale) continue;
        if (id == QLatin1String("unattributed")) continue;
        SceneAgent a;
        a.key = id;
        QString label = s->simulated ? QStringLiteral("SIM ") : QString();
        label += s->title.isEmpty() ? QStringLiteral("Claude · ") + id.left(8) : s->title.left(28);
        a.label = label;
        a.color = s->state == AgentState::WaitingPermission ? kAmber
                : s->state == AgentState::Failed ? kAlert : hexColor(session::SessionEngine::colorHex(s->colorIndex));
        a.ring = s->ring;
        a.active = s->state == AgentState::Running || s->state == AgentState::ExecutingTool;
        a.simulated = s->simulated;
        agents.push_back(a);
    }
    // avoid rebuilding instance buffers when nothing visible changed
    VisualScene *scene = m_vp->scene();
    bool same = int(agents.size()) == scene->agentCount();
    for (int i = 0; same && i < scene->agentCount(); ++i) {
        const SceneAgent &cur = scene->agent(i);
        same = cur.key == agents[size_t(i)].key && cur.active == agents[size_t(i)].active && cur.color == agents[size_t(i)].color;
    }
    if (!same)
        scene->setAgents(agents);
}

QVector3D VisualDirector::agentPos(const QString &sessionId) const
{
    VisualScene *scene = m_vp->scene();
    const int a = scene->agentIndex(sessionId);
    return a >= 0 ? scene->agentPosition(a) : scene->nucleus();
}

void VisualDirector::flashAlert(float level)
{
    if (!m_vp) return;
    m_vp->setAlert(level);
    m_alertDecay.start(700);
}

void VisualDirector::play(const NexusEvent &e)
{
    if (!m_vp) return;
    VisualScene *scene = m_vp->scene();
    const QVector3D agent = agentPos(e.sessionId);
    const int agentIdx = scene->agentIndex(e.sessionId);
    const QString &k = e.kind;

    auto nodeFor = [this](const QString &path) { return m_project->sceneIndexForAbsolutePath(path); };

    if (k == QLatin1String("tool.pre")) {
        if (e.category == QLatin1String("write")) {
            // energy travels from the agent toward the file while the edit executes
            for (const QString &f : e.files) {
                const int n = nodeFor(f);
                if (n >= 0) scene->emitPath(agent, scene->projectPosition(n), kCyan, 46, 0.9f, 0.42f, 0.35f, 0.25f, 0.12f);
            }
        } else if (e.category == QLatin1String("exec")) {
            scene->emitShockRing(agent, e.testRun ? kAurora * 0.9f : kViolet, e.testRun ? 14.f : 9.f, 1.4f);
            scene->emitShockRing(scene->nucleus(), kViolet * 0.6f, 6.5f, 1.0f, 0.1f);
        } else if (e.category == QLatin1String("search")) {
            for (const QString &f : e.files) {
                int n = nodeFor(f);
                if (n < 0) n = m_project->dirSceneIndexForAbsolutePath(f);
                if (n >= 0) {
                    scene->markPulse(n);
                    scene->activateEdgesAround(n, 0.f, true, false);
                    scene->emitPath(scene->projectPosition(n), agent, kIndigo, 26, 1.3f, 0.30f, 3.5f, 0.6f, 0.2f);
                }
            }
            if (e.files.isEmpty())
                scene->emitShockRing(agent, kIndigo, 12.f, 1.3f);
        } else if (e.category == QLatin1String("web")) {
            scene->emitBurst(agent, kWeb, 60, 14.f, 1.6f, 0.30f, 0.05f);
        } else if (e.category == QLatin1String("agent")) {
            scene->emitShockRing(agent, kViolet, 16.f, 1.8f);
        } else if (e.category == QLatin1String("mcp")) {
            scene->emitShockRing(agent, QVector3D(0.37f, 0.88f, 0.90f), 10.f, 1.4f);
        }
        if (agentIdx >= 0) scene->pulseAgent(agentIdx);
        return;
    }

    if (k == QLatin1String("tool.post") || k == QLatin1String("tool.fail")) {
        const bool failed = k == QLatin1String("tool.fail");
        for (const QString &f : e.files) {
            const int n = nodeFor(f);
            if (n < 0) continue;
            const QVector3D p = scene->projectPosition(n);
            if (failed) {
                scene->markError(n);
                scene->emitBurst(p, kAlert, 40, 4.f, 1.6f, 0.30f, 0.1f);
                continue;
            }
            if (e.category == QLatin1String("read")) {
                scene->markRead(n);
                // information flows from the file into the agent
                scene->emitPath(p, agent, kIce, 30, 1.15f, 0.30f, 0.45f, 0.35f, 0.18f);
                scene->activateEdgesAround(n, 0.f, false, false);
            } else if (e.category == QLatin1String("write")) {
                scene->markWrite(n);
                scene->emitBurst(p, kGlacier, 34, 5.5f, 1.2f, 0.28f, 0.05f);
                scene->activateEdgesAround(n, 0.05f, false, true);
                // the change ripples through files that depend on this one
                const std::vector<int> deps = m_project->dependents(n, 16);
                float delay = 0.45f;
                for (int d : deps) {
                    scene->markPulse(d, delay);
                    delay += 0.09f;
                }
            }
        }
        if (e.category == QLatin1String("exec")) {
            if (e.testRun)
                scene->emitShockRing(agent, failed ? kAlert : kAurora, failed ? 20.f : 18.f, 1.8f);
            else if (failed)
                scene->emitShockRing(agent, kAlert, 12.f, 1.4f);
        }
        if (failed) flashAlert(e.testRun ? 0.9f : 0.55f);
        return;
    }

    if (k == QLatin1String("permission.request")) {
        scene->emitShockRing(agent, kAmber, 11.f, 2.2f);
        scene->emitShockRing(agent, kAmber * 0.7f, 7.f, 2.2f, 0.6f);
        return;
    }
    if (k == QLatin1String("prompt.submit")) {
        // the prompt travels from the agent into the core
        scene->emitPath(agent, scene->nucleus(), kGlacier, 40, 1.2f, 0.36f, 0.6f, 0.4f, 0.0f);
        scene->emitShockRing(scene->nucleus(), kCyan, 14.f, 1.6f, 1.0f);
        m_lastTurnStart.insert(e.sessionId, e.ts);
        return;
    }
    if (k == QLatin1String("turn.stop") || k == QLatin1String("stream.result")) {
        const bool ok = e.ok != 0;
        // completion wave: settles outward through the files touched in this turn
        scene->emitShockRing(scene->nucleus(), ok ? kGlacier : kAlert, 70.f, 2.6f);
        scene->emitShockRing(agent, ok ? kGlacier : kAlert, 16.f, 1.6f);
        const session::SessionRecord *s = m_engine->session(e.sessionId);
        if (s && ok) {
            const qint64 since = m_lastTurnStart.value(e.sessionId, s->firstTs);
            for (auto it = s->fileLastTouch.cbegin(); it != s->fileLastTouch.cend(); ++it) {
                if (it.value() < since) continue;
                const int n = nodeFor(it.key());
                if (n >= 0)
                    scene->markPulse(n, std::min(2.2f, scene->projectPosition(n).length() / 70.f));
            }
        }
        if (!ok) flashAlert(0.8f);
        return;
    }
    if (k == QLatin1String("turn.fail")) {
        scene->emitShockRing(scene->nucleus(), kAlert, 40.f, 2.0f);
        flashAlert(1.0f);
        return;
    }
    if (k == QLatin1String("session.start") || k == QLatin1String("stream.init")) {
        scene->emitShockRing(scene->nucleus(), kCyan, 34.f, 2.4f);
        scene->emitBurst(scene->nucleus(), kCyan, 120, 18.f, 1.8f, 0.28f, 0.1f);
        return;
    }
    if (k == QLatin1String("subagent.start")) {
        scene->emitShockRing(agent, kViolet, 9.f, 1.5f);
        scene->emitBurst(agent, kViolet, 40, 6.f, 1.4f, 0.26f, 0.05f);
        return;
    }
    if (k == QLatin1String("compact.post")) {
        scene->emitShockRing(scene->nucleus(), kIndigo, 26.f, 2.0f);
        return;
    }
    if (k == QLatin1String("instructions.loaded")) {
        for (const QString &f : e.files) {
            const int n = nodeFor(f);
            if (n >= 0) {
                scene->markRead(n);
                scene->emitPath(scene->projectPosition(n), scene->nucleus(), kViolet, 30, 1.4f, 0.3f, 0.4f, 0.4f, 0.0f);
            }
        }
        return;
    }
    if (k == QLatin1String("system.setup_test")) {
        scene->emitShockRing(scene->nucleus(), kAurora, 40.f, 2.4f);
        return;
    }
}

} // namespace nexus::app
