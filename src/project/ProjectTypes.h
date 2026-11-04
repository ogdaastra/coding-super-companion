#pragma once

#include <QHash>
#include <QString>
#include <QStringList>
#include <memory>
#include <vector>

namespace nexus::project {

enum class FileCategory { Source, Header, Test, Doc, Config, Build, Shader, Asset, Other };
enum class SymbolKind { Class, Struct, Function, Method, Enum, Interface, Namespace, Constant, Component, Section };

struct Symbol {
    QString name;
    SymbolKind kind = SymbolKind::Function;
    int line = 0;
};

// One raw import/include/reference as written in the source.
struct RawImport {
    QString spec;      // e.g. "render/Camera.h", "./util", "os.path", "crate::graph"
    bool local = true; // quoted include / relative path vs. system/package import
    int line = 0;
};

struct FileInfo {
    QString relPath;   // '/'-separated, relative to the project root
    QString name;
    QString ext;       // lower-case, without dot
    QString language;  // "C++", "Python", ...
    FileCategory category = FileCategory::Other;
    qint64 size = 0;
    int lines = 0;
    int dir = -1;      // index into ProjectSnapshot::dirs
    bool scanned = false;
    std::vector<Symbol> symbols;
    std::vector<RawImport> imports;
};

struct DirInfo {
    QString relPath;   // "" for the root
    QString name;
    int parent = -1;
    int depth = 0;
    std::vector<int> files;
    std::vector<int> dirs;
    int totalFiles = 0;  // recursive
};

struct DepEdge {
    int from = -1;     // file index (importer)
    int to = -1;       // file index (imported)
    int line = 0;
};

struct ProjectSnapshot {
    QString root;      // absolute path
    QString name;
    bool isGitRepo = false;
    bool truncated = false;
    qint64 indexMs = 0;
    std::vector<FileInfo> files;
    std::vector<DirInfo> dirs;   // dirs[0] is the root
    std::vector<DepEdge> deps;
    QHash<QString, int> fileByPath;
    QHash<QString, int> languageCounts;
    int unresolvedImports = 0;
    int externalImports = 0;
    quint64 generation = 0;

    int fileIndex(const QString &relPath) const { return fileByPath.value(relPath, -1); }
    QString absolutePath(int file) const { return root + QLatin1Char('/') + files[size_t(file)].relPath; }
};

using ProjectSnapshotPtr = std::shared_ptr<const ProjectSnapshot>;

QString categoryName(FileCategory c);
QString symbolKindName(SymbolKind k);

} // namespace nexus::project
