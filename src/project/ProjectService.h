#pragma once

#include "ProjectIndexer.h"
#include "ProjectTypes.h"

#include <QFileSystemWatcher>
#include <QObject>
#include <QTimer>
#include <atomic>
#include <memory>

namespace nexus::project {

// Owns the current project snapshot. Indexing runs on the thread pool; the filesystem is
// watched (directories) and changes trigger a debounced re-index.
class ProjectService : public QObject
{
    Q_OBJECT
public:
    explicit ProjectService(QObject *parent = nullptr);
    ~ProjectService() override;

    void open(const QString &root);
    void close();
    void reindexSoon(int delayMs = 700);

    QString root() const { return m_root; }
    ProjectSnapshotPtr snapshot() const { return m_snapshot; }
    bool indexing() const { return m_indexing; }
    int progressDone() const { return m_progressDone; }
    int progressTotal() const { return m_progressTotal; }

signals:
    void indexingStarted();
    void indexingProgress(int done, int total);
    void snapshotReady(const nexus::project::ProjectSnapshotPtr &snapshot, bool structureChanged);
    void fileSystemChanged(const QString &path);
    void indexingFailed(const QString &message);

private:
    void startIndex();
    void rewatch();

    QString m_root;
    ProjectSnapshotPtr m_snapshot;
    QFileSystemWatcher m_watcher;
    QTimer m_debounce;
    bool m_indexing = false;
    bool m_pending = false;
    std::shared_ptr<std::atomic_bool> m_cancel;
    int m_progressDone = 0;
    int m_progressTotal = 0;
    quint64 m_generation = 0;
};

} // namespace nexus::project
