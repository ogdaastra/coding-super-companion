#include "ProjectService.h"

#include <QDir>
#include <QFileInfo>
#include <QPointer>
#include <QtConcurrent/QtConcurrentRun>

namespace nexus::project {

ProjectService::ProjectService(QObject *parent)
    : QObject(parent)
{
    m_debounce.setSingleShot(true);
    connect(&m_debounce, &QTimer::timeout, this, &ProjectService::startIndex);
    auto onChange = [this](const QString &path) {
        emit fileSystemChanged(path);
        reindexSoon();
    };
    connect(&m_watcher, &QFileSystemWatcher::directoryChanged, this, onChange);
    connect(&m_watcher, &QFileSystemWatcher::fileChanged, this, onChange);
}

ProjectService::~ProjectService()
{
    if (m_cancel)
        m_cancel->store(true);
}

void ProjectService::open(const QString &root)
{
    close();
    m_root = QDir(root).canonicalPath();
    if (m_root.isEmpty()) {
        emit indexingFailed(QStringLiteral("Project directory does not exist: ") + root);
        return;
    }
    startIndex();
}

void ProjectService::close()
{
    if (m_cancel)
        m_cancel->store(true);
    const QStringList dirs = m_watcher.directories();
    if (!dirs.isEmpty())
        m_watcher.removePaths(dirs);
    const QStringList files = m_watcher.files();
    if (!files.isEmpty())
        m_watcher.removePaths(files);
    m_root.clear();
    m_snapshot.reset();
}

void ProjectService::reindexSoon(int delayMs)
{
    if (!m_root.isEmpty())
        m_debounce.start(delayMs);
}

void ProjectService::startIndex()
{
    if (m_root.isEmpty())
        return;
    if (m_indexing) {
        m_pending = true;
        return;
    }
    m_indexing = true;
    m_cancel = std::make_shared<std::atomic_bool>(false);
    emit indexingStarted();
    const QString root = m_root;
    auto cancel = m_cancel;
    QPointer<ProjectService> self(this);
    auto progress = [self](int done, int total) {
        QMetaObject::invokeMethod(self.data(), [self, done, total]() {
            if (!self) return;
            self->m_progressDone = done;
            self->m_progressTotal = total;
            emit self->indexingProgress(done, total);
        }, Qt::QueuedConnection);
    };
    QtConcurrent::run([root, cancel, progress]() {
        return std::make_shared<ProjectSnapshot>(ProjectIndexer::index(root, {}, cancel.get(), progress));
    }).then(this, [self, cancel](std::shared_ptr<ProjectSnapshot> snap) {
        if (!self)
            return;
        self->m_indexing = false;
        if (cancel->load() || snap->root != self->m_root) {
            if (self->m_pending) { self->m_pending = false; self->startIndex(); }
            return;
        }
        bool structureChanged = true;
        if (self->m_snapshot && self->m_snapshot->files.size() == snap->files.size()) {
            structureChanged = false;
            for (size_t i = 0; i < snap->files.size(); ++i) {
                if (snap->files[i].relPath != self->m_snapshot->files[i].relPath) { structureChanged = true; break; }
            }
            if (!structureChanged && snap->deps.size() != self->m_snapshot->deps.size())
                structureChanged = true;
        }
        snap->generation = ++self->m_generation;
        self->m_snapshot = snap;
        self->rewatch();
        emit self->snapshotReady(self->m_snapshot, structureChanged);
        if (self->m_pending) {
            self->m_pending = false;
            self->reindexSoon(300);
        }
    });
}

void ProjectService::rewatch()
{
    if (!m_snapshot)
        return;
    QStringList wanted;
    wanted.reserve(int(m_snapshot->dirs.size()));
    // inotify watch budgets are finite; directories carry add/remove/rename events,
    // and individual files are watched only for small projects.
    for (const DirInfo &d : m_snapshot->dirs) {
        wanted.append(d.relPath.isEmpty() ? m_root : m_root + QLatin1Char('/') + d.relPath);
        if (wanted.size() >= 3000)
            break;
    }
    if (m_snapshot->files.size() <= 1500) {
        for (const FileInfo &f : m_snapshot->files)
            if (f.category != FileCategory::Asset)
                wanted.append(m_root + QLatin1Char('/') + f.relPath);
    }
    const QStringList currentDirs = m_watcher.directories();
    const QStringList currentFiles = m_watcher.files();
    QSet<QString> want(wanted.begin(), wanted.end());
    QStringList toRemove;
    for (const QString &p : currentDirs) if (!want.contains(p)) toRemove.append(p);
    for (const QString &p : currentFiles) if (!want.contains(p)) toRemove.append(p);
    if (!toRemove.isEmpty())
        m_watcher.removePaths(toRemove);
    QSet<QString> have(currentDirs.begin(), currentDirs.end());
    for (const QString &p : currentFiles) have.insert(p);
    QStringList toAdd;
    for (const QString &p : wanted) if (!have.contains(p)) toAdd.append(p);
    if (!toAdd.isEmpty())
        m_watcher.addPaths(toAdd);
}

} // namespace nexus::project
