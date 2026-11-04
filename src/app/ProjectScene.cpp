#include "ProjectScene.h"

#include "project/SourceScanner.h"
#include "render/NexusViewport.h"

#include <QDir>
#include <QFileInfo>
#include <QPointer>
#include <QtConcurrent/QtConcurrentRun>
#include <algorithm>
#include <cmath>

namespace nexus::app {

using namespace nexus::project;
using namespace nexus::render;

namespace {

QVector3D colorFor(FileCategory c)
{
    switch (c) {
    case FileCategory::Source: return { 0.25f, 0.72f, 1.00f };
    case FileCategory::Header: return { 0.46f, 0.86f, 1.00f };
    case FileCategory::Test: return { 0.31f, 0.89f, 0.76f };
    case FileCategory::Doc: return { 0.60f, 0.53f, 1.00f };
    case FileCategory::Config: return { 0.42f, 0.48f, 0.98f };
    case FileCategory::Build: return { 0.50f, 0.56f, 0.98f };
    case FileCategory::Shader: return { 0.55f, 0.66f, 1.00f };
    case FileCategory::Asset: return { 0.22f, 0.30f, 0.44f };
    default: return { 0.34f, 0.50f, 0.72f };
    }
}

NodeKind kindFor(FileCategory c)
{
    return (c == FileCategory::Doc || c == FileCategory::Config) ? NodeKind::Knowledge : NodeKind::File;
}

GitCode gitCodeFor(GitChange c)
{
    switch (c) {
    case GitChange::Modified: case GitChange::Renamed: return GitCode::Modified;
    case GitChange::Added: return GitCode::Added;
    case GitChange::Deleted: return GitCode::Deleted;
    case GitChange::Untracked: return GitCode::Untracked;
    case GitChange::Conflict: return GitCode::Conflict;
    default: return GitCode::Clean;
    }
}

} // namespace

ProjectScene::ProjectScene(ProjectService *projects, GitService *git, QObject *parent)
    : QObject(parent), m_projects(projects), m_git(git)
{
    connect(projects, &ProjectService::snapshotReady, this, &ProjectScene::onSnapshot);
    connect(projects, &ProjectService::indexingStarted, this, &ProjectScene::indexingChanged);
    connect(projects, &ProjectService::indexingProgress, this, &ProjectScene::indexingChanged);
    connect(projects, &ProjectService::fileSystemChanged, this, [this]() { m_git->refreshSoon(400); });
    connect(git, &GitService::stateChanged, this, [this]() {
        applyGit();
        emit gitChanged();
    });
}

NexusViewport *ProjectScene::viewport() const
{
    return m_viewport.data();
}

void ProjectScene::setViewport(NexusViewport *vp)
{
    m_viewport = vp;
    if (m_snap)
        rebuildScene();
}

QVariantList ProjectScene::languages() const
{
    QVariantList out;
    if (!m_snap)
        return out;
    QList<QPair<int, QString>> v;
    for (auto it = m_snap->languageCounts.cbegin(); it != m_snap->languageCounts.cend(); ++it)
        v.append({ it.value(), it.key() });
    std::sort(v.begin(), v.end(), [](const auto &a, const auto &b) { return a.first > b.first; });
    for (const auto &p : v)
        out.append(QVariantMap{ { QStringLiteral("name"), p.second }, { QStringLiteral("count"), p.first } });
    return out;
}

QString ProjectScene::branch() const
{
    const GitStatePtr st = m_git->state();
    return st && st->isRepo ? st->branch : QString();
}

int ProjectScene::changedCount() const
{
    const GitStatePtr st = m_git->state();
    return st ? int(st->files.size()) : 0;
}

void ProjectScene::onSnapshot(const ProjectSnapshotPtr &snap, bool structureChanged)
{
    const bool first = !m_snap || m_snap->root != snap->root;
    m_snap = snap;
    m_symbolCount = 0;
    for (const FileInfo &f : snap->files)
        m_symbolCount += int(f.symbols.size());
    if (first) {
        m_git->setRoot(snap->root);
        m_needsFraming = true;
        emit projectChanged();
    }
    if (first || structureChanged)
        rebuildScene();
    emit indexingChanged();
    emit statsChanged();
}

void ProjectScene::rebuildScene()
{
    if (!m_snap || !m_viewport)
        return;
    const ProjectSnapshot &s = *m_snap;
    std::vector<SceneNode> nodes;
    std::vector<SceneEdge> edges;
    m_dirToScene.assign(s.dirs.size(), -1);
    m_fileToScene.assign(s.files.size(), -1);
    m_sceneToFile.clear();
    m_sceneToDir.clear();
    m_keyToScene.clear();

    for (size_t d = 1; d < s.dirs.size(); ++d) {
        const DirInfo &di = s.dirs[d];
        SceneNode n;
        n.key = di.relPath + QLatin1Char('/');
        n.label = di.name + QLatin1Char('/');
        n.kind = NodeKind::Directory;
        n.radius = std::min(1.25f + 0.26f * std::sqrt(float(di.totalFiles)), 3.3f);
        n.color = QVector3D(0.55f, 0.80f, 1.0f);
        n.importance = di.depth <= 1 ? 1.0f : (di.depth == 2 ? 0.55f : 0.22f);
        m_dirToScene[d] = int(nodes.size());
        m_keyToScene.insert(n.key, int(nodes.size()));
        m_sceneToFile.push_back(-1);
        m_sceneToDir.push_back(int(d));
        nodes.push_back(n);
    }
    for (size_t d = 1; d < s.dirs.size(); ++d) {
        const int parentDir = s.dirs[d].parent;
        nodes[size_t(m_dirToScene[d])].parent = parentDir > 0 ? m_dirToScene[size_t(parentDir)] : -1;
    }

    m_importsOf.assign(s.files.size(), {});
    m_importedBy.assign(s.files.size(), {});
    for (const DepEdge &e : s.deps) {
        m_importsOf[size_t(e.from)].push_back(e.to);
        m_importedBy[size_t(e.to)].push_back(e.from);
    }
    int maxIn = 1;
    for (const auto &v : m_importedBy) maxIn = std::max(maxIn, int(v.size()));

    for (size_t f = 0; f < s.files.size(); ++f) {
        const FileInfo &fi = s.files[f];
        SceneNode n;
        n.key = fi.relPath;
        n.label = fi.name;
        n.kind = kindFor(fi.category);
        n.radius = std::clamp(0.62f + 0.30f * std::log2(1.f + float(fi.lines) / 40.f), 0.62f, 2.1f);
        n.color = colorFor(fi.category);
        n.parent = fi.dir > 0 ? m_dirToScene[size_t(fi.dir)] : -1;
        n.importance = std::min(1.f, 0.55f * float(m_importedBy[f].size()) / float(maxIn) + (fi.lines > 600 ? 0.15f : 0.f));
        m_fileToScene[f] = int(nodes.size());
        m_keyToScene.insert(n.key, int(nodes.size()));
        m_sceneToFile.push_back(int(f));
        m_sceneToDir.push_back(-1);
        nodes.push_back(n);
    }

    for (size_t i = 0; i < nodes.size(); ++i)
        if (nodes[i].parent >= 0)
            edges.push_back({ nodes[i].parent, int(i), EdgeKind::Containment, 1.f });
    for (const DepEdge &e : s.deps) {
        const FileInfo &from = s.files[size_t(e.from)];
        const bool knowledge = from.category == FileCategory::Doc;
        edges.push_back({ m_fileToScene[size_t(e.from)], m_fileToScene[size_t(e.to)],
                          knowledge ? EdgeKind::Knowledge : EdgeKind::Import, 1.f });
    }

    m_viewport->scene()->setProjectGraph(nodes, edges);
    applyGit();
    requestLayout(false);
    emit sceneRebuilt();
}

void ProjectScene::setLayout(int kind)
{
    kind = std::clamp(kind, 0, 5);
    if (graph::LayoutKind(kind) == m_layout && !m_layoutRunning)
        return;
    m_layout = graph::LayoutKind(kind);
    m_needsFraming = true;
    emit layoutChanged();
    requestLayout(true);
}

void ProjectScene::requestLayout(bool warmStart)
{
    if (!m_viewport || !m_snap)
        return;
    if (m_layoutRunning) {
        m_layoutPending = true;
        return;
    }
    VisualScene *scene = m_viewport->scene();
    graph::LayoutRequest req;
    req.kind = m_layout;
    const int n = scene->projectNodeCount();
    req.nodes.resize(size_t(n));
    for (int i = 0; i < n; ++i) {
        const SceneNode &sn = scene->projectNode(i);
        req.nodes[size_t(i)].parent = sn.parent;
        req.nodes[size_t(i)].isDir = sn.kind == NodeKind::Directory;
        req.nodes[size_t(i)].size = sn.radius;
        req.nodes[size_t(i)].order = i;
        if (warmStart)
            req.initial.push_back(scene->projectTarget(i));
    }
    for (const SceneEdge &e : scene->projectEdges())
        req.edges.push_back({ e.a, e.b, e.kind == EdgeKind::Containment, 1.f });
    m_layoutRunning = true;
    const quint64 ticket = ++m_layoutTicket;
    emit layoutChanged();
    QPointer<ProjectScene> self(this);
    QtConcurrent::run([req]() { return graph::computeLayout(req); }).then(this, [self, ticket](const graph::LayoutResult &res) {
        if (!self)
            return;
        self->m_layoutRunning = false;
        if (ticket == self->m_layoutTicket && self->m_viewport
            && int(res.positions.size()) == self->m_viewport->scene()->projectNodeCount()) {
            self->m_viewport->scene()->setProjectLayout(res.positions, 0.7f);
            if (self->m_needsFraming) {
                float maxR = 40.f;
                for (const QVector3D &p : res.positions) maxR = std::max(maxR, p.length());
                self->m_viewport->frameRadius(maxR, 2.2f);
                self->m_needsFraming = false;
            }
        }
        emit self->layoutChanged();
        if (self->m_layoutPending) {
            self->m_layoutPending = false;
            self->requestLayout(true);
        }
    });
}

void ProjectScene::applyGit()
{
    if (!m_viewport || !m_snap)
        return;
    VisualScene *scene = m_viewport->scene();
    const GitStatePtr st = m_git->state();
    for (size_t f = 0; f < m_fileToScene.size(); ++f)
        scene->setGitCode(m_fileToScene[f], GitCode::Clean);
    if (!st || !st->isRepo)
        return;
    // git paths are relative to the repository root, which may be above the project root
    QString prefix;
    if (!st->repoRoot.isEmpty() && st->repoRoot != m_snap->root) {
        const QString rel = QDir(st->repoRoot).relativeFilePath(m_snap->root);
        if (!rel.startsWith(QLatin1String("..")))
            prefix = rel + QLatin1Char('/');
    }
    for (const GitFileStatus &fs : st->files) {
        QString p = fs.path;
        if (!prefix.isEmpty()) {
            if (!p.startsWith(prefix)) continue;
            p = p.mid(prefix.size());
        }
        const int fi = m_snap->fileIndex(p);
        if (fi >= 0)
            scene->setGitCode(m_fileToScene[size_t(fi)], gitCodeFor(fs.change));
    }
}

QString ProjectScene::relativePath(const QString &absPath) const
{
    if (!m_snap || absPath.isEmpty())
        return {};
    QString p = QDir::cleanPath(absPath);
    if (QFileInfo(p).isRelative())
        p = QDir::cleanPath(m_snap->root + QLatin1Char('/') + p);
    const QString root = m_snap->root + QLatin1Char('/');
    if (p.startsWith(root))
        return p.mid(root.size());
    // symlinked or differently-cased roots: compare canonical paths
    const QString canon = QFileInfo(p).canonicalFilePath();
    if (!canon.isEmpty() && canon.startsWith(root))
        return canon.mid(root.size());
    return {};
}

int ProjectScene::sceneIndexForAbsolutePath(const QString &absPath) const
{
    const QString rel = relativePath(absPath);
    if (rel.isEmpty())
        return -1;
    const int f = m_snap->fileIndex(rel);
    if (f >= 0)
        return m_fileToScene[size_t(f)];
    return m_keyToScene.value(rel + QLatin1Char('/'), -1);
}

int ProjectScene::dirSceneIndexForAbsolutePath(const QString &absPath) const
{
    QString rel = relativePath(absPath);
    while (!rel.isEmpty()) {
        const int s = m_keyToScene.value(rel + QLatin1Char('/'), -1);
        if (s >= 0) return s;
        const int slash = int(rel.lastIndexOf(QLatin1Char('/')));
        rel = slash < 0 ? QString() : rel.left(slash);
    }
    return -1;
}

std::vector<int> ProjectScene::dependents(int sceneIndex, int maxCount) const
{
    std::vector<int> out;
    if (sceneIndex < 0 || sceneIndex >= int(m_sceneToFile.size())) return out;
    const int f = m_sceneToFile[size_t(sceneIndex)];
    if (f < 0) return out;
    for (int g : m_importedBy[size_t(f)]) {
        out.push_back(m_fileToScene[size_t(g)]);
        if (int(out.size()) >= maxCount) break;
    }
    return out;
}

std::vector<int> ProjectScene::dependencies(int sceneIndex, int maxCount) const
{
    std::vector<int> out;
    if (sceneIndex < 0 || sceneIndex >= int(m_sceneToFile.size())) return out;
    const int f = m_sceneToFile[size_t(sceneIndex)];
    if (f < 0) return out;
    for (int g : m_importsOf[size_t(f)]) {
        out.push_back(m_fileToScene[size_t(g)]);
        if (int(out.size()) >= maxCount) break;
    }
    return out;
}

QString ProjectScene::keyForGlobal(int globalIndex) const
{
    if (!m_viewport) return {};
    return m_viewport->nodeKey(globalIndex);
}

int ProjectScene::globalForKey(const QString &key) const
{
    if (!m_viewport) return -1;
    const int s = m_keyToScene.value(key, -1);
    return s < 0 ? -1 : m_viewport->scene()->globalForProject(s);
}

QVariantMap ProjectScene::nodeInfo(const QString &key) const
{
    QVariantMap m;
    if (!m_snap) return m;
    const int s = m_keyToScene.value(key, -1);
    if (s < 0) return m;
    const ProjectSnapshot &snap = *m_snap;
    m.insert(QStringLiteral("key"), key);
    const GitStatePtr st = m_git->state();
    if (m_sceneToDir[size_t(s)] >= 0) {
        const DirInfo &d = snap.dirs[size_t(m_sceneToDir[size_t(s)])];
        m.insert(QStringLiteral("type"), QStringLiteral("directory"));
        m.insert(QStringLiteral("name"), d.name);
        m.insert(QStringLiteral("path"), d.relPath);
        m.insert(QStringLiteral("absolutePath"), snap.root + QLatin1Char('/') + d.relPath);
        m.insert(QStringLiteral("files"), int(d.files.size()));
        m.insert(QStringLiteral("subdirs"), int(d.dirs.size()));
        m.insert(QStringLiteral("totalFiles"), d.totalFiles);
        int lines = 0, changed = 0;
        QVariantList children;
        for (int fi : d.files) {
            lines += snap.files[size_t(fi)].lines;
            if (children.size() < 40)
                children.append(QVariantMap{ { QStringLiteral("name"), snap.files[size_t(fi)].name },
                                             { QStringLiteral("key"), snap.files[size_t(fi)].relPath },
                                             { QStringLiteral("lines"), snap.files[size_t(fi)].lines } });
        }
        if (st)
            for (const GitFileStatus &fs : st->files)
                if (fs.path.startsWith(d.relPath + QLatin1Char('/'))) ++changed;
        m.insert(QStringLiteral("lines"), lines);
        m.insert(QStringLiteral("changed"), changed);
        m.insert(QStringLiteral("children"), children);
        return m;
    }
    const int fi = m_sceneToFile[size_t(s)];
    const FileInfo &f = snap.files[size_t(fi)];
    m.insert(QStringLiteral("type"), QStringLiteral("file"));
    m.insert(QStringLiteral("name"), f.name);
    m.insert(QStringLiteral("path"), f.relPath);
    m.insert(QStringLiteral("absolutePath"), snap.absolutePath(fi));
    m.insert(QStringLiteral("language"), f.language.isEmpty() ? QStringLiteral("—") : f.language);
    m.insert(QStringLiteral("category"), categoryName(f.category));
    m.insert(QStringLiteral("lines"), f.lines);
    m.insert(QStringLiteral("size"), f.size);
    m.insert(QStringLiteral("scanned"), f.scanned);
    QVariantList syms;
    for (const Symbol &sy : f.symbols) {
        if (syms.size() >= 80) break;
        syms.append(QVariantMap{ { QStringLiteral("name"), sy.name }, { QStringLiteral("kind"), symbolKindName(sy.kind) },
                                 { QStringLiteral("line"), sy.line } });
    }
    m.insert(QStringLiteral("symbols"), syms);
    m.insert(QStringLiteral("symbolCount"), int(f.symbols.size()));
    QVariantList imports, importedBy;
    for (int g : m_importsOf[size_t(fi)])
        imports.append(QVariantMap{ { QStringLiteral("key"), snap.files[size_t(g)].relPath }, { QStringLiteral("name"), snap.files[size_t(g)].name } });
    for (int g : m_importedBy[size_t(fi)])
        importedBy.append(QVariantMap{ { QStringLiteral("key"), snap.files[size_t(g)].relPath }, { QStringLiteral("name"), snap.files[size_t(g)].name } });
    m.insert(QStringLiteral("imports"), imports);
    m.insert(QStringLiteral("importedBy"), importedBy);
    int external = 0;
    for (const RawImport &ri : f.imports) if (!ri.local) ++external;
    m.insert(QStringLiteral("rawImports"), int(f.imports.size()));
    if (st && st->isRepo) {
        const int gi = st->byPath.value(f.relPath, -1);
        if (gi >= 0) {
            const GitFileStatus &fs = st->files[size_t(gi)];
            m.insert(QStringLiteral("git"), gitChangeName(fs.change));
            m.insert(QStringLiteral("gitAdded"), fs.added);
            m.insert(QStringLiteral("gitRemoved"), fs.removed);
            m.insert(QStringLiteral("gitStaged"), fs.staged);
        } else {
            m.insert(QStringLiteral("git"), QStringLiteral("clean"));
        }
    }
    return m;
}

QVariantList ProjectScene::topLevel() const
{
    QVariantList out;
    if (!m_snap) return out;
    const ProjectSnapshot &snap = *m_snap;
    for (int d : snap.dirs[0].dirs) {
        const DirInfo &di = snap.dirs[size_t(d)];
        out.append(QVariantMap{ { QStringLiteral("key"), di.relPath + QLatin1Char('/') }, { QStringLiteral("name"), di.name },
                                { QStringLiteral("files"), di.totalFiles }, { QStringLiteral("type"), QStringLiteral("directory") } });
    }
    std::sort(out.begin(), out.end(), [](const QVariant &a, const QVariant &b) {
        return a.toMap().value(QStringLiteral("files")).toInt() > b.toMap().value(QStringLiteral("files")).toInt();
    });
    for (int f : snap.dirs[0].files)
        out.append(QVariantMap{ { QStringLiteral("key"), snap.files[size_t(f)].relPath }, { QStringLiteral("name"), snap.files[size_t(f)].name },
                                { QStringLiteral("files"), 1 }, { QStringLiteral("type"), QStringLiteral("file") } });
    return out;
}

QVariantList ProjectScene::filesByCategory(const QString &category, int limit) const
{
    QVariantList out;
    if (!m_snap) return out;
    for (const FileInfo &f : m_snap->files) {
        if (categoryName(f.category) != category) continue;
        out.append(QVariantMap{ { QStringLiteral("key"), f.relPath }, { QStringLiteral("name"), f.name }, { QStringLiteral("lines"), f.lines },
                                { QStringLiteral("sections"), int(f.symbols.size()) }, { QStringLiteral("links"), int(m_importsOf.size() > 0 ? 0 : 0) } });
        if (out.size() >= limit) break;
    }
    return out;
}

void ProjectScene::focus(const QString &key)
{
    if (!m_viewport) return;
    VisualScene *scene = m_viewport->scene();
    const int s = m_keyToScene.value(key, -1);
    if (s < 0) { clearFocus(); return; }
    m_focusKey = key;
    scene->setAllDimmed(true);
    scene->setDimmed(s, false);
    scene->markPulse(s);
    // neighbourhood: imports, importers, parent and (for dirs) children
    std::vector<int> lit;
    for (int d : dependencies(s, 200)) lit.push_back(d);
    for (int d : dependents(s, 200)) lit.push_back(d);
    const SceneNode &n = scene->projectNode(s);
    if (n.parent >= 0) lit.push_back(n.parent);
    if (n.kind == NodeKind::Directory)
        for (int i = 0; i < scene->projectNodeCount(); ++i)
            if (scene->projectNode(i).parent == s) lit.push_back(i);
    float delay = 0.15f;
    for (int l : lit) {
        scene->setDimmed(l, false);
        scene->markPulse(l, delay);
        delay = std::min(delay + 0.05f, 1.2f);
    }
    scene->activateEdgesAround(s, 0.f, true, true);
    emit focusChanged();
}

void ProjectScene::clearFocus()
{
    if (!m_viewport) return;
    m_focusKey.clear();
    m_viewport->scene()->setAllDimmed(false);
    emit focusChanged();
}

QVariantList ProjectScene::search(const QString &query, int limit) const
{
    QVariantList out;
    if (!m_snap || query.trimmed().isEmpty()) return out;
    const QString q = query.trimmed().toLower();
    struct Hit { int score; QVariantMap m; };
    std::vector<Hit> hits;
    for (size_t f = 0; f < m_snap->files.size(); ++f) {
        const FileInfo &fi = m_snap->files[f];
        const QString name = fi.name.toLower();
        const QString path = fi.relPath.toLower();
        int score = -1;
        if (name == q) score = 100;
        else if (name.startsWith(q)) score = 80;
        else if (name.contains(q)) score = 60;
        else if (path.contains(q)) score = 40;
        if (score >= 0)
            hits.push_back({ score - int(path.size() / 20), { { QStringLiteral("key"), fi.relPath }, { QStringLiteral("title"), fi.name },
                                                              { QStringLiteral("detail"), fi.relPath }, { QStringLiteral("type"), QStringLiteral("file") } } });
        for (const Symbol &sy : fi.symbols) {
            const QString sn = sy.name.toLower();
            int ss = -1;
            if (sn == q) ss = 90;
            else if (sn.startsWith(q)) ss = 70;
            else if (sn.contains(q)) ss = 45;
            if (ss >= 0)
                hits.push_back({ ss, { { QStringLiteral("key"), fi.relPath }, { QStringLiteral("title"), sy.name },
                                       { QStringLiteral("detail"), symbolKindName(sy.kind) + QStringLiteral(" · ") + fi.relPath + QLatin1Char(':') + QString::number(sy.line) },
                                       { QStringLiteral("type"), QStringLiteral("symbol") }, { QStringLiteral("line"), sy.line } } });
        }
    }
    for (size_t d = 1; d < m_snap->dirs.size(); ++d) {
        const DirInfo &di = m_snap->dirs[d];
        if (di.relPath.toLower().contains(q))
            hits.push_back({ di.name.toLower() == q ? 95 : 50, { { QStringLiteral("key"), di.relPath + QLatin1Char('/') }, { QStringLiteral("title"), di.name + QLatin1Char('/') },
                                                                 { QStringLiteral("detail"), QString::number(di.totalFiles) + QStringLiteral(" files") }, { QStringLiteral("type"), QStringLiteral("directory") } } });
    }
    std::stable_sort(hits.begin(), hits.end(), [](const Hit &a, const Hit &b) { return a.score > b.score; });
    for (const Hit &h : hits) {
        out.append(h.m);
        if (out.size() >= limit) break;
    }
    return out;
}

void ProjectScene::setHeatValues(const QVariantMap &relPathToHeat)
{
    if (!m_viewport || !m_snap) return;
    VisualScene *scene = m_viewport->scene();
    for (auto it = relPathToHeat.cbegin(); it != relPathToHeat.cend(); ++it) {
        const int s = m_keyToScene.value(it.key(), -1);
        if (s >= 0) scene->setHeat(s, float(it.value().toDouble()));
    }
}

} // namespace nexus::app
