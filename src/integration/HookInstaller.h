#pragma once

#include <QJsonObject>
#include <QString>
#include <QStringList>
#include <QVariantList>

namespace nexus::integration {

struct InstallPlan {
    QString path;
    bool exists = false;
    QString before;
    QString after;
    bool changed = false;
    QString error;
    QStringList events;     // events NEXUS will receive
    bool statusline = false;
    bool uninstall = false;
};

// Computes and applies changes to Claude Code settings files. Never writes without an
// explicit apply() call; apply() always writes a timestamped backup first and replaces
// the file atomically. Only handlers that run nexus-relay are ever added or removed.
class HookInstaller
{
public:
    static QStringList hookEvents();
    static QString claudeConfigDir();
    static QString userSettingsPath();
    static QString projectLocalSettingsPath(const QString &projectRoot);

    static InstallPlan planInstall(const QString &settingsPath, const QString &relayPath, bool statusline);
    static InstallPlan planUninstall(const QString &settingsPath);
    static bool apply(const InstallPlan &plan, QString *backupPath, QString *error);

    // Settings for sessions NEXUS launches itself (passed with --settings <file>).
    static QJsonObject sessionSettings(const QString &relayPath, bool statusline);

    struct Status {
        bool fileExists = false;
        bool parseable = true;
        QStringList events;          // events with a NEXUS handler
        bool statusline = false;
        QString relayPathInFile;
    };
    static Status status(const QString &settingsPath);

    static QVariantList lineDiff(const QString &before, const QString &after);
};

} // namespace nexus::integration
