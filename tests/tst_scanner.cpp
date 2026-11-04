#include "project/ProjectIndexer.h"
#include "project/SourceScanner.h"

#include <QDir>
#include <QFile>
#include <QTemporaryDir>
#include <QTest>

using namespace nexus::project;

namespace {
bool hasImport(const SourceScanner::Result &r, const QString &spec)
{
    for (const RawImport &i : r.imports) if (i.spec == spec) return true;
    return false;
}
bool hasSymbol(const SourceScanner::Result &r, const QString &name)
{
    for (const Symbol &s : r.symbols) if (s.name == name) return true;
    return false;
}
void write(const QString &root, const QString &rel, const QByteArray &content)
{
    QDir().mkpath(QFileInfo(root + "/" + rel).absolutePath());
    QFile f(root + "/" + rel);
    QVERIFY(f.open(QIODevice::WriteOnly));
    f.write(content);
}
} // namespace

class TestScanner : public QObject
{
    Q_OBJECT
private slots:
    void cpp()
    {
        const auto r = SourceScanner::scan(QStringLiteral(
            "#include \"render/Camera.h\"\n#include <vector>\n// #include \"commented.h\"\n"
            "namespace nexus {\nclass Foo : public Bar {\npublic:\n  void x();\n};\n"
            "struct Data;\nenum class Mode { A, B };\n"
            "int Foo::compute(int a) const\n{\n  if (a) return 1;\n  return 0;\n}\n}\n"), QStringLiteral("C++"));
        QVERIFY(hasImport(r, "render/Camera.h"));
        QVERIFY(hasImport(r, "vector"));
        QVERIFY(!hasImport(r, "commented.h"));
        QVERIFY(hasSymbol(r, "Foo"));
        QVERIFY(!hasSymbol(r, "Data"));   // forward declaration
        QVERIFY(hasSymbol(r, "Mode"));
        QVERIFY(hasSymbol(r, "Foo::compute"));
        QVERIFY(hasSymbol(r, "nexus"));
        QVERIFY(!hasSymbol(r, "if"));
    }

    void python()
    {
        const auto r = SourceScanner::scan(QStringLiteral(
            "import os, sys\nfrom .models import User\nfrom . import utils\nfrom pkg.sub import thing\n"
            "\"\"\"\nimport fake\n\"\"\"\nclass A:\n    def m(self):\n        pass\n\ndef top():\n    pass\n"), QStringLiteral("Python"));
        QVERIFY(hasImport(r, "os"));
        QVERIFY(hasImport(r, ".models"));
        QVERIFY(hasImport(r, ".utils"));
        QVERIFY(hasImport(r, "pkg.sub"));
        QVERIFY(!hasImport(r, "fake"));
        QVERIFY(hasSymbol(r, "A"));
        QVERIFY(hasSymbol(r, "top"));
    }

    void typescript()
    {
        const auto r = SourceScanner::scan(QStringLiteral(
            "import { a } from './a';\nimport b from \"../lib/b\";\nconst c = require('./c');\nimport 'side-effect';\n"
            "export function run() {}\nexport class Widget {}\nexport interface Props {}\n// import x from './nope'\n"), QStringLiteral("TypeScript"));
        QVERIFY(hasImport(r, "./a"));
        QVERIFY(hasImport(r, "../lib/b"));
        QVERIFY(hasImport(r, "./c"));
        QVERIFY(hasImport(r, "side-effect"));
        QVERIFY(!hasImport(r, "./nope"));
        QVERIFY(hasSymbol(r, "run"));
        QVERIFY(hasSymbol(r, "Widget"));
        QVERIFY(hasSymbol(r, "Props"));
    }

    void categories()
    {
        QCOMPARE(SourceScanner::categoryFor("tests/test_x.py", "test_x.py", "py"), FileCategory::Test);
        QCOMPARE(SourceScanner::categoryFor("src/a.hpp", "a.hpp", "hpp"), FileCategory::Header);
        QCOMPARE(SourceScanner::categoryFor("CMakeLists.txt", "CMakeLists.txt", "txt"), FileCategory::Build);
        QCOMPARE(SourceScanner::categoryFor("docs/a.md", "a.md", "md"), FileCategory::Doc);
        QCOMPARE(SourceScanner::categoryFor("img/logo.png", "logo.png", "png"), FileCategory::Asset);
    }

    void indexAndResolve()
    {
        QTemporaryDir dir;
        QVERIFY(dir.isValid());
        const QString root = dir.path();
        write(root, "src/main.cpp", "#include \"util/Math.h\"\n#include \"Local.h\"\nint main() {\n return 0;\n}\n");
        write(root, "src/Local.h", "#pragma once\n");
        write(root, "src/util/Math.h", "#pragma once\nnamespace m {}\n");
        write(root, "app/models.py", "class User:\n    pass\n");
        write(root, "app/views.py", "from .models import User\nimport app.models\n");
        write(root, "web/index.ts", "import { x } from './lib/x';\n");
        write(root, "web/lib/x.ts", "export const x = 1;\n");
        write(root, "node_modules/junk/index.js", "ignored\n");
        IndexOptions opt;
        opt.useGit = false;
        const ProjectSnapshot s = ProjectIndexer::index(root, opt);
        QVERIFY(s.fileIndex("node_modules/junk/index.js") < 0);
        auto edge = [&](const QString &a, const QString &b) {
            const int fa = s.fileIndex(a), fb = s.fileIndex(b);
            for (const DepEdge &e : s.deps) if (e.from == fa && e.to == fb) return true;
            return false;
        };
        QVERIFY(edge("src/main.cpp", "src/util/Math.h"));
        QVERIFY(edge("src/main.cpp", "src/Local.h"));
        QVERIFY(edge("app/views.py", "app/models.py"));
        QVERIFY(edge("web/index.ts", "web/lib/x.ts"));
        QVERIFY(s.dirs.size() >= 4);
        QCOMPARE(s.dirs[0].totalFiles, int(s.files.size()));
    }
};

QTEST_GUILESS_MAIN(TestScanner)
#include "tst_scanner.moc"
