#include "ingest/Normalizer.h"
#include "session/SessionEngine.h"

#include <QDateTime>
#include <QJsonObject>
#include <QTest>

using namespace nexus;

namespace {
core::NexusEvent hook(const QString &session, const QString &name, qint64 ts, QJsonObject extra = {})
{
    extra.insert("session_id", session);
    extra.insert("hook_event_name", name);
    extra.insert("cwd", "/proj");
    return ingest::Normalizer::fromHook(extra, ts, 0);
}
} // namespace

class TestSession : public QObject
{
    Q_OBJECT
private slots:
    void lifecycleAndPairing()
    {
        session::SessionEngine eng;
        eng.ingestOne(hook("s", "SessionStart", 1000, { { "source", "startup" }, { "model", "m1" } }), false);
        QCOMPARE(eng.session("s")->state, session::AgentState::Idle);
        eng.ingestOne(hook("s", "UserPromptSubmit", 1100, { { "prompt", "Fix the bug" } }), false);
        QCOMPARE(eng.session("s")->state, session::AgentState::Running);
        QCOMPARE(eng.session("s")->stateProvenance, core::NexusEvent::Provenance::Derived);
        QCOMPARE(eng.session("s")->currentTask, QStringLiteral("Fix the bug"));

        const QJsonObject read{ { "tool_name", "Read" }, { "tool_use_id", "t1" }, { "tool_input", QJsonObject{ { "file_path", "/proj/a.cpp" } } } };
        eng.ingestOne(hook("s", "PreToolUse", 1200, read), false);
        QCOMPARE(eng.session("s")->state, session::AgentState::ExecutingTool);
        eng.ingestOne(hook("s", "PostToolUse", 1450, read), false);   // no duration_ms → derived
        const auto &calls = eng.session("s")->toolCalls;
        QCOMPARE(int(calls.size()), 1);
        QCOMPARE(calls[0].durationMs, 250);
        QVERIFY(!calls[0].durationObserved);
        QCOMPARE(eng.session("s")->filesRead.value("/proj/a.cpp"), 1);

        // permission wait then an observed-duration failure of a test command
        const QJsonObject bash{ { "tool_name", "Bash" }, { "tool_use_id", "t2" }, { "tool_input", QJsonObject{ { "command", "pytest -q" } } } };
        eng.ingestOne(hook("s", "PermissionRequest", 1500, bash), false);
        QCOMPARE(eng.session("s")->state, session::AgentState::WaitingPermission);
        eng.ingestOne(hook("s", "PreToolUse", 2500, bash), false);
        QJsonObject fail = bash;
        fail.insert("duration_ms", 900);
        fail.insert("error", "Exit code 1");
        eng.ingestOne(hook("s", "PostToolUseFailure", 3400, fail), false);
        const auto *s = eng.session("s");
        QCOMPARE(int(s->waits.size()), 1);
        QCOMPARE(s->waits[0].first, 1500);
        QCOMPARE(s->waits[0].second, 2500);
        QCOMPARE(s->testRuns, 1);
        QCOMPARE(s->testFailures, 1);
        QCOMPARE(s->errors, 1);
        QCOMPARE(s->toolCalls[1].durationMs, 900);
        QVERIFY(s->toolCalls[1].durationObserved);

        eng.ingestOne(hook("s", "Stop", 3500, { { "last_assistant_message", "Done." } }), false);
        QCOMPARE(eng.session("s")->state, session::AgentState::Completed);
        QCOMPARE(eng.session("s")->lastAssistantMessage, QStringLiteral("Done."));
        eng.ingestOne(hook("s", "SessionEnd", 3600, { { "reason", "exit" } }), false);
        QCOMPARE(eng.session("s")->state, session::AgentState::Ended);
    }

    void eventsWithoutSessionCreateNoSession()
    {
        session::SessionEngine eng;
        eng.ingestOne(hook("", "Notification", 10, { { "message", "x" } }), false);
        QCOMPARE(eng.sessionCount(), 0);
        QCOMPARE(eng.eventCount(), 1);
    }

    void conflictsBetweenSessions()
    {
        session::SessionEngine eng;
        const qint64 now = QDateTime::currentMSecsSinceEpoch();
        const QJsonObject edit{ { "tool_name", "Edit" }, { "tool_use_id", "e" }, { "tool_input", QJsonObject{ { "file_path", "/proj/shared.cpp" } } } };
        eng.ingestOne(hook("a", "PostToolUse", now, edit), false);
        eng.ingestOne(hook("b", "PostToolUse", now + 10, edit), false);
        QTRY_VERIFY_WITH_TIMEOUT(!eng.conflicts().isEmpty(), 2000);
        QCOMPARE(eng.conflicts().first().toMap().value("type").toString(), QStringLiteral("conflict"));
    }

    void statusLineFillsContext()
    {
        session::SessionEngine eng;
        QJsonObject p{ { "session_id", "s" }, { "context_window", QJsonObject{ { "used_percentage", 42 }, { "total_input_tokens", 84000 }, { "context_window_size", 200000 } } },
                       { "cost", QJsonObject{ { "total_cost_usd", 1.25 } } } };
        eng.ingestOne(ingest::Normalizer::fromStatusLine(p, 100), false);
        const auto &c = eng.session("s")->context;
        QVERIFY(c.available);
        QCOMPARE(c.usedPercentage, 42.0);
        QCOMPARE(c.inputTokens, 84000);
        QCOMPARE(c.costUsd, 1.25);
    }
};

QTEST_GUILESS_MAIN(TestSession)
#include "tst_session.moc"
