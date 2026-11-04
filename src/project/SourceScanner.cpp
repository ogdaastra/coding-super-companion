#include "SourceScanner.h"

#include <QRegularExpression>
#include <QSet>

namespace nexus::project {

QString categoryName(FileCategory c)
{
    switch (c) {
    case FileCategory::Source: return QStringLiteral("source");
    case FileCategory::Header: return QStringLiteral("header");
    case FileCategory::Test: return QStringLiteral("test");
    case FileCategory::Doc: return QStringLiteral("documentation");
    case FileCategory::Config: return QStringLiteral("configuration");
    case FileCategory::Build: return QStringLiteral("build");
    case FileCategory::Shader: return QStringLiteral("shader");
    case FileCategory::Asset: return QStringLiteral("asset");
    default: return QStringLiteral("other");
    }
}

QString symbolKindName(SymbolKind k)
{
    switch (k) {
    case SymbolKind::Class: return QStringLiteral("class");
    case SymbolKind::Struct: return QStringLiteral("struct");
    case SymbolKind::Function: return QStringLiteral("function");
    case SymbolKind::Method: return QStringLiteral("method");
    case SymbolKind::Enum: return QStringLiteral("enum");
    case SymbolKind::Interface: return QStringLiteral("interface");
    case SymbolKind::Namespace: return QStringLiteral("namespace");
    case SymbolKind::Constant: return QStringLiteral("constant");
    case SymbolKind::Component: return QStringLiteral("component");
    case SymbolKind::Section: return QStringLiteral("section");
    }
    return {};
}

QString SourceScanner::languageFor(const QString &fileName, const QString &ext)
{
    static const QHash<QString, QString> byExt = {
        { "c", "C" }, { "h", "C++" }, { "cc", "C++" }, { "cpp", "C++" }, { "cxx", "C++" }, { "hh", "C++" },
        { "hpp", "C++" }, { "hxx", "C++" }, { "inl", "C++" }, { "ipp", "C++" }, { "m", "Objective-C" }, { "mm", "Objective-C" },
        { "py", "Python" }, { "pyi", "Python" },
        { "js", "JavaScript" }, { "jsx", "JavaScript" }, { "mjs", "JavaScript" }, { "cjs", "JavaScript" },
        { "ts", "TypeScript" }, { "tsx", "TypeScript" }, { "mts", "TypeScript" }, { "cts", "TypeScript" },
        { "go", "Go" }, { "rs", "Rust" }, { "java", "Java" }, { "kt", "Kotlin" }, { "kts", "Kotlin" },
        { "cs", "C#" }, { "scala", "Scala" }, { "swift", "Swift" }, { "rb", "Ruby" }, { "php", "PHP" },
        { "qml", "QML" }, { "vert", "GLSL" }, { "frag", "GLSL" }, { "comp", "GLSL" }, { "glsl", "GLSL" },
        { "geom", "GLSL" }, { "tesc", "GLSL" }, { "tese", "GLSL" }, { "hlsl", "HLSL" }, { "metal", "Metal" },
        { "cmake", "CMake" }, { "md", "Markdown" }, { "markdown", "Markdown" }, { "rst", "reStructuredText" },
        { "sh", "Shell" }, { "bash", "Shell" }, { "zsh", "Shell" }, { "ps1", "PowerShell" },
        { "json", "JSON" }, { "yaml", "YAML" }, { "yml", "YAML" }, { "toml", "TOML" }, { "xml", "XML" },
        { "html", "HTML" }, { "css", "CSS" }, { "scss", "SCSS" }, { "sql", "SQL" }, { "lua", "Lua" },
        { "dart", "Dart" }, { "ex", "Elixir" }, { "exs", "Elixir" }, { "zig", "Zig" },
    };
    if (fileName == QLatin1String("CMakeLists.txt"))
        return QStringLiteral("CMake");
    if (fileName == QLatin1String("Makefile") || fileName == QLatin1String("GNUmakefile"))
        return QStringLiteral("Make");
    if (fileName == QLatin1String("Dockerfile"))
        return QStringLiteral("Docker");
    return byExt.value(ext);
}

bool SourceScanner::isScannable(const QString &language)
{
    static const QSet<QString> langs = { "C", "C++", "Objective-C", "Python", "JavaScript", "TypeScript", "Go", "Rust",
                                         "Java", "Kotlin", "C#", "Scala", "QML", "GLSL", "HLSL", "CMake", "Markdown", "Swift" };
    return langs.contains(language);
}

FileCategory SourceScanner::categoryFor(const QString &relPath, const QString &fileName, const QString &ext)
{
    static const QSet<QString> assets = { "png", "jpg", "jpeg", "gif", "svg", "ico", "icns", "webp", "bmp", "tga", "psd",
                                          "ttf", "otf", "woff", "woff2", "mp3", "wav", "ogg", "mp4", "mov", "webm",
                                          "zip", "gz", "tar", "7z", "pdf", "bin", "dll", "so", "dylib", "a", "lib", "exe",
                                          "o", "obj", "class", "jar", "wasm", "qsb", "spv", "db", "sqlite" };
    static const QSet<QString> docs = { "md", "markdown", "rst", "txt", "adoc", "org" };
    static const QSet<QString> config = { "json", "yaml", "yml", "toml", "ini", "cfg", "conf", "xml", "plist", "properties",
                                          "editorconfig", "env", "lock" };
    static const QSet<QString> shaders = { "vert", "frag", "comp", "glsl", "geom", "tesc", "tese", "hlsl", "metal", "wgsl" };
    static const QSet<QString> headers = { "h", "hh", "hpp", "hxx", "inl", "ipp" };
    static const QSet<QString> build = { "CMakeLists.txt", "Makefile", "GNUmakefile", "meson.build", "BUILD", "BUILD.bazel",
                                         "WORKSPACE", "build.gradle", "pom.xml", "Cargo.toml", "go.mod", "package.json",
                                         "pyproject.toml", "setup.py", "setup.cfg", "Dockerfile", "Gemfile", "build.rs" };

    if (assets.contains(ext))
        return FileCategory::Asset;
    if (build.contains(fileName) || ext == QLatin1String("cmake") || ext == QLatin1String("gradle"))
        return FileCategory::Build;
    const QString lower = relPath.toLower();
    const QString lowerName = fileName.toLower();
    const bool testPath = lower.startsWith(QLatin1String("test/")) || lower.startsWith(QLatin1String("tests/"))
        || lower.contains(QLatin1String("/test/")) || lower.contains(QLatin1String("/tests/"))
        || lower.contains(QLatin1String("__tests__/")) || lower.contains(QLatin1String("/spec/"));
    const bool testName = lowerName.startsWith(QLatin1String("test_")) || lowerName.startsWith(QLatin1String("tst_"))
        || lowerName.contains(QLatin1String("_test.")) || lowerName.contains(QLatin1String(".test."))
        || lowerName.contains(QLatin1String(".spec.")) || lowerName.contains(QLatin1String("_spec."))
        || (fileName.size() > 9 && fileName.contains(QLatin1String("Test.")));
    if (docs.contains(ext))
        return FileCategory::Doc;
    if (shaders.contains(ext))
        return FileCategory::Shader;
    if (testPath || testName)
        return FileCategory::Test;
    if (config.contains(ext) || fileName.startsWith(QLatin1Char('.')))
        return FileCategory::Config;
    if (headers.contains(ext))
        return FileCategory::Header;
    if (!languageFor(fileName, ext).isEmpty())
        return FileCategory::Source;
    return FileCategory::Other;
}

namespace {

// Removes /* */ and // comments and string contents (keeping quotes) for C-like
// languages, preserving line structure so line numbers stay correct.
QString stripCLike(QStringView text, bool keepIncludeStrings)
{
    QString out;
    out.reserve(text.size());
    enum { Code, Line, Block, Str, Chr } st = Code;
    bool lineStartsWithHash = false;
    bool atLineStart = true;
    for (qsizetype i = 0; i < text.size(); ++i) {
        const QChar c = text[i];
        const QChar n = i + 1 < text.size() ? text[i + 1] : QChar();
        if (c == QLatin1Char('\n')) {
            if (st == Line) st = Code;
            if (st == Str || st == Chr) st = Code;  // unterminated
            out += c;
            atLineStart = true;
            lineStartsWithHash = false;
            continue;
        }
        if (atLineStart && !c.isSpace()) {
            lineStartsWithHash = (c == QLatin1Char('#'));
            atLineStart = false;
        }
        switch (st) {
        case Code:
            if (c == QLatin1Char('/') && n == QLatin1Char('/')) { st = Line; ++i; out += QStringLiteral("  "); }
            else if (c == QLatin1Char('/') && n == QLatin1Char('*')) { st = Block; ++i; out += QStringLiteral("  "); }
            else if (c == QLatin1Char('"')) { st = Str; out += c; }
            else if (c == QLatin1Char('\'')) { st = Chr; out += c; }
            else out += c;
            break;
        case Line: out += QLatin1Char(' '); break;
        case Block:
            if (c == QLatin1Char('*') && n == QLatin1Char('/')) { st = Code; ++i; out += QStringLiteral("  "); }
            else out += QLatin1Char(' ');
            break;
        case Str:
            if (c == QLatin1Char('\\')) { out += QStringLiteral("  "); ++i; break; }
            if (c == QLatin1Char('"')) { st = Code; out += c; break; }
            out += (keepIncludeStrings && lineStartsWithHash) ? c : QChar(QLatin1Char('x'));
            break;
        case Chr:
            if (c == QLatin1Char('\\')) { out += QStringLiteral("  "); ++i; break; }
            if (c == QLatin1Char('\'')) { st = Code; out += c; break; }
            out += QLatin1Char('x');
            break;
        }
    }
    return out;
}

bool isControlKeyword(const QString &w)
{
    static const QSet<QString> kw = { "if", "for", "while", "switch", "return", "else", "do", "catch", "sizeof",
                                      "delete", "new", "throw", "case", "using", "typedef", "static_assert",
                                      "decltype", "alignof", "defined", "Q_PROPERTY", "Q_OBJECT", "emit", "foreach",
                                      "Q_FOREACH", "Q_EMIT", "QStringLiteral", "QLatin1String" };
    return kw.contains(w);
}

void scanCpp(const QString &code, SourceScanner::Result &r, bool glsl)
{
    static const QRegularExpression include(QStringLiteral(R"re(^\s*#\s*include\s*([<"])([^>"]+)[>"])re"));
    static const QRegularExpression classRe(QStringLiteral(R"re(^\s*(?:template\s*<.*>\s*)?(class|struct)\s+(?:[A-Z_][A-Z0-9_]*\s+)?([A-Za-z_]\w*)\s*(?:final\s*)?(?::[^;]*)?(\{.*)?$)re"));
    static const QRegularExpression nsRe(QStringLiteral(R"re(^\s*namespace\s+([A-Za-z_][\w:]*)\s*\{)re"));
    static const QRegularExpression enumRe(QStringLiteral(R"re(^\s*enum\s+(?:class\s+|struct\s+)?([A-Za-z_]\w*)\s*(?::\s*\w+\s*)?(\{.*)?$)re"));
    static const QRegularExpression funcRe(QStringLiteral(R"re(^\s*(?:[\w:<>,\*&~\s]+?[\s\*&])?([A-Za-z_~][\w]*(?:::[A-Za-z_~][\w]*)*)\s*\([^;]*\)\s*(?:const|override|noexcept|final|volatile|&|\s|->\s*[\w:<>\*&]+)*(?::.*)?(\{.*)?$)re"));

    const QStringList lines = code.split(QLatin1Char('\n'));
    r.lines = int(lines.size());
    int depth = 0;
    for (int i = 0; i < lines.size(); ++i) {
        const QString &line = lines[i];
        const QString trimmed = line.trimmed();
        if (trimmed.startsWith(QLatin1Char('#'))) {
            const auto m = include.match(line);
            if (m.hasMatch())
                r.imports.push_back({ m.captured(2).trimmed(), m.captured(1) == QLatin1String("\""), i + 1 });
            continue;
        }
        const int depthAtStart = depth;
        for (QChar c : line) {
            if (c == QLatin1Char('{')) ++depth;
            else if (c == QLatin1Char('}')) depth = std::max(0, depth - 1);
        }
        if (trimmed.isEmpty() || trimmed.endsWith(QLatin1Char(';')) && !trimmed.contains(QLatin1Char('{')))
            continue;
        if (depthAtStart > 3)
            continue;
        if (auto m = nsRe.match(line); m.hasMatch()) {
            r.symbols.push_back({ m.captured(1), SymbolKind::Namespace, i + 1 });
            continue;
        }
        if (auto m = enumRe.match(line); m.hasMatch()) {
            r.symbols.push_back({ m.captured(1), SymbolKind::Enum, i + 1 });
            continue;
        }
        if (auto m = classRe.match(line); m.hasMatch()) {
            const bool opens = !m.captured(3).isEmpty() || (i + 1 < lines.size() && lines[i + 1].trimmed().startsWith(QLatin1Char('{')));
            if (opens || line.contains(QLatin1Char(':')))
                r.symbols.push_back({ m.captured(2), m.captured(1) == QLatin1String("struct") ? SymbolKind::Struct : SymbolKind::Class, i + 1 });
            continue;
        }
        if (depthAtStart <= (glsl ? 0 : 2)) {
            if (auto m = funcRe.match(line); m.hasMatch()) {
                QString name = m.captured(1);
                const QString leaf = name.section(QStringLiteral("::"), -1);
                if (isControlKeyword(leaf) || leaf.isEmpty())
                    continue;
                const bool opens = !m.captured(2).isEmpty()
                    || (i + 1 < lines.size() && (lines[i + 1].trimmed().startsWith(QLatin1Char('{'))
                                                 || lines[i + 1].trimmed().startsWith(QLatin1Char(':'))));
                if (!opens)
                    continue;
                // reject things that look like macro invocations or calls inside expressions
                if (trimmed.startsWith(QLatin1Char('(')) || trimmed.startsWith(QLatin1String("return")))
                    continue;
                r.symbols.push_back({ name, name.contains(QStringLiteral("::")) ? SymbolKind::Method : SymbolKind::Function, i + 1 });
            }
        }
    }
}

void scanPython(QStringView text, SourceScanner::Result &r)
{
    static const QRegularExpression importRe(QStringLiteral(R"re(^\s*import\s+([\w\.]+(?:\s*,\s*[\w\.]+)*))re"));
    static const QRegularExpression fromRe(QStringLiteral(R"re(^\s*from\s+(\.*[\w\.]*)\s+import\s+(.+))re"));
    static const QRegularExpression defRe(QStringLiteral(R"re(^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*))re"));
    static const QRegularExpression classRe(QStringLiteral(R"re(^(\s*)class\s+([A-Za-z_]\w*))re"));
    const QStringList lines = text.toString().split(QLatin1Char('\n'));
    r.lines = int(lines.size());
    bool inDoc = false;
    for (int i = 0; i < lines.size(); ++i) {
        const QString &line = lines[i];
        const int quotes = int(line.count(QStringLiteral("\"\"\"")) + line.count(QStringLiteral("'''")));
        if (inDoc) {
            if (quotes % 2 == 1) inDoc = false;
            continue;
        }
        if (quotes % 2 == 1) { inDoc = true; continue; }
        if (auto m = fromRe.match(line); m.hasMatch()) {
            const QString mod = m.captured(1);
            if (mod.startsWith(QLatin1Char('.')) && mod.count(QLatin1Char('.')) == mod.size()) {
                // "from . import a, b" → each name is a sibling module
                for (QString n : m.captured(2).split(QLatin1Char(','))) {
                    n = n.trimmed().section(QLatin1Char(' '), 0, 0).remove(QLatin1Char('(')).remove(QLatin1Char(')'));
                    if (!n.isEmpty() && n != QLatin1String("*"))
                        r.imports.push_back({ mod + n, true, i + 1 });
                }
            } else {
                r.imports.push_back({ mod, mod.startsWith(QLatin1Char('.')), i + 1 });
            }
            continue;
        }
        if (auto m = importRe.match(line); m.hasMatch()) {
            for (const QString &mod : m.captured(1).split(QLatin1Char(',')))
                r.imports.push_back({ mod.trimmed(), false, i + 1 });
            continue;
        }
        if (auto m = classRe.match(line); m.hasMatch()) {
            r.symbols.push_back({ m.captured(2), SymbolKind::Class, i + 1 });
            continue;
        }
        if (auto m = defRe.match(line); m.hasMatch())
            r.symbols.push_back({ m.captured(2), m.captured(1).isEmpty() ? SymbolKind::Function : SymbolKind::Method, i + 1 });
    }
}

void scanJs(const QString &code, QStringView original, SourceScanner::Result &r)
{
    static const QRegularExpression fromRe(QStringLiteral(R"re((?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"])re"));
    static const QRegularExpression bareImport(QStringLiteral(R"re(^\s*import\s*['"]([^'"]+)['"])re"));
    static const QRegularExpression requireRe(QStringLiteral(R"re((?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\))re"));
    static const QRegularExpression funcRe(QStringLiteral(R"re(^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*))re"));
    static const QRegularExpression classRe(QStringLiteral(R"re(^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*))re"));
    static const QRegularExpression ifaceRe(QStringLiteral(R"re(^\s*(?:export\s+)?(?:interface|type)\s+([A-Za-z_$][\w$]*))re"));
    static const QRegularExpression constFn(QStringLiteral(R"re(^\s*export\s+(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=)re"));
    static const QRegularExpression enumRe(QStringLiteral(R"re(^\s*(?:export\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*))re"));
    // imports need the original text (strings intact); symbols use the stripped code
    const QStringList orig = original.toString().split(QLatin1Char('\n'));
    const QStringList lines = code.split(QLatin1Char('\n'));
    r.lines = int(orig.size());
    for (int i = 0; i < orig.size(); ++i) {
        const QString &o = orig[i];
        const bool codeLineHasImport = i < lines.size() && (lines[i].contains(QLatin1String("import")) || lines[i].contains(QLatin1String("require")) || lines[i].contains(QLatin1String("from")));
        if (codeLineHasImport) {
            for (const QRegularExpression *re : { &fromRe, &bareImport, &requireRe }) {
                auto it = re->globalMatch(o);
                while (it.hasNext()) {
                    const QString spec = it.next().captured(1);
                    r.imports.push_back({ spec, spec.startsWith(QLatin1Char('.')) || spec.startsWith(QLatin1Char('/')), i + 1 });
                }
            }
        }
        if (i >= lines.size())
            continue;
        const QString &l = lines[i];
        if (auto m = classRe.match(l); m.hasMatch()) r.symbols.push_back({ m.captured(1), SymbolKind::Class, i + 1 });
        else if (auto m2 = funcRe.match(l); m2.hasMatch()) r.symbols.push_back({ m2.captured(1), SymbolKind::Function, i + 1 });
        else if (auto m3 = ifaceRe.match(l); m3.hasMatch()) r.symbols.push_back({ m3.captured(1), SymbolKind::Interface, i + 1 });
        else if (auto m4 = enumRe.match(l); m4.hasMatch()) r.symbols.push_back({ m4.captured(1), SymbolKind::Enum, i + 1 });
        else if (auto m5 = constFn.match(l); m5.hasMatch()) r.symbols.push_back({ m5.captured(1), SymbolKind::Constant, i + 1 });
    }
}

void scanGo(const QString &code, QStringView original, SourceScanner::Result &r)
{
    static const QRegularExpression single(QStringLiteral(R"re(^\s*import\s+(?:\w+\s+)?"([^"]+)")re"));
    static const QRegularExpression inBlock(QStringLiteral(R"re(^\s*(?:[\w\.]+\s+)?"([^"]+)")re"));
    static const QRegularExpression funcRe(QStringLiteral(R"re(^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*))re"));
    static const QRegularExpression typeRe(QStringLiteral(R"re(^type\s+([A-Za-z_]\w*)\s+(struct|interface)?)re"));
    const QStringList orig = original.toString().split(QLatin1Char('\n'));
    const QStringList lines = code.split(QLatin1Char('\n'));
    r.lines = int(orig.size());
    bool block = false;
    for (int i = 0; i < orig.size(); ++i) {
        const QString &o = orig[i];
        const QString t = o.trimmed();
        if (block) {
            if (t.startsWith(QLatin1Char(')'))) { block = false; continue; }
            if (auto m = inBlock.match(o); m.hasMatch()) r.imports.push_back({ m.captured(1), false, i + 1 });
            continue;
        }
        if (t.startsWith(QLatin1String("import ("))) { block = true; continue; }
        if (auto m = single.match(o); m.hasMatch()) { r.imports.push_back({ m.captured(1), false, i + 1 }); continue; }
        if (i >= lines.size()) continue;
        if (auto m = funcRe.match(lines[i]); m.hasMatch())
            r.symbols.push_back({ m.captured(1), lines[i].startsWith(QLatin1String("func (")) ? SymbolKind::Method : SymbolKind::Function, i + 1 });
        else if (auto m2 = typeRe.match(lines[i]); m2.hasMatch())
            r.symbols.push_back({ m2.captured(1), m2.captured(2) == QLatin1String("interface") ? SymbolKind::Interface : SymbolKind::Struct, i + 1 });
    }
}

void scanRust(const QString &code, SourceScanner::Result &r)
{
    static const QRegularExpression useRe(QStringLiteral(R"re(^\s*(?:pub(?:\([^)]*\))?\s+)?use\s+([\w:]+))re"));
    static const QRegularExpression modRe(QStringLiteral(R"re(^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_]\w*)\s*;)re"));
    static const QRegularExpression fnRe(QStringLiteral(R"re(^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?(?:const\s+)?fn\s+([A-Za-z_]\w*))re"));
    static const QRegularExpression typeRe(QStringLiteral(R"re(^\s*(?:pub(?:\([^)]*\))?\s+)?(struct|enum|trait|impl)\s+(?:<[^>]*>\s*)?([A-Za-z_]\w*))re"));
    const QStringList lines = code.split(QLatin1Char('\n'));
    r.lines = int(lines.size());
    for (int i = 0; i < lines.size(); ++i) {
        const QString &l = lines[i];
        if (auto m = modRe.match(l); m.hasMatch()) { r.imports.push_back({ QStringLiteral("mod:") + m.captured(1), true, i + 1 }); continue; }
        if (auto m = useRe.match(l); m.hasMatch()) { r.imports.push_back({ m.captured(1), m.captured(1).startsWith(QLatin1String("crate")) || m.captured(1).startsWith(QLatin1String("super")), i + 1 }); continue; }
        if (auto m = fnRe.match(l); m.hasMatch()) { r.symbols.push_back({ m.captured(1), l.startsWith(QLatin1Char(' ')) ? SymbolKind::Method : SymbolKind::Function, i + 1 }); continue; }
        if (auto m = typeRe.match(l); m.hasMatch()) {
            const QString k = m.captured(1);
            if (k == QLatin1String("impl")) continue;
            r.symbols.push_back({ m.captured(2), k == QLatin1String("struct") ? SymbolKind::Struct : k == QLatin1String("enum") ? SymbolKind::Enum : SymbolKind::Interface, i + 1 });
        }
    }
}

void scanJvm(const QString &code, SourceScanner::Result &r, bool csharp)
{
    static const QRegularExpression importRe(QStringLiteral(R"re(^\s*import\s+(?:static\s+)?([\w\.]+)\s*;?)re"));
    static const QRegularExpression usingRe(QStringLiteral(R"re(^\s*using\s+([\w\.]+)\s*;)re"));
    static const QRegularExpression typeRe(QStringLiteral(R"re(^\s*(?:(?:public|private|protected|internal|abstract|final|static|sealed|open|data|partial)\s+)*(class|interface|enum|record|object|struct)\s+([A-Za-z_]\w*))re"));
    static const QRegularExpression funRe(QStringLiteral(R"re(^\s*(?:(?:public|private|protected|internal|override|suspend|inline|open)\s+)*fun\s+(?:<[^>]*>\s*)?(?:[\w\.]+\.)?([A-Za-z_]\w*))re"));
    const QStringList lines = code.split(QLatin1Char('\n'));
    r.lines = int(lines.size());
    for (int i = 0; i < lines.size(); ++i) {
        const QString &l = lines[i];
        if (auto m = (csharp ? usingRe : importRe).match(l); m.hasMatch()) { r.imports.push_back({ m.captured(1), false, i + 1 }); continue; }
        if (auto m = typeRe.match(l); m.hasMatch()) {
            const QString k = m.captured(1);
            r.symbols.push_back({ m.captured(2), k == QLatin1String("interface") ? SymbolKind::Interface : k == QLatin1String("enum") ? SymbolKind::Enum : SymbolKind::Class, i + 1 });
            continue;
        }
        if (auto m = funRe.match(l); m.hasMatch())
            r.symbols.push_back({ m.captured(1), SymbolKind::Function, i + 1 });
    }
}

void scanQml(const QString &code, QStringView original, SourceScanner::Result &r)
{
    static const QRegularExpression importRe(QStringLiteral(R"re(^\s*import\s+"([^"]+)")re"));
    static const QRegularExpression typeUse(QStringLiteral(R"re((?:^|[\s:])([A-Z][A-Za-z0-9_]*)\s*\{)re"));
    static const QRegularExpression funcRe(QStringLiteral(R"re(^\s*function\s+([A-Za-z_]\w*))re"));
    static const QRegularExpression signalRe(QStringLiteral(R"re(^\s*signal\s+([A-Za-z_]\w*))re"));
    static const QRegularExpression componentRe(QStringLiteral(R"re(^\s*component\s+([A-Z]\w*)\s*:)re"));
    const QStringList orig = original.toString().split(QLatin1Char('\n'));
    const QStringList lines = code.split(QLatin1Char('\n'));
    r.lines = int(orig.size());
    QSet<QString> seen;
    for (int i = 0; i < orig.size(); ++i) {
        if (auto m = importRe.match(orig[i]); m.hasMatch()) { r.imports.push_back({ QStringLiteral("dir:") + m.captured(1), true, i + 1 }); continue; }
        if (i >= lines.size()) continue;
        const QString &l = lines[i];
        auto it = typeUse.globalMatch(l);
        while (it.hasNext()) {
            const QString t = it.next().captured(1);
            if (!seen.contains(t)) {
                seen.insert(t);
                r.imports.push_back({ QStringLiteral("type:") + t, true, i + 1 });
            }
        }
        if (auto m = componentRe.match(l); m.hasMatch()) r.symbols.push_back({ m.captured(1), SymbolKind::Component, i + 1 });
        else if (auto m2 = funcRe.match(l); m2.hasMatch()) r.symbols.push_back({ m2.captured(1), SymbolKind::Function, i + 1 });
        else if (auto m3 = signalRe.match(l); m3.hasMatch()) r.symbols.push_back({ m3.captured(1), SymbolKind::Function, i + 1 });
    }
}

void scanCMake(QStringView text, SourceScanner::Result &r)
{
    static const QRegularExpression subdir(QStringLiteral(R"re(^\s*add_subdirectory\s*\(\s*([^\s\)]+))re"), QRegularExpression::CaseInsensitiveOption);
    static const QRegularExpression inc(QStringLiteral(R"re(^\s*include\s*\(\s*([^\s\)]+\.cmake))re"), QRegularExpression::CaseInsensitiveOption);
    static const QRegularExpression target(QStringLiteral(R"re(^\s*(?:qt_)?add_(executable|library)\s*\(\s*([\w\-\.]+))re"), QRegularExpression::CaseInsensitiveOption);
    const QStringList lines = text.toString().split(QLatin1Char('\n'));
    r.lines = int(lines.size());
    for (int i = 0; i < lines.size(); ++i) {
        const QString &l = lines[i];
        if (l.trimmed().startsWith(QLatin1Char('#'))) continue;
        if (auto m = subdir.match(l); m.hasMatch()) r.imports.push_back({ QStringLiteral("subdir:") + m.captured(1), true, i + 1 });
        else if (auto m2 = inc.match(l); m2.hasMatch()) r.imports.push_back({ m2.captured(1), true, i + 1 });
        else if (auto m3 = target.match(l); m3.hasMatch()) r.symbols.push_back({ m3.captured(2), SymbolKind::Component, i + 1 });
    }
}

void scanMarkdown(QStringView text, SourceScanner::Result &r)
{
    static const QRegularExpression link(QStringLiteral(R"re(\]\(([^)\s#]+)(?:#[^)]*)?\))re"));
    static const QRegularExpression heading(QStringLiteral(R"re(^(#{1,2})\s+(.+?)\s*#*\s*$)re"));
    const QStringList lines = text.toString().split(QLatin1Char('\n'));
    r.lines = int(lines.size());
    bool fence = false;
    for (int i = 0; i < lines.size(); ++i) {
        const QString &l = lines[i];
        if (l.trimmed().startsWith(QLatin1String("```"))) { fence = !fence; continue; }
        if (fence) continue;
        if (auto m = heading.match(l); m.hasMatch())
            r.symbols.push_back({ m.captured(2), SymbolKind::Section, i + 1 });
        auto it = link.globalMatch(l);
        while (it.hasNext()) {
            const QString target = it.next().captured(1);
            if (target.contains(QLatin1String("://")) || target.startsWith(QLatin1String("mailto:")))
                continue;
            r.imports.push_back({ target, true, i + 1 });
        }
    }
}

} // namespace

SourceScanner::Result SourceScanner::scan(QStringView text, const QString &language)
{
    Result r;
    if (language == QLatin1String("C") || language == QLatin1String("C++") || language == QLatin1String("Objective-C"))
        scanCpp(stripCLike(text, true), r, false);
    else if (language == QLatin1String("GLSL") || language == QLatin1String("HLSL"))
        scanCpp(stripCLike(text, true), r, true);
    else if (language == QLatin1String("Python"))
        scanPython(text, r);
    else if (language == QLatin1String("JavaScript") || language == QLatin1String("TypeScript"))
        scanJs(stripCLike(text, false), text, r);
    else if (language == QLatin1String("Go"))
        scanGo(stripCLike(text, false), text, r);
    else if (language == QLatin1String("Rust"))
        scanRust(stripCLike(text, false), r);
    else if (language == QLatin1String("Java") || language == QLatin1String("Kotlin") || language == QLatin1String("Scala") || language == QLatin1String("Swift"))
        scanJvm(stripCLike(text, false), r, false);
    else if (language == QLatin1String("C#"))
        scanJvm(stripCLike(text, false), r, true);
    else if (language == QLatin1String("QML"))
        scanQml(stripCLike(text, false), text, r);
    else if (language == QLatin1String("CMake"))
        scanCMake(text, r);
    else if (language == QLatin1String("Markdown"))
        scanMarkdown(text, r);
    else
        r.lines = int(text.count(QLatin1Char('\n'))) + 1;
    return r;
}

} // namespace nexus::project
