#include "ProjectIndexer.h"
#include "SourceScanner.h"

#include <QDir>
#include <QDirIterator>
#include <QElapsedTimer>
#include <QFile>
#include <QFileInfo>
#include <QProcess>
#include <QSet>
#include <QStringDecoder>
#include <QtConcurrent/QtConcurrentMap>
#include <algorithm>

namespace nexus::project {

namespace {

const QSet<QString> &ignoredDirs()
{
    static const QSet<QString> s = { ".git", ".hg", ".svn", "node_modules", "build", "dist", "out", "target", ".cache",
                                     "__pycache__", ".venv", "venv", ".idea", ".vscode", ".gradle", "bin", "obj",
                                     ".next", ".nuxt", "coverage", ".tox", ".mypy_cache", ".pytest_cache", "vendor",
                                     "Pods", "DerivedData", ".terraform", "cmake-build-debug", "cmake-build-release" };
    return s;
}

QString normalizePath(const QString &p)
{
    // collapse "a/./b", "a/x/../b" without touching the filesystem
    QStringList out;
    for (const QString &part : p.split(QLatin1Char('/'), Qt::SkipEmptyParts)) {
        if (part == QLatin1String("."))
            continue;
        if (part == QLatin1String("..")) {
            if (!out.isEmpty())
                out.removeLast();
            else
                return {};  // escapes the project root
            continue;
        }
        out.append(part);
    }
    return out.join(QLatin1Char('/'));
}

QString dirOf(const QString &rel)
{
    const int slash = int(rel.lastIndexOf(QLatin1Char('/')));
    return slash < 0 ? QString() : rel.left(slash);
}

QString joinRel(const QString &dir, const QString &rel)
{
    return normalizePath(dir.isEmpty() ? rel : dir + QLatin1Char('/') + rel);
}

} // namespace

QStringList ProjectIndexer::enumerate(const QString &root, const IndexOptions &options, bool *isGit, bool *truncated)
{
    QStringList files;
    *isGit = false;
    *truncated = false;
    if (options.useGit) {
        QProcess git;
        git.setWorkingDirectory(root);
        git.start(QStringLiteral("git"), { QStringLiteral("rev-parse"), QStringLiteral("--is-inside-work-tree") });
        if (git.waitForFinished(5000) && git.exitCode() == 0 && git.readAllStandardOutput().trimmed() == "true") {
            QProcess ls;
            ls.setWorkingDirectory(root);
            ls.start(QStringLiteral("git"), { QStringLiteral("ls-files"), QStringLiteral("-z"), QStringLiteral("--cached"),
                                              QStringLiteral("--others"), QStringLiteral("--exclude-standard"),
                                              QStringLiteral("--deduplicate") });
            if (ls.waitForFinished(30000) && ls.exitCode() == 0) {
                *isGit = true;
                const QByteArray out = ls.readAllStandardOutput();
                for (const QByteArray &f : out.split('\0')) {
                    if (f.isEmpty())
                        continue;
                    const QString path = QString::fromUtf8(f);
                    // tracked files that were deleted on disk are still listed by --cached
                    if (!QFileInfo::exists(root + QLatin1Char('/') + path))
                        continue;
                    files.append(path);
                    if (files.size() >= options.maxFiles) { *truncated = true; break; }
                }
            }
        }
    }
    if (!*isGit) {
        const QDir rootDir(root);
        QDirIterator it(root, QDir::Files | QDir::NoDotAndDotDot | QDir::Hidden, QDirIterator::Subdirectories);
        while (it.hasNext()) {
            const QString abs = it.next();
            const QString rel = rootDir.relativeFilePath(abs);
            bool skip = false;
            for (const QString &part : rel.split(QLatin1Char('/'))) {
                if (ignoredDirs().contains(part)) { skip = true; break; }
            }
            if (skip)
                continue;
            files.append(rel);
            if (files.size() >= options.maxFiles) { *truncated = true; break; }
        }
    }
    std::sort(files.begin(), files.end());
    return files;
}

ProjectSnapshot ProjectIndexer::index(const QString &rootIn, const IndexOptions &options, const std::atomic_bool *cancel,
                                      const Progress &progress)
{
    QElapsedTimer timer;
    timer.start();
    ProjectSnapshot snap;
    snap.root = QDir(rootIn).canonicalPath();
    if (snap.root.isEmpty())
        snap.root = QDir::cleanPath(rootIn);
    snap.name = QFileInfo(snap.root).fileName();

    const QStringList paths = enumerate(snap.root, options, &snap.isGitRepo, &snap.truncated);

    // Directory tree
    snap.dirs.push_back(DirInfo{ QString(), snap.name, -1, 0, {}, {}, 0 });
    QHash<QString, int> dirIndex;
    dirIndex.insert(QString(), 0);
    auto ensureDir = [&](const QString &rel, auto &&self) -> int {
        auto it = dirIndex.constFind(rel);
        if (it != dirIndex.constEnd())
            return *it;
        const QString parentRel = dirOf(rel);
        const int parent = self(parentRel, self);
        DirInfo d;
        d.relPath = rel;
        d.name = rel.section(QLatin1Char('/'), -1);
        d.parent = parent;
        d.depth = snap.dirs[size_t(parent)].depth + 1;
        snap.dirs.push_back(d);
        const int idx = int(snap.dirs.size()) - 1;
        snap.dirs[size_t(parent)].dirs.push_back(idx);
        dirIndex.insert(rel, idx);
        return idx;
    };

    snap.files.reserve(size_t(paths.size()));
    for (const QString &p : paths) {
        FileInfo f;
        f.relPath = p;
        f.name = p.section(QLatin1Char('/'), -1);
        const int dot = int(f.name.lastIndexOf(QLatin1Char('.')));
        f.ext = dot > 0 ? f.name.mid(dot + 1).toLower() : QString();
        f.language = SourceScanner::languageFor(f.name, f.ext);
        f.category = SourceScanner::categoryFor(p, f.name, f.ext);
        f.dir = ensureDir(dirOf(p), ensureDir);
        snap.dirs[size_t(f.dir)].files.push_back(int(snap.files.size()));
        snap.fileByPath.insert(p, int(snap.files.size()));
        snap.files.push_back(std::move(f));
    }

    // Recursive file counts
    for (int d = int(snap.dirs.size()) - 1; d >= 0; --d) {
        DirInfo &di = snap.dirs[size_t(d)];
        di.totalFiles += int(di.files.size());
        if (di.parent >= 0)
            snap.dirs[size_t(di.parent)].totalFiles += di.totalFiles;
    }

    // Scan sources in parallel
    std::atomic_int done{ 0 };
    const int total = int(snap.files.size());
    const QString root = snap.root;
    const qint64 maxBytes = options.maxScanBytes;
    QtConcurrent::blockingMap(snap.files, [&](FileInfo &f) {
        if (cancel && cancel->load())
            return;
        QFile file(root + QLatin1Char('/') + f.relPath);
        f.size = file.size();
        if (f.category != FileCategory::Asset && f.size <= maxBytes && file.open(QIODevice::ReadOnly)) {
            const QByteArray bytes = file.readAll();
            // skip binary content
            if (!bytes.left(4096).contains('\0')) {
                const QString text = QString::fromUtf8(bytes);
                if (SourceScanner::isScannable(f.language)) {
                    SourceScanner::Result r = SourceScanner::scan(text, f.language);
                    f.lines = r.lines;
                    f.symbols = std::move(r.symbols);
                    f.imports = std::move(r.imports);
                    f.scanned = true;
                } else {
                    f.lines = int(text.count(QLatin1Char('\n'))) + (text.isEmpty() ? 0 : 1);
                }
            }
        }
        const int n = ++done;
        if (progress && (n % 200 == 0 || n == total))
            progress(n, total);
    });

    for (const FileInfo &f : snap.files)
        if (!f.language.isEmpty())
            snap.languageCounts[f.language] += 1;

    resolveImports(snap);
    snap.indexMs = timer.elapsed();
    return snap;
}

void ProjectIndexer::resolveImports(ProjectSnapshot &snap)
{
    snap.deps.clear();
    snap.unresolvedImports = 0;
    snap.externalImports = 0;

    // basename → files, and path-suffix lookup support
    QHash<QString, QList<int>> byName;
    QHash<QString, QList<int>> byStem;   // name without extension (QML components, Python modules)
    for (size_t i = 0; i < snap.files.size(); ++i) {
        byName[snap.files[i].name].append(int(i));
        const QString stem = snap.files[i].name.section(QLatin1Char('.'), 0, 0);
        byStem[stem].append(int(i));
    }
    auto exists = [&](const QString &rel) { return snap.fileByPath.value(rel, -1); };
    auto bySuffix = [&](const QString &spec, int from) -> int {
        const QString name = spec.section(QLatin1Char('/'), -1);
        const QList<int> cands = byName.value(name);
        int best = -1;
        int bestScore = -1;
        const QString fromTop = snap.files[size_t(from)].relPath.section(QLatin1Char('/'), 0, 0);
        for (int c : cands) {
            const QString &rp = snap.files[size_t(c)].relPath;
            if (rp == spec || rp.endsWith(QLatin1Char('/') + spec)) {
                int score = 10;
                if (rp.section(QLatin1Char('/'), 0, 0) == fromTop) score += 5;
                if (dirOf(rp) == dirOf(snap.files[size_t(from)].relPath)) score += 3;
                if (score > bestScore) { bestScore = score; best = c; }
            }
        }
        return best;
    };

    // go.mod module path, if any
    QString goModule;
    if (int gm = exists(QStringLiteral("go.mod")); gm >= 0) {
        QFile f(snap.absolutePath(gm));
        if (f.open(QIODevice::ReadOnly)) {
            for (const QByteArray &line : f.readAll().split('\n')) {
                if (line.startsWith("module ")) { goModule = QString::fromUtf8(line.mid(7).trimmed()); break; }
            }
        }
    }

    QSet<quint64> seen;
    auto addEdge = [&](int from, int to, int line) {
        if (to < 0 || to == from)
            return;
        const quint64 key = (quint64(quint32(from)) << 32) | quint32(to);
        if (seen.contains(key))
            return;
        seen.insert(key);
        snap.deps.push_back({ from, to, line });
    };

    for (size_t fi = 0; fi < snap.files.size(); ++fi) {
        const FileInfo &f = snap.files[fi];
        const int from = int(fi);
        const QString dir = dirOf(f.relPath);
        for (const RawImport &imp : f.imports) {
            int to = -1;
            const QString &lang = f.language;
            if (lang == QLatin1String("C") || lang == QLatin1String("C++") || lang == QLatin1String("Objective-C")
                || lang == QLatin1String("GLSL") || lang == QLatin1String("HLSL")) {
                to = exists(joinRel(dir, imp.spec));
                if (to < 0) to = exists(normalizePath(imp.spec));
                for (const char *prefix : { "src/", "include/", "lib/" })
                    if (to < 0) to = exists(normalizePath(QLatin1String(prefix) + imp.spec));
                if (to < 0 && (imp.local || imp.spec.contains(QLatin1Char('/'))))
                    to = bySuffix(imp.spec, from);
                if (to < 0 && !imp.local && byName.value(imp.spec).size() == 1)
                    to = byName.value(imp.spec).first();
            } else if (lang == QLatin1String("Python")) {
                QString spec = imp.spec;
                QString base = dir;
                int dots = 0;
                while (dots < spec.size() && spec[dots] == QLatin1Char('.')) ++dots;
                QString modPath = spec.mid(dots).replace(QLatin1Char('.'), QLatin1Char('/'));
                if (dots > 0) {
                    for (int k = 1; k < dots; ++k) base = dirOf(base);
                    const QString p = joinRel(base, modPath);
                    to = exists(p + QStringLiteral(".py"));
                    if (to < 0) to = exists(joinRel(p, QStringLiteral("__init__.py")));
                } else {
                    for (const QString &prefix : { QString(), QStringLiteral("src/"), dir.isEmpty() ? QString() : dir + QLatin1Char('/') }) {
                        if (to >= 0) break;
                        to = exists(prefix + modPath + QStringLiteral(".py"));
                        if (to < 0) to = exists(prefix + modPath + QStringLiteral("/__init__.py"));
                    }
                    if (to < 0 && modPath.contains(QLatin1Char('/')))
                        to = bySuffix(modPath + QStringLiteral(".py"), from);
                }
            } else if (lang == QLatin1String("JavaScript") || lang == QLatin1String("TypeScript")) {
                if (imp.local) {
                    const QString p = joinRel(dir, imp.spec);
                    static const QStringList exts = { "", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".d.ts", ".json", ".vue", ".svelte" };
                    for (const QString &e : exts) { if ((to = exists(p + e)) >= 0) break; }
                    if (to < 0) {
                        for (const QString &e : exts) {
                            if (e.isEmpty()) continue;
                            if ((to = exists(p + QStringLiteral("/index") + e)) >= 0) break;
                        }
                    }
                }
            } else if (lang == QLatin1String("Go")) {
                if (!goModule.isEmpty() && imp.spec.startsWith(goModule)) {
                    const QString pkgDir = normalizePath(imp.spec.mid(goModule.size()));
                    int count = 0;
                    for (size_t c = 0; c < snap.files.size() && count < 6; ++c) {
                        const FileInfo &cand = snap.files[c];
                        if (cand.ext == QLatin1String("go") && dirOf(cand.relPath) == pkgDir && cand.category != FileCategory::Test) {
                            addEdge(from, int(c), imp.line);
                            ++count;
                        }
                    }
                    if (count > 0) continue;
                }
            } else if (lang == QLatin1String("Rust")) {
                if (imp.spec.startsWith(QLatin1String("mod:"))) {
                    const QString m = imp.spec.mid(4);
                    QString modDir = dir;
                    const QString stem = f.name.section(QLatin1Char('.'), 0, 0);
                    if (stem != QLatin1String("mod") && stem != QLatin1String("lib") && stem != QLatin1String("main"))
                        modDir = joinRel(dir, stem);
                    to = exists(joinRel(modDir, m + QStringLiteral(".rs")));
                    if (to < 0) to = exists(joinRel(modDir, m + QStringLiteral("/mod.rs")));
                } else if (imp.spec.startsWith(QLatin1String("crate::"))) {
                    QStringList parts = imp.spec.mid(7).split(QStringLiteral("::"));
                    while (!parts.isEmpty() && to < 0) {
                        const QString p = QStringLiteral("src/") + parts.join(QLatin1Char('/'));
                        to = exists(p + QStringLiteral(".rs"));
                        if (to < 0) to = exists(p + QStringLiteral("/mod.rs"));
                        parts.removeLast();
                    }
                }
            } else if (lang == QLatin1String("Java") || lang == QLatin1String("Kotlin") || lang == QLatin1String("Scala")) {
                const QString p = QString(imp.spec).replace(QLatin1Char('.'), QLatin1Char('/'));
                for (const char *e : { ".java", ".kt", ".scala" }) {
                    if ((to = bySuffix(p + QLatin1String(e), from)) >= 0) break;
                }
            } else if (lang == QLatin1String("QML")) {
                if (imp.spec.startsWith(QLatin1String("type:"))) {
                    const QList<int> cands = byStem.value(imp.spec.mid(5));
                    for (int c : cands) {
                        if (snap.files[size_t(c)].ext == QLatin1String("qml")) {
                            if (to < 0 || dirOf(snap.files[size_t(c)].relPath) == dir) to = c;
                        }
                    }
                    if (to < 0) continue;  // built-in QML type, not a dependency
                } else {
                    continue;  // directory imports carry no file-level edge
                }
            } else if (lang == QLatin1String("CMake")) {
                if (imp.spec.startsWith(QLatin1String("subdir:")))
                    to = exists(joinRel(joinRel(dir, imp.spec.mid(7)), QStringLiteral("CMakeLists.txt")));
                else
                    to = exists(joinRel(dir, imp.spec));
                if (to < 0) to = bySuffix(imp.spec.section(QLatin1Char(':'), -1), from);
            } else if (lang == QLatin1String("Markdown")) {
                to = exists(joinRel(dir, imp.spec));
                if (to < 0) to = exists(normalizePath(imp.spec));
            }

            if (to >= 0)
                addEdge(from, to, imp.line);
            else if (imp.local)
                ++snap.unresolvedImports;
            else
                ++snap.externalImports;
        }
    }
}

} // namespace nexus::project
