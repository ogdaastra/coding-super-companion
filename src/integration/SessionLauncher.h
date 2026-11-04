#pragma once

#include "core/NexusEvent.h"

#include <QHash>
#include <QObject>
#include <QPointer>
#include <QProcess>
#include <QStringList>
#include <QVariantList>

namespace nexus::integration {

struct ClaudeInstallation {
    bool found = false;
    QString path;
    QString version;
    QString error;
};

// Locates the Claude Code executable and reads its version (asynchronously).
class ClaudeDetector : public QObject
{
    Q_OBJECT
public:
    using QObject::QObject;
    void detect();
    const ClaudeInstallation &result() const { return m_result; }
    bool running() const { return m_running; }
    static QStringList candidatePaths();

signals:
    void finished();

private:
    ClaudeInstallation m_result;
    bool m_running = false;
};

// Starts Claude Code sessions on the user's explicit request.
//  * headless: `claude -p` with stream-json output; the prompt is written to stdin
//  * terminal: an interactive session in the user's terminal emulator
// Both receive NEXUS telemetry through `--settings <file>`; user configuration is untouched.
class SessionLauncher : public QObject
{
    Q_OBJECT
    Q_PROPERTY(QVariantList launches READ launches NOTIFY launchesChanged)
public:
    explicit SessionLauncher(QObject *parent = nullptr);
    ~SessionLauncher() override;

    void setClaudePath(const QString &p) { m_claude = p; }
    void setSettingsFile(const QString &p) { m_settingsFile = p; }

    // Returns the launch key (empty on failure; see lastError()).
    QString launchHeadless(const QString &cwd, const QString &prompt, const QString &permissionMode, const QString &model);
    bool launchTerminal(const QString &cwd, QString *error);
    void stop(const QString &key);        // SIGINT → SIGTERM → SIGKILL with grace periods
    QString lastError() const { return m_lastError; }
    QVariantList launches() const;
    QStringList output(const QString &key) const;
    QString sessionIdFor(const QString &key) const;
    static QString findTerminal(QStringList *argsPrefix, const QString &cwd, const QStringList &command);

signals:
    void launchesChanged();
    void streamEvent(const nexus::core::NexusEvent &e);
    void outputAppended(const QString &key, const QString &line);
    void launchFinished(const QString &key, int exitCode);

private:
    struct Launch {
        QString key;
        QString sessionId;
        QString cwd;
        QString prompt;
        QString mode;
        QString state;
        qint64 started = 0;
        qint64 ended = 0;
        int exitCode = 0;
        qint64 pid = 0;
        QStringList output;
        QPointer<QProcess> proc;
        QByteArray buffer;
    };
    void appendOutput(Launch &l, const QString &line);
    void handleStdout(Launch &l);

    QString m_claude;
    QString m_settingsFile;
    QString m_lastError;
    QHash<QString, Launch> m_launches;
    QStringList m_order;
};

} // namespace nexus::integration
