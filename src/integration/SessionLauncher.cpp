#include "SessionLauncher.h"

#include "ingest/Normalizer.h"

#include <QDateTime>
#include <QDir>
#include <QFileInfo>
#include <QJsonDocument>
#include <QJsonObject>
#include <QStandardPaths>
#include <QTimer>
#include <QUuid>
#include <QVariantMap>
#include <QtConcurrent/QtConcurrentRun>

#ifdef Q_OS_UNIX
#include <signal.h>
#endif

namespace nexus::integration {

QStringList ClaudeDetector::candidatePaths()
{
    QStringList out;
    const QString found = QStandardPaths::findExecutable(QStringLiteral("claude"));
    if (!found.isEmpty()) out << found;
    const QString home = QDir::homePath();
    const QStringList extra = {
        home + QStringLiteral("/.claude/local/claude"), home + QStringLiteral("/.local/bin/claude"),
        home + QStringLiteral("/.npm-global/bin/claude"), home + QStringLiteral("/.bun/bin/claude"),
        QStringLiteral("/usr/local/bin/claude"), QStringLiteral("/opt/homebrew/bin/claude"), QStringLiteral("/usr/bin/claude"),
#ifdef Q_OS_WIN
        qEnvironmentVariable("APPDATA") + QStringLiteral("/npm/claude.cmd"),
        qEnvironmentVariable("LOCALAPPDATA") + QStringLiteral("/Programs/claude/claude.exe"),
#endif
    };
    for (const QString &p : extra)
        if (QFileInfo(p).isExecutable() && !out.contains(p)) out << p;
    return out;
}

void ClaudeDetector::detect()
{
    if (m_running) return;
    m_running = true;
    QPointer<ClaudeDetector> self(this);
    QtConcurrent::run([]() {
        ClaudeInstallation r;
        const QStringList cands = candidatePaths();
        if (cands.isEmpty()) {
            r.error = QStringLiteral("Claude Code was not found on PATH or in the usual install locations.");
            return r;
        }
        r.path = cands.first();
        QProcess p;
        p.start(r.path, { QStringLiteral("--version") });
        if (!p.waitForStarted(5000) || !p.waitForFinished(15000)) {
            p.kill();
            r.error = QStringLiteral("`claude --version` did not complete.");
            r.found = true;
            return r;
        }
        r.found = true;
        r.version = QString::fromUtf8(p.readAllStandardOutput()).trimmed().section(QLatin1Char('\n'), 0, 0);
        return r;
    }).then(this, [self](const ClaudeInstallation &r) {
        if (!self) return;
        self->m_result = r;
        self->m_running = false;
        emit self->finished();
    });
}

SessionLauncher::SessionLauncher(QObject *parent) : QObject(parent) {}

SessionLauncher::~SessionLauncher()
{
    for (Launch &l : m_launches) {
        if (l.proc && l.proc->state() != QProcess::NotRunning) {
            // Sessions started by NEXUS are not left orphaned; they are asked to stop.
            l.proc->terminate();
            l.proc->waitForFinished(1500);
        }
    }
}

void SessionLauncher::appendOutput(Launch &l, const QString &line)
{
    l.output.append(line);
    if (l.output.size() > 600) l.output.removeFirst();
    emit outputAppended(l.key, line);
}

void SessionLauncher::handleStdout(Launch &l)
{
    l.buffer += l.proc->readAllStandardOutput();
    int nl;
    while ((nl = int(l.buffer.indexOf('\n'))) >= 0) {
        const QByteArray line = l.buffer.left(nl).trimmed();
        l.buffer.remove(0, nl + 1);
        if (line.isEmpty()) continue;
        const QJsonDocument doc = QJsonDocument::fromJson(line);
        if (!doc.isObject()) { appendOutput(l, QString::fromUtf8(line)); continue; }
        core::NexusEvent e;
        if (ingest::Normalizer::fromStreamJson(doc.object(), l.sessionId, QDateTime::currentMSecsSinceEpoch(), &e)) {
            if (e.kind == QLatin1String("stream.message"))
                appendOutput(l, QStringLiteral("assistant  ") + e.payload.value(QStringLiteral("text")).toString().left(2000));
            else
                appendOutput(l, e.summary);
            emit streamEvent(e);
        }
    }
}

QString SessionLauncher::launchHeadless(const QString &cwd, const QString &prompt, const QString &permissionMode, const QString &model)
{
    m_lastError.clear();
    if (m_claude.isEmpty()) { m_lastError = QStringLiteral("Claude Code executable not detected."); return {}; }
    if (!QDir(cwd).exists()) { m_lastError = QStringLiteral("Working directory does not exist."); return {}; }
    if (prompt.trimmed().isEmpty()) { m_lastError = QStringLiteral("Enter a task for the session."); return {}; }

    Launch l;
    l.key = QUuid::createUuid().toString(QUuid::WithoutBraces);
    l.sessionId = QUuid::createUuid().toString(QUuid::WithoutBraces);
    l.cwd = cwd;
    l.prompt = prompt;
    l.mode = QStringLiteral("headless");
    l.state = QStringLiteral("starting");
    l.started = QDateTime::currentMSecsSinceEpoch();
    auto *proc = new QProcess(this);
    l.proc = proc;
    proc->setWorkingDirectory(cwd);
    QStringList args = { QStringLiteral("-p"), QStringLiteral("--output-format"), QStringLiteral("stream-json"),
                         QStringLiteral("--verbose"), QStringLiteral("--session-id"), l.sessionId };
    if (!m_settingsFile.isEmpty())
        args << QStringLiteral("--settings") << m_settingsFile;
    if (!permissionMode.isEmpty())
        args << QStringLiteral("--permission-mode") << permissionMode;
    if (!model.isEmpty())
        args << QStringLiteral("--model") << model;
    const QString key = l.key;
    m_launches.insert(key, l);
    m_order.prepend(key);

    connect(proc, &QProcess::started, this, [this, key]() {
        Launch &x = m_launches[key];
        x.state = QStringLiteral("running");
        x.pid = x.proc ? x.proc->processId() : 0;
        // The prompt is delivered on stdin, so it can never be mistaken for a flag.
        x.proc->write(x.prompt.toUtf8());
        x.proc->closeWriteChannel();
        emit launchesChanged();
    });
    connect(proc, &QProcess::readyReadStandardOutput, this, [this, key]() { handleStdout(m_launches[key]); });
    connect(proc, &QProcess::readyReadStandardError, this, [this, key]() {
        Launch &x = m_launches[key];
        const QString err = QString::fromUtf8(x.proc->readAllStandardError());
        for (const QString &line : err.split(QLatin1Char('\n'), Qt::SkipEmptyParts))
            appendOutput(x, QStringLiteral("stderr  ") + line);
    });
    connect(proc, &QProcess::errorOccurred, this, [this, key](QProcess::ProcessError err) {
        Launch &x = m_launches[key];
        if (err == QProcess::FailedToStart) {
            x.state = QStringLiteral("failed");
            x.ended = QDateTime::currentMSecsSinceEpoch();
            appendOutput(x, QStringLiteral("Failed to start Claude Code: ") + (x.proc ? x.proc->errorString() : QString()));
            emit launchesChanged();
        }
    });
    connect(proc, &QProcess::finished, this, [this, key](int code, QProcess::ExitStatus status) {
        Launch &x = m_launches[key];
        handleStdout(x);
        x.exitCode = code;
        x.ended = QDateTime::currentMSecsSinceEpoch();
        x.state = (status == QProcess::NormalExit && code == 0) ? QStringLiteral("finished")
                : (x.state == QLatin1String("stopping") ? QStringLiteral("stopped") : QStringLiteral("failed"));
        appendOutput(x, QStringLiteral("process exited with code %1").arg(code));
        emit launchFinished(key, code);
        emit launchesChanged();
        x.proc->deleteLater();
    });
    proc->start(m_claude, args);
    emit launchesChanged();
    return key;
}

QString SessionLauncher::findTerminal(QStringList *args, const QString &cwd, const QStringList &command)
{
    args->clear();
#if defined(Q_OS_MACOS)
    QString script = QStringLiteral("cd %1 && %2").arg(QLatin1Char('\'') + QString(cwd).replace(QLatin1Char('\''), QLatin1String("'\\''")) + QLatin1Char('\''), command.join(QLatin1Char(' ')));
    *args << QStringLiteral("-e") << QStringLiteral("tell application \"Terminal\" to do script \"%1\"").arg(script.replace(QLatin1Char('"'), QLatin1String("\\\"")))
          << QStringLiteral("-e") << QStringLiteral("tell application \"Terminal\" to activate");
    return QStringLiteral("osascript");
#elif defined(Q_OS_WIN)
    if (!QStandardPaths::findExecutable(QStringLiteral("wt")).isEmpty()) {
        *args << QStringLiteral("-d") << cwd << command;
        return QStringLiteral("wt");
    }
    *args << QStringLiteral("/c") << QStringLiteral("start") << QStringLiteral("cmd") << QStringLiteral("/k") << command;
    return QStringLiteral("cmd");
#else
    const QString pref = qEnvironmentVariable("TERMINAL");
    struct T { const char *exe; QStringList pre; };
    const std::vector<T> terms = {
        { "kitty", { QStringLiteral("--directory"), cwd } },
        { "wezterm", { QStringLiteral("start"), QStringLiteral("--cwd"), cwd, QStringLiteral("--") } },
        { "alacritty", { QStringLiteral("--working-directory"), cwd, QStringLiteral("-e") } },
        { "gnome-terminal", { QStringLiteral("--working-directory=") + cwd, QStringLiteral("--") } },
        { "konsole", { QStringLiteral("--workdir"), cwd, QStringLiteral("-e") } },
        { "xfce4-terminal", { QStringLiteral("--working-directory=") + cwd, QStringLiteral("-x") } },
        { "foot", { QStringLiteral("--working-directory=") + cwd } },
        { "x-terminal-emulator", { QStringLiteral("-e") } },
        { "xterm", { QStringLiteral("-e") } },
    };
    if (!pref.isEmpty() && !QStandardPaths::findExecutable(pref).isEmpty()) {
        *args << QStringLiteral("-e") << command;
        return pref;
    }
    for (const T &t : terms) {
        if (!QStandardPaths::findExecutable(QLatin1String(t.exe)).isEmpty()) {
            *args << t.pre << command;
            return QLatin1String(t.exe);
        }
    }
    return {};
#endif
}

bool SessionLauncher::launchTerminal(const QString &cwd, QString *error)
{
    if (m_claude.isEmpty()) { *error = QStringLiteral("Claude Code executable not detected."); return false; }
    QStringList command = { m_claude };
    if (!m_settingsFile.isEmpty()) command << QStringLiteral("--settings") << m_settingsFile;
    QStringList args;
    const QString term = findTerminal(&args, cwd, command);
    if (term.isEmpty()) { *error = QStringLiteral("No terminal emulator found (set $TERMINAL)."); return false; }
    qint64 pid = 0;
    if (!QProcess::startDetached(term, args, cwd, &pid)) {
        *error = QStringLiteral("Could not start %1").arg(term);
        return false;
    }
    Launch l;
    l.key = QUuid::createUuid().toString(QUuid::WithoutBraces);
    l.cwd = cwd;
    l.mode = QStringLiteral("terminal");
    l.state = QStringLiteral("running");
    l.started = QDateTime::currentMSecsSinceEpoch();
    l.pid = pid;
    l.output << QStringLiteral("Interactive session opened in %1. Telemetry arrives through hooks.").arg(term);
    m_launches.insert(l.key, l);
    m_order.prepend(l.key);
    emit launchesChanged();
    return true;
}

void SessionLauncher::stop(const QString &key)
{
    auto it = m_launches.find(key);
    if (it == m_launches.end() || !it->proc || it->proc->state() == QProcess::NotRunning)
        return;
    it->state = QStringLiteral("stopping");
    emit launchesChanged();
    QPointer<QProcess> p = it->proc;
#ifdef Q_OS_UNIX
    ::kill(pid_t(p->processId()), SIGINT);
#else
    p->terminate();
#endif
    QTimer::singleShot(4000, this, [p]() { if (p && p->state() != QProcess::NotRunning) p->terminate(); });
    QTimer::singleShot(9000, this, [p]() { if (p && p->state() != QProcess::NotRunning) p->kill(); });
}

QVariantList SessionLauncher::launches() const
{
    QVariantList out;
    for (const QString &k : m_order) {
        const Launch &l = m_launches[k];
        out.append(QVariantMap{ { QStringLiteral("key"), l.key }, { QStringLiteral("sessionId"), l.sessionId },
                                { QStringLiteral("cwd"), l.cwd }, { QStringLiteral("prompt"), l.prompt },
                                { QStringLiteral("mode"), l.mode }, { QStringLiteral("state"), l.state },
                                { QStringLiteral("started"), l.started }, { QStringLiteral("ended"), l.ended },
                                { QStringLiteral("exitCode"), l.exitCode }, { QStringLiteral("pid"), l.pid },
                                { QStringLiteral("lastLine"), l.output.isEmpty() ? QString() : l.output.last() } });
    }
    return out;
}

QStringList SessionLauncher::output(const QString &key) const
{
    return m_launches.value(key).output;
}

QString SessionLauncher::sessionIdFor(const QString &key) const
{
    return m_launches.value(key).sessionId;
}

} // namespace nexus::integration
