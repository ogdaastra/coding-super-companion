#pragma once

#include "graph/Layouts.h"
#include "project/GitService.h"
#include "project/ProjectService.h"

#include <QHash>
#include <QObject>
#include <QPointer>
#include <QVariantList>
#include <QVariantMap>

namespace nexus::render { class NexusViewport; }

namespace nexus::app {

// Bridges project intelligence (snapshot, git) and the 3D scene: builds nodes/edges,
// runs layouts on the thread pool, maps file paths to scene nodes and answers
// inspection queries for the intelligence panel.
class ProjectScene : public QObject
{
    Q_OBJECT
    Q_PROPERTY(bool hasProject READ hasProject NOTIFY projectChanged)
    Q_PROPERTY(QString projectName READ projectName NOTIFY projectChanged)
    Q_PROPERTY(QString projectRoot READ projectRoot NOTIFY projectChanged)
    Q_PROPERTY(bool indexing READ indexing NOTIFY indexingChanged)
    Q_PROPERTY(int indexDone READ indexDone NOTIFY indexingChanged)
    Q_PROPERTY(int indexTotal READ indexTotal NOTIFY indexingChanged)
    Q_PROPERTY(int fileCount READ fileCount NOTIFY statsChanged)
    Q_PROPERTY(int dirCount READ dirCount NOTIFY statsChanged)
    Q_PROPERTY(int dependencyCount READ dependencyCount NOTIFY statsChanged)
    Q_PROPERTY(int symbolCount READ symbolCount NOTIFY statsChanged)
    Q_PROPERTY(qint64 indexMs READ indexMs NOTIFY statsChanged)
    Q_PROPERTY(bool isGitRepo READ isGitRepo NOTIFY statsChanged)
    Q_PROPERTY(bool truncated READ truncated NOTIFY statsChanged)
    Q_PROPERTY(QVariantList languages READ languages NOTIFY statsChanged)
    Q_PROPERTY(int layout READ layout WRITE setLayout NOTIFY layoutChanged)
    Q_PROPERTY(QString layoutName READ layoutName NOTIFY layoutChanged)
    Q_PROPERTY(bool layingOut READ layingOut NOTIFY layoutChanged)
    Q_PROPERTY(QString focusKey READ focusKey NOTIFY focusChanged)
    Q_PROPERTY(QString branch READ branch NOTIFY gitChanged)
    Q_PROPERTY(int changedCount READ changedCount NOTIFY gitChanged)

public:
    ProjectScene(project::ProjectService *projects, project::GitService *git, QObject *parent = nullptr);

    void setViewport(render::NexusViewport *vp);
    render::NexusViewport *viewport() const;

    bool hasProject() const { return bool(m_snap); }
    QString projectName() const { return m_snap ? m_snap->name : QString(); }
    QString projectRoot() const { return m_snap ? m_snap->root : m_projects->root(); }
    bool indexing() const { return m_projects->indexing(); }
    int indexDone() const { return m_projects->progressDone(); }
    int indexTotal() const { return m_projects->progressTotal(); }
    int fileCount() const { return m_snap ? int(m_snap->files.size()) : 0; }
    int dirCount() const { return m_snap ? int(m_snap->dirs.size()) - 1 : 0; }
    int dependencyCount() const { return m_snap ? int(m_snap->deps.size()) : 0; }
    int symbolCount() const { return m_symbolCount; }
    qint64 indexMs() const { return m_snap ? m_snap->indexMs : 0; }
    bool isGitRepo() const { return m_snap && m_snap->isGitRepo; }
    bool truncated() const { return m_snap && m_snap->truncated; }
    QVariantList languages() const;
    int layout() const { return int(m_layout); }
    void setLayout(int kind);
    QString layoutName() const { return graph::layoutName(m_layout); }
    bool layingOut() const { return m_layoutRunning; }
    QString focusKey() const { return m_focusKey; }
    QString branch() const;
    int changedCount() const;

    project::ProjectSnapshotPtr snapshot() const { return m_snap; }

    // Mapping helpers used by the telemetry → visual director
    int sceneIndexForKey(const QString &key) const { return m_keyToScene.value(key, -1); }
    int sceneIndexForAbsolutePath(const QString &absPath) const;
    QString relativePath(const QString &absPath) const;
    int dirSceneIndexForAbsolutePath(const QString &absPath) const;
    std::vector<int> dependents(int sceneIndex, int maxCount = 24) const;   // files importing this one
    std::vector<int> dependencies(int sceneIndex, int maxCount = 24) const; // files this one imports

    Q_INVOKABLE QVariantMap nodeInfo(const QString &key) const;
    Q_INVOKABLE QVariantList topLevel() const;
    Q_INVOKABLE QVariantList filesByCategory(const QString &category, int limit = 200) const;
    Q_INVOKABLE void focus(const QString &key);
    Q_INVOKABLE void clearFocus();
    Q_INVOKABLE QVariantList search(const QString &query, int limit = 30) const;
    Q_INVOKABLE QString keyForGlobal(int globalIndex) const;
    Q_INVOKABLE int globalForKey(const QString &key) const;
    Q_INVOKABLE void setHeatValues(const QVariantMap &relPathToHeat);

signals:
    void projectChanged();
    void indexingChanged();
    void statsChanged();
    void layoutChanged();
    void focusChanged();
    void gitChanged();
    void sceneRebuilt();

private:
    void onSnapshot(const project::ProjectSnapshotPtr &snap, bool structureChanged);
    void rebuildScene();
    void requestLayout(bool warmStart);
    void applyGit();

    project::ProjectService *m_projects;
    project::GitService *m_git;
    QPointer<render::NexusViewport> m_viewport;
    project::ProjectSnapshotPtr m_snap;

    // scene index layout: [dirs (excluding root) | files]
    std::vector<int> m_dirToScene;   // dir index → scene index (-1 for root)
    std::vector<int> m_fileToScene;  // file index → scene index
    std::vector<int> m_sceneToFile;  // scene index → file index (-1 for dirs)
    std::vector<int> m_sceneToDir;   // scene index → dir index (-1 for files)
    QHash<QString, int> m_keyToScene;
    std::vector<std::vector<int>> m_importsOf;   // file → files it imports
    std::vector<std::vector<int>> m_importedBy;  // file → files importing it
    int m_symbolCount = 0;

    graph::LayoutKind m_layout = graph::LayoutKind::Galaxy;
    bool m_layoutRunning = false;
    bool m_layoutPending = false;
    quint64 m_layoutTicket = 0;
    QString m_focusKey;
    bool m_needsFraming = true;   // frame the camera after the next layout
};

} // namespace nexus::app
