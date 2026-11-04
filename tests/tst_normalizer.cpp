#include "ingest/Normalizer.h"

#include <QJsonObject>
#include <QTest>

using nexus::ingest::Normalizer;

class TestNormalizer : public QObject
{
    Q_OBJECT
private slots:
    void kindsMapFromHookNames()
    {
        QCOMPARE(Normalizer::kindForHookEvent("PreToolUse"), QStringLiteral("tool.pre"));
        QCOMPARE(Normalizer::kindForHookEvent("PostToolUseFailure"), QStringLiteral("tool.fail"));
        QCOMPARE(Normalizer::kindForHookEvent("StopFailure"), QStringLiteral("turn.fail"));
        QCOMPARE(Normalizer::kindForHookEvent("SomethingNew"), QStringLiteral("unknown"));
    }

    void toolCategories()
    {
        QCOMPARE(Normalizer::toolCategory("Read"), QStringLiteral("read"));
        QCOMPARE(Normalizer::toolCategory("MultiEdit"), QStringLiteral("write"));
        QCOMPARE(Normalizer::toolCategory("Bash"), QStringLiteral("exec"));
        QCOMPARE(Normalizer::toolCategory("mcp__github__get_issue"), QStringLiteral("mcp"));
        QCOMPARE(Normalizer::toolCategory("WeirdTool"), QStringLiteral("other"));
    }

    void testCommandsInferred_data()
    {
        QTest::addColumn<QString>("cmd");
        QTest::addColumn<bool>("isTest");
        QTest::newRow("pytest") << "pytest -q tests/" << true;
        QTest::newRow("npm") << "npm test" << true;
        QTest::newRow("npm run") << "npm run test -- --ci" << true;
        QTest::newRow("cargo") << "cargo test --all" << true;
        QTest::newRow("go") << "go test ./..." << true;
        QTest::newRow("ctest") << "cd build && ctest --output-on-failure" << true;
        QTest::newRow("gradle") << "./gradlew clean test" << true;
        QTest::newRow("python -m") << "python -m pytest" << true;
        QTest::newRow("ls") << "ls -la" << false;
        QTest::newRow("grep test") << "grep -r testing src" << false;
        QTest::newRow("npm install") << "npm install" << false;
    }
    void testCommandsInferred()
    {
        QFETCH(QString, cmd);
        QFETCH(bool, isTest);
        QCOMPARE(Normalizer::looksLikeTestCommand(cmd), isTest);
    }

    void postToolUseNormalised()
    {
        QJsonObject p{ { "session_id", "s1" }, { "cwd", "/proj" }, { "hook_event_name", "PostToolUse" }, { "tool_name", "Edit" },
                       { "tool_input", QJsonObject{ { "file_path", "/proj/src/a.cpp" }, { "old_string", "x" }, { "new_string", "y" } } },
                       { "tool_response", QJsonObject{ { "filePath", "/proj/src/a.cpp" } } }, { "tool_use_id", "toolu_1" }, { "duration_ms", 17 } };
        const auto e = Normalizer::fromHook(p, 1000, 42);
        QCOMPARE(e.kind, QStringLiteral("tool.post"));
        QCOMPARE(e.category, QStringLiteral("write"));
        QCOMPARE(e.sessionId, QStringLiteral("s1"));
        QCOMPARE(e.files, QStringList{ "/proj/src/a.cpp" });
        QCOMPARE(e.durationMs, 17);
        QCOMPARE(e.ok, 1);
        QCOMPARE(e.claudePid, 42);
        QCOMPARE(e.ts, 1000);
        QVERIFY(e.summary.contains(QStringLiteral("Edit")));
        QVERIFY(e.payload.value("tool_input").toObject().contains("old_string"));
    }

    void relativePathsResolvedAgainstCwd()
    {
        QJsonObject p{ { "session_id", "s1" }, { "cwd", "/proj" }, { "hook_event_name", "PreToolUse" }, { "tool_name", "Read" },
                       { "tool_input", QJsonObject{ { "file_path", "src/b.h" } } } };
        QCOMPARE(Normalizer::fromHook(p, 0, 0).files, QStringList{ "/proj/src/b.h" });
    }

    void failureCarriesRedactedError()
    {
        QJsonObject p{ { "session_id", "s1" }, { "hook_event_name", "PostToolUseFailure" }, { "tool_name", "Bash" },
                       { "tool_input", QJsonObject{ { "command", "curl -H 'Authorization: Bearer abcdefghijklmnop1234' x" } } },
                       { "error", "Exit code 1\nTOKEN=supersecretvalue" } };
        const auto e = Normalizer::fromHook(p, 0, 0);
        QCOMPARE(e.ok, 0);
        QVERIFY(!e.error.contains(QStringLiteral("supersecretvalue")));
        QVERIFY(!e.command.contains(QStringLiteral("abcdefghijklmnop1234")));
    }

    void statusLineContext()
    {
        QJsonObject p{ { "session_id", "s1" }, { "model", QJsonObject{ { "display_name", "Opus" } } },
                       { "context_window", QJsonObject{ { "used_percentage", 23 }, { "total_input_tokens", 46000 } } },
                       { "cost", QJsonObject{ { "total_cost_usd", 0.41 } } } };
        const auto e = Normalizer::fromStatusLine(p, 5);
        QCOMPARE(e.kind, QStringLiteral("status.update"));
        QVERIFY(e.summary.contains(QStringLiteral("23%")));
        QCOMPARE(e.payload.value("context_window").toObject().value("total_input_tokens").toInt(), 46000);
    }

    void streamJsonMessages()
    {
        nexus::core::NexusEvent e;
        QVERIFY(Normalizer::fromStreamJson(QJsonObject{ { "type", "system" }, { "subtype", "init" }, { "session_id", "abc" }, { "model", "m" } }, "", 1, &e));
        QCOMPARE(e.kind, QStringLiteral("stream.init"));
        QVERIFY(!Normalizer::fromStreamJson(QJsonObject{ { "type", "user" } }, "", 1, &e));
        QVERIFY(Normalizer::fromStreamJson(QJsonObject{ { "type", "result" }, { "subtype", "success" }, { "is_error", false }, { "total_cost_usd", 0.01 } }, "abc", 1, &e));
        QCOMPARE(e.kind, QStringLiteral("stream.result"));
        QCOMPARE(e.ok, 1);
    }
};

QTEST_GUILESS_MAIN(TestNormalizer)
#include "tst_normalizer.moc"
