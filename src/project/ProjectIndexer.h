#pragma once

#include "ProjectTypes.h"

#include <QString>
#include <atomic>
#include <functional>

namespace nexus::project {

struct IndexOptions {
    int maxFiles = 15000;
    qint64 maxScanBytes = 1536 * 1024;   // larger files are listed but not scanned
    bool useGit = true;
};

// Synchronous indexer — always call from a worker thread. Enumerates files (git-aware),
// scans sources, resolves imports to project files and builds the directory tree.
class ProjectIndexer
{
public:
    using Progress = std::function<void(int done, int total)>;

    static ProjectSnapshot index(const QString &root, const IndexOptions &options = {},
                                 const std::atomic_bool *cancel = nullptr, const Progress &progress = {});

    // Exposed for tests: resolve the raw imports of every file in `snap`.
    static void resolveImports(ProjectSnapshot &snap);
    static QStringList enumerate(const QString &root, const IndexOptions &options, bool *isGit, bool *truncated);
};

} // namespace nexus::project
