#pragma once

#include "ProjectTypes.h"

#include <QString>
#include <QStringView>

namespace nexus::project {

// Lightweight structural scanner. Extracts imports/includes/references and top-level
// symbols with per-language lexical rules (comments and strings are skipped where it
// matters). It is deliberately conservative: it prefers missing a symbol to inventing
// one. A tree-sitter or LSP analyser can replace it per language behind this interface.
class SourceScanner
{
public:
    struct Result {
        std::vector<Symbol> symbols;
        std::vector<RawImport> imports;
        int lines = 0;
    };

    static QString languageFor(const QString &fileName, const QString &ext);
    static FileCategory categoryFor(const QString &relPath, const QString &fileName, const QString &ext);
    static bool isScannable(const QString &language);

    static Result scan(QStringView text, const QString &language);
};

} // namespace nexus::project
