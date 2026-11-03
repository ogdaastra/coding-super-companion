#include "Integration.h"
#include "ProjectScene.h"

#include "core/Paths.h"
#include "ingest/IngestServer.h"
#include "integration/SessionLauncher.h"
#include "session/SessionEngine.h"
#include "sim/SimulationSource.h"
#include "store/EventStore.h"

#include <QClipboard>
#include <QCoreApplication>
#include <QDesktopServices>
#include <QDir>
#include <QFileInfo>
#include <QGuiApplication>
#include <QJsonDocument>
#include <QProcess>
#include <QStandardPaths>
#include <QTimer>
#include <QUrl>

#ifdef Q_OS_UNIX
#include <cerrno>
#include <signal.h>
#endif

namespace nexus::app {

using integration::HookInstaller;

Integration::Integration(ingest::IngestServer *ingest, store::EventStore *store, session::SessionEngine *engine,
                         ProjectScene *project, QObject *parent)
    : QObject(parent), m_ingest(ingest), m_store(store), m_engine(engine), m_project(project)
{
    m_detector = new integration::ClaudeDetector(this);
    m_launcher = new integration::SessionLauncher(this);
    m_sim = new sim::SimulationSource(this);

    connect(m_detector, &integration::ClaudeDetector::finished, this, [this]() {
        m_launcher->setClaudePath(m_detector->result().path);
        emit claudeChanged();
    });
    connect(m_ingest, &ingest::IngestServer::statsChanged, this, &Integration::telemetryChanged);
    connect(m_store, &store::EventStore::countChanged, this, &Integration::telemetryChanged);
    connect(m_store, &store::EventStore::opened, this, &Integration::telemetryChanged);
    connect(m_launcher, &integration::SessionLauncher::launchesChanged, this, &Integration::launchesChanged);
    connect(m_launcher, &integration::SessionLauncher::outputAppended, this, &Integration::launchOutputAppended);
    connect(m_launcher, &integration::SessionLauncher::streamEvent, this, [this](const core::NexusEvent &e) {
        m_store->append({ e });
        m_engine->ingestOne(e, true);
        m_engine->markLaunchedByNexus(e.sessionId);
    });
    connect(m_sim, &sim::SimulationSource::eventReady, this, [this](const core::NexusEvent &e) {
        m_store->append({ e });   // stored with simulated = 1, excluded from history by default
        m_engine->ingestOne(e, true);
    });
    connect(m_sim, &sim::SimulationSource::runningChanged, this, &Integration::simulationChanged);
    connect(m_engine, &session::SessionEngine::eventIngested, this, [this](const core::NexusEvent &e, int, bool) {
        if (e.kind == QLatin1String("system.setup_test") && m_probeState == QLatin1String("waiting")) {
            m_probeState = QStringLiteral("confirmed");
            m_probeMessage = QStringLiteral("Telemetry confirmed: the test event travelled relay → socket → NEXUS.");
            emit probeChanged();
        }
    });
    connect(m_project, &ProjectScene::projectChanged, this, &Integration::refreshHookStatus);
    writeSessionSettingsFile();
    refreshHookStatus();
}

bool Integration::claudeDetected() const { return m_detector->result().found; }
bool Integration::detecting() const { return m_detector->running(); }
QString Integration::claudePath() const { return m_detector->result().path; }
QString Integration::claudeVersion() const { return m_detector->result().version; }
QString Integration::claudeError() const { return m_detector->result().error; }
QString Integration::dataDir() const { return core::Paths::dataDir(); }

QString Integration::relayPath() const
{
#ifdef Q_OS_WIN
    return QDir::toNativeSeparators(QCoreApplication::applicationDirPath() + QStringLiteral("/nexus-relay.exe"));
#else
    return QCoreApplication::applicationDirPath() + QStringLiteral("/nexus-relay");
#endif
}

bool Integration::relayExists() const { return QFileInfo(relayPath()).isExecutable(); }
bool Integration::telemetryListening() const { return m_ingest->stats().listening; }
QString Integration::socketPath() const { return m_ingest->stats().socketPath; }
qint64 Integration::received() const { return m_ingest->stats().received; }
qint64 Integration::rejected() const { return m_ingest->stats().rejected; }
qint64 Integration::recovered() const { return m_ingest->stats().recovered; }
qint64 Integration::malformed() const { return m_ingest->stats().malformed; }
QString Integration::storeStatus() const { return m_store->status(); }
qint64 Integration::storedEvents() const { return m_store->storedCount(); }
bool Integration::simulationRunning() const { return m_sim->running(); }
QVariantList Integration::launches() const { return m_launcher->launches(); }
QString Integration::lastLaunchError() const { return m_launcher->lastError(); }
QStringList Integration::launchOutput(const QString &key) const { return m_launcher->output(key); }

void Integration::detect()
{
    m_detector->detect();
    emit claudeChanged();
}

void Integration::writeSessionSettingsFile()
{
    core::Paths::ensurePrivateDir(core::Paths::dataDir());
    m_sessionSettingsFile = core::Paths::dataDir() + QStringLiteral("/claude-session-settings.json");
    const QJsonObject s = HookInstaller::sessionSettings(relayPath(), false);
    core::Paths::writePrivateFile(m_sessionSettingsFile, QJsonDocument(s).toJson(QJsonDocument::Indented));
    m_launcher->setSettingsFile(m_sessionSettingsFile);
}

QString Integration::settingsPathFor(const QString &scope) const
{
    if (scope == QLatin1String("project")) {
        const QString root = m_project->projectRoot();
        return root.isEmpty() ? QString() : HookInstaller::projectLocalSettingsPath(root);
    }
    return HookInstaller::userSettingsPath();
}

void Integration::refreshHookStatus()
{
    auto toMap = [](const QString &path, const HookInstaller::Status &st) {
        return QVariantMap{ { QStringLiteral("path"), path }, { QStringLiteral("exists"), st.fileExists },
                            { QStringLiteral("parseable"), st.parseable }, { QStringLiteral("events"), st.events },
                            { QStringLiteral("eventCount"), int(st.events.size()) },
                            { QStringLiteral("complete"), st.events.size() >= HookInstaller::hookEvents().size() },
                            { QStringLiteral("statusline"), st.statusline }, { QStringLiteral("relayPath"), st.relayPathInFile } };
    };
    const QString u = HookInstaller::userSettingsPath();
    m_userHooks = toMap(u, HookInstaller::status(u));
    const QString p = settingsPathFor(QStringLiteral("project"));
    m_projectHooks = p.isEmpty() ? QVariantMap{} : toMap(p, HookInstaller::status(p));
    emit hooksChanged();
}

QVariantMap Integration::planToMap(const integration::InstallPlan &plan) const
{
    return { { QStringLiteral("path"), plan.path }, { QStringLiteral("exists"), plan.exists }, { QStringLiteral("changed"), plan.changed },
             { QStringLiteral("error"), plan.error }, { QStringLiteral("events"), plan.events }, { QStringLiteral("statusline"), plan.statusline },
             { QStringLiteral("diff"), HookInstaller::lineDiff(plan.before, plan.after) }, { QStringLiteral("uninstall"), plan.uninstall } };
}

QVariantMap Integration::previewInstall(const QString &scope, bool statusline)
{
    const QString path = settingsPathFor(scope);
    if (path.isEmpty())
        return { { QStringLiteral("error"), QStringLiteral("Open a project first to install project-local hooks.") } };
    const auto plan = HookInstaller::planInstall(path, relayPath(), statusline);
    m_plans.insert(QStringLiteral("install:") + scope, plan);
    return planToMap(plan);
}

QVariantMap Integration::applyInstall(const QString &scope, bool statusline)
{
    const QString key = QStringLiteral("install:") + scope;
    if (!m_plans.contains(key) || m_plans.value(key).statusline != statusline)
        return { { QStringLiteral("ok"), false }, { QStringLiteral("message"), QStringLiteral("Preview the change before applying it.") } };
    QString backup, error;
    const bool ok = HookInstaller::apply(m_plans.value(key), &backup, &error);
    m_plans.remove(key);
    refreshHookStatus();
    QString msg = ok ? QStringLiteral("NEXUS hooks installed in %1.").arg(settingsPathFor(scope)) : error;
    if (ok && !backup.isEmpty()) msg += QStringLiteral(" Backup: ") + backup;
    return { { QStringLiteral("ok"), ok }, { QStringLiteral("message"), msg }, { QStringLiteral("backup"), backup } };
}

QVariantMap Integration::previewUninstall(const QString &scope)
{
    const QString path = settingsPathFor(scope);
    if (path.isEmpty()) return { { QStringLiteral("error"), QStringLiteral("No project open.") } };
    const auto plan = HookInstaller::planUninstall(path);
    m_plans.insert(QStringLiteral("uninstall:") + scope, plan);
    return planToMap(plan);
}

QVariantMap Integration::applyUninstall(const QString &scope)
{
    const QString key = QStringLiteral("uninstall:") + scope;
    if (!m_plans.contains(key))
        return { { QStringLiteral("ok"), false }, { QStringLiteral("message"), QStringLiteral("Preview the change before applying it.") } };
    QString backup, error;
    const bool ok = HookInstaller::apply(m_plans.value(key), &backup, &error);
    m_plans.remove(key);
    refreshHookStatus();
    return { { QStringLiteral("ok"), ok }, { QStringLiteral("message"), ok ? QStringLiteral("NEXUS hooks removed. Backup: ") + backup : error } };
}

void Integration::runProbe()
{
    if (!relayExists()) {
        m_probeState = QStringLiteral("failed");
        m_probeMessage = QStringLiteral("nexus-relay was not found next to the NEXUS executable.");
        emit probeChanged();
        return;
    }
    m_probeState = QStringLiteral("waiting");
    m_probeMessage = QStringLiteral("Sending a test event through nexus-relay…");
    emit probeChanged();
    auto *p = new QProcess(this);
    connect(p, &QProcess::finished, this, [this, p](int code) {
        p->deleteLater();
        if (m_probeState == QLatin1String("confirmed")) return;
        if (code == 0) {
            m_probeMessage = QStringLiteral("Relay delivered the event; waiting for NEXUS to process it…");
            QTimer::singleShot(3000, this, [this]() {
                if (m_probeState == QLatin1String("waiting")) {
                    m_probeState = QStringLiteral("failed");
                    m_probeMessage = QStringLiteral("The relay connected but no event was processed.");
                    emit probeChanged();
                }
            });
        } else {
            m_probeState = QStringLiteral("failed");
            m_probeMessage = code == 3 ? QStringLiteral("The relay could not reach NEXUS and spooled the event instead.")
                                       : QStringLiteral("The relay failed (exit code %1).").arg(code);
        }
        emit probeChanged();
    });
    p->start(relayPath(), { QStringLiteral("probe") });
}

QString Integration::launchHeadless(const QString &cwd, const QString &prompt, const QString &permissionMode, const QString &model)
{
    writeSessionSettingsFile();
    const QString key = m_launcher->launchHeadless(cwd, prompt, permissionMode, model);
    if (key.isEmpty())
        emit toast(QStringLiteral("error"), QStringLiteral("Could not start session"), m_launcher->lastError());
    return key;
}

QVariantMap Integration::launchTerminal(const QString &cwd)
{
    writeSessionSettingsFile();
    QString error;
    const bool ok = m_launcher->launchTerminal(cwd, &error);
    return { { QStringLiteral("ok"), ok }, { QStringLiteral("message"), ok ? QStringLiteral("Interactive session opened in a terminal.") : error } };
}

void Integration::stopLaunch(const QString &key)
{
    m_launcher->stop(key);
}

QVariantMap Integration::interruptSession(const QString &sessionId)
{
    const session::SessionRecord *s = m_engine->session(sessionId);
    if (!s) return { { QStringLiteral("ok"), false }, { QStringLiteral("message"), QStringLiteral("Unknown session.") } };
    if (s->simulated) return { { QStringLiteral("ok"), false }, { QStringLiteral("message"), QStringLiteral("Simulated sessions have no process.") } };
    if (s->claudePid <= 1) return { { QStringLiteral("ok"), false }, { QStringLiteral("message"), QStringLiteral("No Claude Code process id was reported for this session.") } };
#ifdef Q_OS_UNIX
    // Verify the pid still belongs to a claude process before signalling it.
    QFile cmdline(QStringLiteral("/proc/%1/cmdline").arg(s->claudePid));
    if (cmdline.open(QIODevice::ReadOnly)) {
        const QByteArray cl = cmdline.readAll();
        if (!cl.contains("claude") && !cl.contains("node"))
            return { { QStringLiteral("ok"), false }, { QStringLiteral("message"), QStringLiteral("Process %1 no longer looks like Claude Code; not signalled.").arg(s->claudePid) } };
    }
    if (::kill(s->claudePid, SIGINT) != 0)
        return { { QStringLiteral("ok"), false }, { QStringLiteral("message"), QString::fromLocal8Bit(strerror(errno)) } };
    return { { QStringLiteral("ok"), true }, { QStringLiteral("message"), QStringLiteral("Sent SIGINT to Claude Code (pid %1).").arg(s->claudePid) } };
#else
    return { { QStringLiteral("ok"), false }, { QStringLiteral("message"), QStringLiteral("Interrupting external sessions is not supported on this platform yet.") } };
#endif
}

void Integration::startSimulation(int agents)
{
    auto snap = m_project->snapshot();
    if (!snap) {
        emit toast(QStringLiteral("attention"), QStringLiteral("Open a project first"), QStringLiteral("Simulation uses the project's real file list."));
        return;
    }
    QStringList files;
    for (const auto &f : snap->files) files << f.relPath;
    m_sim->setProject(snap->root, files);
    m_sim->start(agents);
}

void Integration::stopSimulation() { m_sim->stop(); }

void Integration::clearSimulated()
{
    m_sim->stop();
    m_engine->clearSimulated();
    m_store->purgeSimulated();
}

bool Integration::openInEditor(const QString &absPath)
{
    const QString root = m_project->projectRoot();
    if (root.isEmpty() || !QFileInfo(absPath).canonicalFilePath().startsWith(QFileInfo(root).canonicalFilePath()))
        return false;   // project-root awareness: never open arbitrary paths
    const QString editor = qEnvironmentVariable("VISUAL", qEnvironmentVariable("EDITOR"));
    const QStringList guiEditors = { QStringLiteral("code"), QStringLiteral("cursor"), QStringLiteral("zed"), QStringLiteral("subl"), QStringLiteral("idea") };
    for (const QString &g : guiEditors) {
        if (editor.endsWith(g) && QProcess::startDetached(editor, { absPath }))
            return true;
    }
    return QDesktopServices::openUrl(QUrl::fromLocalFile(absPath));
}

bool Integration::revealInFileManager(const QString &absPath)
{
    return QDesktopServices::openUrl(QUrl::fromLocalFile(QFileInfo(absPath).absolutePath()));
}

QVariantMap Integration::openTerminalAt(const QString &dir)
{
    QStringList args;
    const QString term = integration::SessionLauncher::findTerminal(&args, dir, {});
    if (term.isEmpty())
        return { { QStringLiteral("ok"), false }, { QStringLiteral("message"), QStringLiteral("No terminal emulator found.") } };
    // drop a trailing "-e"/"--"/"-x" left without a command
    while (!args.isEmpty() && (args.last() == QLatin1String("-e") || args.last() == QLatin1String("--") || args.last() == QLatin1String("-x")))
        args.removeLast();
    const bool ok = QProcess::startDetached(term, args, dir);
    return { { QStringLiteral("ok"), ok }, { QStringLiteral("message"), ok ? QStringLiteral("Terminal opened in ") + dir : QStringLiteral("Could not start ") + term } };
}

void Integration::copyToClipboard(const QString &text)
{
    if (auto *cb = QGuiApplication::clipboard()) cb->setText(text);
}

} // namespace nexus::app
