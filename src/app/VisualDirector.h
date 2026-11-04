#pragma once

#include "core/NexusEvent.h"

#include <QObject>
#include <QPointer>
#include <QTimer>
#include <QElapsedTimer>
#include <QHash>

namespace nexus::session { class SessionEngine; }
namespace nexus::render { class NexusViewport; }

namespace nexus::app {

class ProjectScene;

// Translates telemetry into light and motion in the NEXUS CORE. Every effect is driven
// by a real (or explicitly simulated) event; nothing here generates activity on its own.
class VisualDirector : public QObject
{
    Q_OBJECT
    Q_PROPERTY(bool heatMode READ heatMode WRITE setHeatMode NOTIFY heatModeChanged)
    Q_PROPERTY(bool cinematic READ cinematic WRITE setCinematic NOTIFY cinematicChanged)
public:
    VisualDirector(session::SessionEngine *engine, ProjectScene *project, QObject *parent = nullptr);

    void setViewport(render::NexusViewport *vp);
    // Plays the visual signature of an event (used for live events and playback).
    void play(const core::NexusEvent &e);

    bool heatMode() const { return m_heatMode; }
    void setHeatMode(bool on);
    bool cinematic() const { return m_cinematic; }
    void setCinematic(bool on);

signals:
    void heatModeChanged();
    void cinematicChanged();

private:
    void syncAgents();
    void applyHeat();
    QVector3D agentPos(const QString &sessionId) const;
    void flashAlert(float level);
    void cinematicCue(int sceneNode, bool important);

    session::SessionEngine *m_engine;
    ProjectScene *m_project;
    QPointer<render::NexusViewport> m_vp;
    QTimer m_heatTimer;
    QTimer m_alertDecay;
    bool m_heatMode = true;
    QHash<QString, qint64> m_lastTurnStart;
    bool m_cinematic = false;
    QElapsedTimer m_sinceMove;
    QTimer m_homeTimer;
    float m_sweepSign = 1.f;
};

} // namespace nexus::app
