#pragma once

#include "core/NexusEvent.h"

#include <QObject>
#include <QPointer>
#include <QTimer>
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
public:
    VisualDirector(session::SessionEngine *engine, ProjectScene *project, QObject *parent = nullptr);

    void setViewport(render::NexusViewport *vp);
    // Plays the visual signature of an event (used for live events and playback).
    void play(const core::NexusEvent &e);

    bool heatMode() const { return m_heatMode; }
    void setHeatMode(bool on);

signals:
    void heatModeChanged();

private:
    void syncAgents();
    void applyHeat();
    QVector3D agentPos(const QString &sessionId) const;
    void flashAlert(float level);

    session::SessionEngine *m_engine;
    ProjectScene *m_project;
    QPointer<render::NexusViewport> m_vp;
    QTimer m_heatTimer;
    QTimer m_alertDecay;
    bool m_heatMode = true;
    QHash<QString, qint64> m_lastTurnStart;
};

} // namespace nexus::app
