// nexus-relay — forwards Claude Code hook and status-line JSON to NEXUS.
//
//   nexus-relay hook                 (Claude Code hook handler; async, exec form)
//   nexus-relay statusline [--chain <command...>]
//   nexus-relay probe                (setup wizard self-test)
//
// Guarantees in hook mode: nothing is written to stdout (async hook stdout would be fed
// back to Claude), the exit code is always 0 (a relay problem can never block or alter
// Claude Code), and events are spooled to disk when NEXUS is not running.

#include "core/Paths.h"

#include <QCoreApplication>
#include <QDateTime>
#include <QDir>
#include <QFile>
#include <QJsonDocument>
#include <QJsonObject>
#include <QLocalSocket>
#include <QLockFile>
#include <QProcess>
#include <cstdio>
#include <iostream>
#include <iterator>
#include <string>

#ifdef Q_OS_UNIX
#include <unistd.h>
#endif

namespace {

constexpr qint64 kMaxInput = 8 * 1024 * 1024;

QByteArray readStdin()
{
    std::string data;
    data.reserve(64 * 1024);
    char buf[65536];
    size_t n;
    while ((n = std::fread(buf, 1, sizeof buf, stdin)) > 0) {
        data.append(buf, n);
        if (qint64(data.size()) > kMaxInput)
            return {};
    }
    return QByteArray(data.data(), qsizetype(data.size()));
}

int parentPid()
{
#ifdef Q_OS_UNIX
    return int(getppid());
#else
    return 0;
#endif
}

struct RelayConfig {
    QString socket;
    QString token;
    bool valid = false;
};

RelayConfig loadConfig()
{
    RelayConfig c;
    QFile f(nexus::core::Paths::relayConfigFile());
    if (!f.open(QIODevice::ReadOnly))
        return c;
    const QJsonObject o = QJsonDocument::fromJson(f.readAll()).object();
    c.socket = o.value(QStringLiteral("socket")).toString();
    c.token = o.value(QStringLiteral("token")).toString();
    c.valid = !c.socket.isEmpty() && !c.token.isEmpty();
    return c;
}

QByteArray envelope(const QString &channel, const QByteArray &input, const QString &token, bool simulated = false)
{
    QJsonParseError err;
    QJsonDocument doc = QJsonDocument::fromJson(input, &err);
    QJsonObject payload;
    if (err.error == QJsonParseError::NoError && doc.isObject())
        payload = doc.object();
    else
        payload.insert(QStringLiteral("hook_event_name"), QStringLiteral("Unparsable"));
    QJsonObject env{ { QStringLiteral("nexus"), 1 },
                     { QStringLiteral("channel"), channel },
                     { QStringLiteral("captured_ms"), QDateTime::currentMSecsSinceEpoch() },
                     { QStringLiteral("relay_pid"), qint64(QCoreApplication::applicationPid()) },
                     { QStringLiteral("parent_pid"), parentPid() },
                     { QStringLiteral("payload"), payload } };
    if (!token.isEmpty())
        env.insert(QStringLiteral("token"), token);
    if (simulated)
        env.insert(QStringLiteral("simulated"), true);
    return QJsonDocument(env).toJson(QJsonDocument::Compact) + '\n';
}

bool sendToSocket(const RelayConfig &cfg, const QByteArray &line)
{
    if (!cfg.valid)
        return false;
    QLocalSocket s;
    s.connectToServer(cfg.socket);
    if (!s.waitForConnected(400))
        return false;
    qint64 written = 0;
    while (written < line.size()) {
        const qint64 w = s.write(line.constData() + written, line.size() - written);
        if (w < 0) return false;
        written += w;
        if (!s.waitForBytesWritten(1500)) return false;
    }
    s.disconnectFromServer();
    if (s.state() != QLocalSocket::UnconnectedState)
        s.waitForDisconnected(300);
    return true;
}

bool spool(const QByteArray &lineWithoutToken)
{
    using namespace nexus::core;
    if (!Paths::ensurePrivateDir(Paths::spoolDir()))
        return false;
    QLockFile lock(Paths::spoolDir() + QStringLiteral("/.lock"));
    lock.setStaleLockTime(5000);
    if (!lock.tryLock(1500))
        return false;
    QFile f(Paths::spoolDir() + QLatin1Char('/') + QDate::currentDate().toString(Qt::ISODate) + QStringLiteral(".jsonl"));
    if (!f.open(QIODevice::Append | QIODevice::WriteOnly))
        return false;
    f.setPermissions(QFile::ReadOwner | QFile::WriteOwner);
    f.write(lineWithoutToken);
    return f.flush();
}

// Returns 0 delivered, 3 spooled, 4 failed.
int deliver(const QString &channel, const QByteArray &input, bool simulated = false)
{
    const RelayConfig cfg = loadConfig();
    if (sendToSocket(cfg, envelope(channel, input, cfg.token, simulated)))
        return 0;
    return spool(envelope(channel, input, QString(), simulated)) ? 3 : 4;
}

QString compactStatus(const QByteArray &input)
{
    const QJsonObject o = QJsonDocument::fromJson(input).object();
    QStringList parts{ QStringLiteral("NEXUS") };
    const QString model = o.value(QStringLiteral("model")).toObject().value(QStringLiteral("display_name")).toString();
    if (!model.isEmpty()) parts << model;
    const QJsonValue used = o.value(QStringLiteral("context_window")).toObject().value(QStringLiteral("used_percentage"));
    if (used.isDouble()) parts << QStringLiteral("ctx %1%").arg(used.toDouble(), 0, 'f', 0);
    const QJsonValue cost = o.value(QStringLiteral("cost")).toObject().value(QStringLiteral("total_cost_usd"));
    if (cost.isDouble()) parts << QStringLiteral("$%1").arg(cost.toDouble(), 0, 'f', 2);
    return parts.join(QStringLiteral("  ·  "));
}

} // namespace

int main(int argc, char *argv[])
{
    QCoreApplication app(argc, argv);
    nexus::core::Paths::setApplicationIdentity();
    const QStringList args = app.arguments();
    const QString mode = args.size() > 1 ? args.at(1) : QStringLiteral("hook");

    if (mode == QLatin1String("hook")) {
        const QByteArray input = readStdin();
        if (!input.isEmpty())
            deliver(QStringLiteral("hook"), input);
        return 0;  // never block or alter Claude Code
    }

    if (mode == QLatin1String("statusline")) {
        const QByteArray input = readStdin();
        if (!input.isEmpty())
            deliver(QStringLiteral("statusline"), input);
        const int chain = int(args.indexOf(QStringLiteral("--chain")));
        if (chain > 0 && chain + 1 < args.size()) {
            // Preserve the user's own status line: run it with the same input.
            QProcess p;
            p.setProcessChannelMode(QProcess::ForwardedErrorChannel);
#ifdef Q_OS_WIN
            p.start(QStringLiteral("cmd"), { QStringLiteral("/c"), args.mid(chain + 1).join(QLatin1Char(' ')) });
#else
            p.start(QStringLiteral("/bin/sh"), { QStringLiteral("-c"), args.mid(chain + 1).join(QLatin1Char(' ')) });
#endif
            if (p.waitForStarted(3000)) {
                p.write(input);
                p.closeWriteChannel();
                p.waitForFinished(5000);
                const QByteArray out = p.readAllStandardOutput();
                std::fwrite(out.constData(), 1, size_t(out.size()), stdout);
            }
        } else {
            std::printf("%s\n", qPrintable(compactStatus(input)));
        }
        return 0;
    }

    if (mode == QLatin1String("probe")) {
        QJsonObject probe{ { QStringLiteral("hook_event_name"), QStringLiteral("NexusSetupTest") },
                           { QStringLiteral("session_id"), QStringLiteral("nexus-setup-test") },
                           { QStringLiteral("cwd"), QDir::currentPath() } };
        const int rc = deliver(QStringLiteral("hook"), QJsonDocument(probe).toJson(QJsonDocument::Compact));
        std::fprintf(stderr, "%s\n", rc == 0 ? "delivered" : rc == 3 ? "spooled (NEXUS not reachable)" : "failed");
        return rc;
    }

    if (mode == QLatin1String("--version") || mode == QLatin1String("version")) {
        std::printf("nexus-relay %s\n", NEXUS_VERSION);
        return 0;
    }

    std::fprintf(stderr, "usage: nexus-relay hook | statusline [--chain <cmd>] | probe\n");
    return 0;
}
