#include "Paths.h"

#include <QCoreApplication>
#include <QCryptographicHash>
#include <QDir>
#include <QFile>
#include <QSaveFile>
#include <QStandardPaths>

namespace nexus::core::Paths {

void setApplicationIdentity()
{
    QCoreApplication::setOrganizationName(QStringLiteral("Nexus"));
    QCoreApplication::setOrganizationDomain(QStringLiteral("nexus.local"));
    QCoreApplication::setApplicationName(QStringLiteral("NEXUS"));
}

QString dataDir()
{
    // AppLocalDataLocation is per-user and not roamed.
    QString d = QStandardPaths::writableLocation(QStandardPaths::AppLocalDataLocation);
    if (d.isEmpty())
        d = QDir::homePath() + QStringLiteral("/.nexus");
    return d;
}

QString spoolDir() { return dataDir() + QStringLiteral("/spool"); }
QString safetyDir() { return dataDir() + QStringLiteral("/safety"); }
QString relayConfigFile() { return dataDir() + QStringLiteral("/relay.json"); }
QString logFile() { return dataDir() + QStringLiteral("/nexus.log"); }

QString socketName()
{
#ifdef Q_OS_WIN
    // Named pipe; access is restricted with QLocalServer::UserAccessOption.
    return QStringLiteral("nexus-telemetry-") + qEnvironmentVariable("USERNAME");
#else
    // Unix: an absolute path inside a private (0700) directory.
    QString runtime = QStandardPaths::writableLocation(QStandardPaths::RuntimeLocation);
    if (runtime.isEmpty())
        runtime = dataDir();
    const QByteArray h = QCryptographicHash::hash(dataDir().toUtf8(), QCryptographicHash::Sha256).toHex().left(10);
    return runtime + QStringLiteral("/nexus-") + QString::fromLatin1(h) + QStringLiteral(".sock");
#endif
}

bool ensurePrivateDir(const QString &dir)
{
    if (!QDir().mkpath(dir))
        return false;
    QFile::setPermissions(dir, QFile::ReadOwner | QFile::WriteOwner | QFile::ExeOwner);
    return true;
}

bool writePrivateFile(const QString &path, const QByteArray &data)
{
    QSaveFile f(path);
    if (!f.open(QIODevice::WriteOnly))
        return false;
    f.setPermissions(QFile::ReadOwner | QFile::WriteOwner);
    f.write(data);
    if (!f.commit())
        return false;
    QFile::setPermissions(path, QFile::ReadOwner | QFile::WriteOwner);
    return true;
}

} // namespace nexus::core::Paths
