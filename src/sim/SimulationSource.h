#pragma once

#include "core/NexusEvent.h"

#include <QJsonObject>
#include <QObject>
#include <QRandomGenerator>
#include <QStringList>
#include <QTimer>
#include <deque>
#include <functional>

namespace nexus::sim {

// Generates CLEARLY LABELLED simulated telemetry for demonstration and testing.
// Every event is marked simulated = true and source = simulation; session ids start
// with "sim-". Payloads use the real project's file paths so visualisations can be
// exercised, but nothing is ever executed or written to disk.
class SimulationSource : public QObject
{
    Q_OBJECT
public:
    explicit SimulationSource(QObject *parent = nullptr);

    void setProject(const QString &root, const QStringList &relativeFiles);
    void start(int agents = 2);
    void stop();
    bool running() const { return m_running; }

signals:
    void eventReady(const nexus::core::NexusEvent &e);
    void runningChanged();

private:
    struct Agent {
        QString sessionId;
        std::deque<std::function<void()>> script;
        int round = 0;
        QTimer *timer = nullptr;
    };
    void buildScript(Agent &a);
    void step(Agent &a);
    void emitHook(const Agent &a, QJsonObject payload, const QString &agentId = {}, const QString &agentType = {});
    QString pick(const QStringList &from);
    QStringList cluster(int n);
    QString abs(const QString &rel) const { return m_root + QLatin1Char('/') + rel; }

    QString m_root;
    QStringList m_files;
    QStringList m_sources;
    QStringList m_tests;
    std::vector<Agent> m_agents;
    bool m_running = false;
    QRandomGenerator m_rng{ 0xC0FFEEu };
    int m_counter = 0;
};

} // namespace nexus::sim
