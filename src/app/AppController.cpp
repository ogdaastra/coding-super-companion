#include "AppController.h"
#include "ChangeReview.h"
#include "Integration.h"
#include "ProjectScene.h"
#include "TimelineController.h"
#include "VisualDirector.h"

#include "core/Paths.h"
#include "ingest/IngestServer.h"
#include "project/GitService.h"
#include "project/ProjectService.h"
#include "render/NexusViewport.h"
#include "session/SessionEngine.h"
#include "store/EventStore.h"

#include <QCommandLineParser>
#include <QCoreApplication>
#include <QDateTime>
#include <QDir>
#include <QImage>
#include <QLocale>
#include <QQuickWindow>
#include <QSettings>
#include <QTimer>
#include <QUrl>
#include <cstdio>

namespace nexus::app {

AppController::AppController(const GraphicsChoice &gfx, QObject *parent)
    : QObject(parent), m_gfx(gfx)
{
    core::Paths::ensurePrivateDir(core::Paths::dataDir());
    m_projects = new project::ProjectService(this);
    m_git = new project::GitService(this);
    m_projectScene = new ProjectScene(m_projects, m_git, this);
    m_ingest = new ingest::IngestServer(this);
    m_store = new store::EventStore(core::Paths::dataDir() + QStringLiteral("/events.db"), this);
    m_engine = new session::SessionEngine(this);
    m_director = new VisualDirector(m_engine, m_projectScene, this);
    m_integration = new Integration(m_ingest, m_store, m_engine, m_projectScene, this);
    m_changes = new ChangeReview(m_git, m_engine, m_projectScene, this);
    m_timeline = new TimelineController(m_engine, m_director, this);

    // live telemetry → persistent store + session engine (after history is restored)
    connect(m_ingest, &ingest::IngestServer::eventsReady, this, &AppController::onLiveEvents);
    connect(m_store, &store::EventStore::opened, this, [this](bool ok) {
        if (!ok) {
            qWarning("NEXUS: event store unavailable: %s", qPrintable(m_store->status()));
            m_historyLoaded = true;
            emit historyLoadedChanged();
            onLiveEvents({});
            return;
        }
        // restore the last 24 hours of real (non-simulated) history
        m_store->loadRecent(30000, QDateTime::currentMSecsSinceEpoch() - qint64(24) * 3600 * 1000, false);
    });
    connect(m_store, &store::EventStore::bookmarksLoaded, this, [this](const QVariantList &b) {
        m_bookmarks = b;
        emit bookmarksChanged();
    });
    connect(m_projectScene, &ProjectScene::projectChanged, this, [this]() {
        if (m_store->isOpen()) m_store->loadBookmarks(m_projectScene->projectRoot());
    });
    connect(m_store, &store::EventStore::opened, this, [this](bool ok) {
        if (ok && m_projectScene->hasProject()) m_store->loadBookmarks(m_projectScene->projectRoot());
    });
    connect(m_store, &store::EventStore::recentLoaded, this, [this](const core::EventList &events) {
        if (m_historyLoaded) return;
        m_engine->ingest(events, false);
        m_historyLoaded = true;
        emit historyLoadedChanged();
        onLiveEvents({});   // flush events that arrived while history was loading
    });
}

AppController::~AppController() = default;

void AppController::addBookmark(const QString &relPath, const QString &note)
{
    if (m_projectScene->hasProject())
        m_store->addBookmark(m_projectScene->projectRoot(), relPath, note);
}

void AppController::removeBookmark(qint64 id)
{
    m_store->removeBookmark(id);
}

QString AppController::version() const { return QCoreApplication::applicationVersion(); }
QObject *AppController::projectObject() const { return m_projectScene; }
QObject *AppController::sessionsObject() const { return m_engine; }
QObject *AppController::integrationObject() const { return m_integration; }
QObject *AppController::directorObject() const { return m_director; }
QObject *AppController::changesObject() const { return m_changes; }
QObject *AppController::timelineObject() const { return m_timeline; }
QString AppController::homePath() const { return QDir::homePath(); }

QStringList AppController::recentProjects() const
{
    return QSettings().value(QStringLiteral("project/recent")).toStringList();
}

void AppController::onLiveEvents(const core::EventList &events)
{
    if (!m_historyLoaded) {
        m_pendingLive += events;
        return;
    }
    core::EventList batch = m_pendingLive;
    batch += events;
    m_pendingLive.clear();
    if (batch.isEmpty()) return;
    m_store->append(batch);
    m_engine->ingest(batch, true);
}

bool AppController::parseCommandLine(const QStringList &args)
{
    QCommandLineParser p;
    p.setApplicationDescription(QStringLiteral("NEXUS — native command environment for AI coding agents"));
    p.addHelpOption();
    p.addVersionOption();
    p.addOption({ QStringLiteral("backend"), QStringLiteral("Graphics API: auto, vulkan, opengl, metal, d3d11, d3d12."), QStringLiteral("api") });
    p.addOption({ QStringLiteral("project"), QStringLiteral("Open this project directory on start."), QStringLiteral("path") });
    p.addOption({ QStringLiteral("screenshot"), QStringLiteral("Save a screenshot to <file> and quit (automated visual review)."), QStringLiteral("file") });
    p.addOption({ QStringLiteral("screenshot-delay"), QStringLiteral("Delay before the screenshot in ms (default 4000)."), QStringLiteral("ms") });
    p.addOption({ QStringLiteral("simulate"), QStringLiteral("Start the clearly-labelled simulation on launch.") });
    p.addOption({ QStringLiteral("select"), QStringLiteral("Select and focus a project node by relative path."), QStringLiteral("key") });
    p.addOption({ QStringLiteral("module"), QStringLiteral("Initial module: core, universe, observatory, changes, command, agents, atlas, setup."), QStringLiteral("name") });
    p.addOption({ QStringLiteral("layout"), QStringLiteral("Initial layout 0-5 (galaxy, constellation, force, layered, tree, heatmap)."), QStringLiteral("n") });
    p.process(args);
    m_screenshotPath = p.value(QStringLiteral("screenshot"));
    if (p.isSet(QStringLiteral("screenshot-delay")))
        m_screenshotDelayMs = p.value(QStringLiteral("screenshot-delay")).toInt();
    m_initialProject = p.value(QStringLiteral("project"));
    m_autoSimulate = p.isSet(QStringLiteral("simulate"));
    m_selectKey = p.value(QStringLiteral("select"));
    m_startupModule = p.value(QStringLiteral("module"));
    if (p.isSet(QStringLiteral("layout"))) m_layoutOverride = p.value(QStringLiteral("layout")).toInt();
    return true;
}

void AppController::attachWindow(QQuickWindow *window)
{
    m_window = window;
    m_viewport = window->findChild<render::NexusViewport *>(QStringLiteral("viewport"));
    if (m_viewport) {
        m_projectScene->setViewport(m_viewport);
        m_director->setViewport(m_viewport);
    } else {
        qWarning("NEXUS: no NexusViewport named 'viewport' found in the QML scene");
    }
}

void AppController::start()
{
    m_ingest->start();
    m_store->start();
    m_integration->detect();

    QString project = m_initialProject;
    if (project.isEmpty())
        project = QSettings().value(QStringLiteral("project/last")).toString();
    if (!project.isEmpty() && QDir(project).exists())
        openProject(project);
    if (m_layoutOverride >= 0)
        m_projectScene->setLayout(m_layoutOverride);

    if (m_autoSimulate || !m_selectKey.isEmpty()) {
        // wait for the first snapshot so the simulation and selection have real files
        auto conn = std::make_shared<QMetaObject::Connection>();
        *conn = connect(m_projectScene, &ProjectScene::sceneRebuilt, this, [this, conn]() {
            disconnect(*conn);
            if (m_autoSimulate)
                QTimer::singleShot(1200, this, [this]() { m_integration->startSimulation(2); });
            if (!m_selectKey.isEmpty() && m_viewport) {
                QTimer::singleShot(2600, this, [this]() {
                    const int g = m_projectScene->globalForKey(m_selectKey);
                    if (g >= 0) {
                        m_viewport->select(g);
                        m_viewport->flyToNode(g);
                        m_projectScene->focus(m_selectKey);
                        emit m_viewport->nodeClicked(g, m_selectKey);
                    }
                });
            }
        });
    }
    if (!m_screenshotPath.isEmpty())
        scheduleScreenshot();
}

void AppController::openProject(const QString &path)
{
    QString p = path;
    if (p.startsWith(QLatin1String("file://")))
        p = QUrl(p).toLocalFile();
    if (!QDir(p).exists())
        return;
    const QString canon = QDir(p).canonicalPath();
    QSettings s;
    s.setValue(QStringLiteral("project/last"), canon);
    QStringList recent = s.value(QStringLiteral("project/recent")).toStringList();
    recent.removeAll(canon);
    recent.prepend(canon);
    while (recent.size() > 8) recent.removeLast();
    s.setValue(QStringLiteral("project/recent"), recent);
    emit recentProjectsChanged();
    m_projects->open(canon);
}

QString AppController::formatTime(qint64 ms) const
{
    if (ms <= 0) return QStringLiteral("—");
    const QDateTime dt = QDateTime::fromMSecsSinceEpoch(ms);
    if (dt.date() == QDate::currentDate())
        return dt.toString(QStringLiteral("HH:mm:ss.zzz")).left(10);
    return dt.toString(QStringLiteral("d MMM HH:mm"));
}

QString AppController::formatDuration(qint64 ms) const
{
    if (ms < 0) return QStringLiteral("—");
    if (ms < 1000) return QStringLiteral("%1 ms").arg(ms);
    if (ms < 60000) return QStringLiteral("%1 s").arg(double(ms) / 1000.0, 0, 'f', ms < 10000 ? 2 : 1);
    if (ms < 3600000) return QStringLiteral("%1m %2s").arg(ms / 60000).arg((ms / 1000) % 60, 2, 10, QLatin1Char('0'));
    return QStringLiteral("%1h %2m").arg(ms / 3600000).arg((ms / 60000) % 60, 2, 10, QLatin1Char('0'));
}

QString AppController::formatAgo(qint64 ms) const
{
    if (ms <= 0) return QStringLiteral("—");
    const qint64 d = QDateTime::currentMSecsSinceEpoch() - ms;
    if (d < 5000) return QStringLiteral("just now");
    if (d < 60000) return QStringLiteral("%1 s ago").arg(d / 1000);
    if (d < 3600000) return QStringLiteral("%1 min ago").arg(d / 60000);
    if (d < 86400000) return QStringLiteral("%1 h ago").arg(d / 3600000);
    return QStringLiteral("%1 d ago").arg(d / 86400000);
}

QString AppController::formatBytes(qint64 b) const
{
    return QLocale::system().formattedDataSize(b, 1, QLocale::DataSizeTraditionalFormat);
}

void AppController::scheduleScreenshot()
{
    QTimer::singleShot(m_screenshotDelayMs, this, [this]() {
        if (!m_window)
            return;
        const QImage img = m_window->grabWindow();
        const bool ok = img.save(m_screenshotPath);
        std::fprintf(stderr, "NEXUS: screenshot %s -> %s\n", ok ? "saved" : "FAILED", qPrintable(m_screenshotPath));
        QCoreApplication::quit();
    });
}

} // namespace nexus::app
