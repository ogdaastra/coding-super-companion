#pragma once

#include "integration/HookInstaller.h"

#include <QObject>
#include <QVariantList>
#include <QVariantMap>

namespace nexus::integration { class ClaudeDetector; class SessionLauncher; }
namespace nexus::ingest { class IngestServer; }
namespace nexus::store { class EventStore; }
namespace nexus::session { class SessionEngine; }
namespace nexus::sim { class SimulationSource; }

namespace nexus::app {

class ProjectScene;

// QML-facing facade for everything that touches Claude Code: detection, hook
// installation (preview → explicit apply → backup), the end-to-end probe, launching and
// stopping sessions, and the clearly-labelled simulation mode.
class Integration : public QObject
{
    Q_OBJECT
    Q_PROPERTY(bool claudeDetected READ claudeDetected NOTIFY claudeChanged)
    Q_PROPERTY(bool detecting READ detecting NOTIFY claudeChanged)
    Q_PROPERTY(QString claudePath READ claudePath NOTIFY claudeChanged)
    Q_PROPERTY(QString claudeVersion READ claudeVersion NOTIFY claudeChanged)
    Q_PROPERTY(QString claudeError READ claudeError NOTIFY claudeChanged)
    Q_PROPERTY(QString relayPath READ relayPath CONSTANT)
    Q_PROPERTY(bool relayExists READ relayExists CONSTANT)
    Q_PROPERTY(QVariantMap userHooks READ userHooks NOTIFY hooksChanged)
    Q_PROPERTY(QVariantMap projectHooks READ projectHooks NOTIFY hooksChanged)
    Q_PROPERTY(bool telemetryListening READ telemetryListening NOTIFY telemetryChanged)
    Q_PROPERTY(QString socketPath READ socketPath NOTIFY telemetryChanged)
    Q_PROPERTY(qint64 received READ received NOTIFY telemetryChanged)
    Q_PROPERTY(qint64 rejected READ rejected NOTIFY telemetryChanged)
    Q_PROPERTY(qint64 recovered READ recovered NOTIFY telemetryChanged)
    Q_PROPERTY(qint64 malformed READ malformed NOTIFY telemetryChanged)
    Q_PROPERTY(QString storeStatus READ storeStatus NOTIFY telemetryChanged)
    Q_PROPERTY(qint64 storedEvents READ storedEvents NOTIFY telemetryChanged)
    Q_PROPERTY(QString probeState READ probeState NOTIFY probeChanged)
    Q_PROPERTY(QString probeMessage READ probeMessage NOTIFY probeChanged)
    Q_PROPERTY(bool simulationRunning READ simulationRunning NOTIFY simulationChanged)
    Q_PROPERTY(QVariantList launches READ launches NOTIFY launchesChanged)
    Q_PROPERTY(QString dataDir READ dataDir CONSTANT)

public:
    Integration(ingest::IngestServer *ingest, store::EventStore *store, session::SessionEngine *engine,
                ProjectScene *project, QObject *parent = nullptr);

    bool claudeDetected() const;
    bool detecting() const;
    QString claudePath() const;
    QString claudeVersion() const;
    QString claudeError() const;
    QString relayPath() const;
    bool relayExists() const;
    QVariantMap userHooks() const { return m_userHooks; }
    QVariantMap projectHooks() const { return m_projectHooks; }
    bool telemetryListening() const;
    QString socketPath() const;
    qint64 received() const;
    qint64 rejected() const;
    qint64 recovered() const;
    qint64 malformed() const;
    QString storeStatus() const;
    qint64 storedEvents() const;
    QString probeState() const { return m_probeState; }
    QString probeMessage() const { return m_probeMessage; }
    bool simulationRunning() const;
    QVariantList launches() const;
    QString dataDir() const;

    Q_INVOKABLE void detect();
    Q_INVOKABLE void refreshHookStatus();
    // scope: "user" (~/.claude/settings.json) or "project" (.claude/settings.local.json)
    Q_INVOKABLE QVariantMap previewInstall(const QString &scope, bool statusline);
    Q_INVOKABLE QVariantMap applyInstall(const QString &scope, bool statusline);
    Q_INVOKABLE QVariantMap previewUninstall(const QString &scope);
    Q_INVOKABLE QVariantMap applyUninstall(const QString &scope);
    Q_INVOKABLE void runProbe();

    Q_INVOKABLE QString launchHeadless(const QString &cwd, const QString &prompt, const QString &permissionMode, const QString &model);
    Q_INVOKABLE QVariantMap launchTerminal(const QString &cwd);
    Q_INVOKABLE void stopLaunch(const QString &key);
    Q_INVOKABLE QStringList launchOutput(const QString &key) const;
    Q_INVOKABLE QVariantMap interruptSession(const QString &sessionId);
    Q_INVOKABLE QString lastLaunchError() const;

    Q_INVOKABLE void startSimulation(int agents = 2);
    Q_INVOKABLE void stopSimulation();
    Q_INVOKABLE void clearSimulated();

    Q_INVOKABLE bool openInEditor(const QString &absPath);
    Q_INVOKABLE bool revealInFileManager(const QString &absPath);
    Q_INVOKABLE QVariantMap openTerminalAt(const QString &dir);
    Q_INVOKABLE void copyToClipboard(const QString &text);

signals:
    void claudeChanged();
    void hooksChanged();
    void telemetryChanged();
    void probeChanged();
    void simulationChanged();
    void launchesChanged();
    void launchOutputAppended(const QString &key, const QString &line);
    void toast(const QString &level, const QString &title, const QString &body);

private:
    QString settingsPathFor(const QString &scope) const;
    QVariantMap planToMap(const integration::InstallPlan &plan) const;
    void writeSessionSettingsFile();

    ingest::IngestServer *m_ingest;
    store::EventStore *m_store;
    session::SessionEngine *m_engine;
    ProjectScene *m_project;
    integration::ClaudeDetector *m_detector;
    integration::SessionLauncher *m_launcher;
    sim::SimulationSource *m_sim;
    QVariantMap m_userHooks;
    QVariantMap m_projectHooks;
    QHash<QString, integration::InstallPlan> m_plans;
    QString m_probeState = QStringLiteral("idle");
    QString m_probeMessage;
    QString m_sessionSettingsFile;
};

} // namespace nexus::app
