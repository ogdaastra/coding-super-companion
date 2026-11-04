#pragma once

#include "GraphicsSetup.h"
#include "core/NexusEvent.h"

#include <QObject>
#include <QPointer>
#include <QString>
#include <QStringList>
#include <memory>

class QQuickWindow;

namespace nexus::project { class ProjectService; class GitService; }
namespace nexus::render { class NexusViewport; }
namespace nexus::ingest { class IngestServer; }
namespace nexus::store { class EventStore; }
namespace nexus::session { class SessionEngine; }

namespace nexus::app {

class ProjectScene;
class VisualDirector;
class Integration;
class ChangeReview;
class TimelineController;

// Composition root: owns the subsystems and exposes them to QML as `nexus`.
class AppController : public QObject
{
    Q_OBJECT
    Q_PROPERTY(QString version READ version CONSTANT)
    Q_PROPERTY(QString graphicsRequest READ graphicsRequest CONSTANT)
    Q_PROPERTY(QObject *project READ projectObject CONSTANT)
    Q_PROPERTY(QObject *sessions READ sessionsObject CONSTANT)
    Q_PROPERTY(QObject *integration READ integrationObject CONSTANT)
    Q_PROPERTY(QObject *director READ directorObject CONSTANT)
    Q_PROPERTY(QObject *changes READ changesObject CONSTANT)
    Q_PROPERTY(QObject *timeline READ timelineObject CONSTANT)
    Q_PROPERTY(bool historyLoaded READ historyLoaded NOTIFY historyLoadedChanged)
    Q_PROPERTY(QStringList recentProjects READ recentProjects NOTIFY recentProjectsChanged)
    Q_PROPERTY(QString startupModule READ startupModule CONSTANT)
    Q_PROPERTY(QVariantList bookmarks READ bookmarks NOTIFY bookmarksChanged)

public:
    explicit AppController(const GraphicsChoice &gfx, QObject *parent = nullptr);
    ~AppController() override;

    bool parseCommandLine(const QStringList &args);
    void attachWindow(QQuickWindow *window);
    void start();

    QString version() const;
    QString graphicsRequest() const { return m_gfx.effective; }
    QObject *projectObject() const;
    QObject *sessionsObject() const;
    QObject *integrationObject() const;
    QObject *directorObject() const;
    QObject *changesObject() const;
    QObject *timelineObject() const;
    bool historyLoaded() const { return m_historyLoaded; }
    QStringList recentProjects() const;
    QString startupModule() const { return m_startupModule; }
    QVariantList bookmarks() const { return m_bookmarks; }
    Q_INVOKABLE void addBookmark(const QString &relPath, const QString &note);
    Q_INVOKABLE void removeBookmark(qint64 id);

    Q_INVOKABLE void openProject(const QString &path);
    Q_INVOKABLE QString formatTime(qint64 ms) const;
    Q_INVOKABLE QString formatDuration(qint64 ms) const;
    Q_INVOKABLE QString formatAgo(qint64 ms) const;
    Q_INVOKABLE QString formatBytes(qint64 bytes) const;
    Q_INVOKABLE QString homePath() const;

signals:
    void historyLoadedChanged();
    void recentProjectsChanged();
    void bookmarksChanged();

private:
    void scheduleScreenshot();
    void onLiveEvents(const core::EventList &events);

    GraphicsChoice m_gfx;
    QPointer<QQuickWindow> m_window;
    QPointer<render::NexusViewport> m_viewport;
    QString m_screenshotPath;
    int m_screenshotDelayMs = 4000;
    QString m_initialProject;
    bool m_autoSimulate = false;
    QString m_selectKey;
    QString m_startupModule;
    int m_layoutOverride = -1;
    QString m_launchPrompt;
    int m_benchmarkSeconds = 0;
    int m_benchmarkQuality = -1;
    void runBenchmark();

    project::ProjectService *m_projects = nullptr;
    project::GitService *m_git = nullptr;
    ProjectScene *m_projectScene = nullptr;
    ingest::IngestServer *m_ingest = nullptr;
    store::EventStore *m_store = nullptr;
    session::SessionEngine *m_engine = nullptr;
    VisualDirector *m_director = nullptr;
    Integration *m_integration = nullptr;
    ChangeReview *m_changes = nullptr;
    TimelineController *m_timeline = nullptr;

    bool m_historyLoaded = false;
    QVariantList m_bookmarks;
    core::EventList m_pendingLive;
};

} // namespace nexus::app
