#include "SimulationSource.h"

#include "ingest/Normalizer.h"

#include <QDateTime>
#include <QFile>
#include <QJsonArray>
#include <QUuid>

namespace nexus::sim {

namespace {
const QStringList kSourceExt = { "cpp", "h", "hpp", "c", "py", "ts", "tsx", "js", "go", "rs", "java", "kt", "qml", "swift", "cs", "frag", "vert", "comp" };
}

SimulationSource::SimulationSource(QObject *parent) : QObject(parent) {}

void SimulationSource::setProject(const QString &root, const QStringList &relativeFiles)
{
    m_root = root;
    m_files = relativeFiles;
    m_sources.clear();
    m_tests.clear();
    for (const QString &f : relativeFiles) {
        const QString ext = f.section(QLatin1Char('.'), -1).toLower();
        if (!kSourceExt.contains(ext)) continue;
        const QString lower = f.toLower();
        if (lower.contains(QLatin1String("test"))) m_tests << f;
        else m_sources << f;
    }
    if (m_sources.isEmpty()) m_sources = m_files;
}

QString SimulationSource::pick(const QStringList &from)
{
    if (from.isEmpty()) return QStringLiteral("README.md");
    return from.at(int(m_rng.bounded(quint32(from.size()))));
}

QStringList SimulationSource::cluster(int n)
{
    // files from the same directory as a random seed file — agents work locally
    const QString seed = pick(m_sources);
    const QString dir = seed.section(QLatin1Char('/'), 0, -2);
    QStringList same;
    for (const QString &f : m_sources)
        if (f.section(QLatin1Char('/'), 0, -2) == dir) same << f;
    QStringList out{ seed };
    while (out.size() < n && !same.isEmpty()) {
        const QString f = pick(same);
        if (!out.contains(f)) out << f;
        same.removeAll(f);
    }
    while (out.size() < n) out << pick(m_sources);
    return out;
}

void SimulationSource::start(int agents)
{
    if (m_running || m_files.isEmpty()) return;
    m_running = true;
    m_agents.clear();
    m_agents.resize(size_t(agents));
    for (int i = 0; i < agents; ++i) {
        Agent &a = m_agents[size_t(i)];
        a.sessionId = QStringLiteral("sim-") + QUuid::createUuid().toString(QUuid::WithoutBraces).left(8);
        a.timer = new QTimer(this);
        a.timer->setSingleShot(true);
        const int idx = i;
        connect(a.timer, &QTimer::timeout, this, [this, idx]() { if (m_running) step(m_agents[size_t(idx)]); });
        buildScript(a);
        a.timer->start(400 + i * 1700);
    }
    emit runningChanged();
}

void SimulationSource::stop()
{
    if (!m_running) return;
    m_running = false;
    for (Agent &a : m_agents) {
        if (a.timer) a.timer->stop();
        QJsonObject end{ { "hook_event_name", "SessionEnd" }, { "reason", "simulation stopped" } };
        emitHook(a, end);
    }
    emit runningChanged();
}

void SimulationSource::emitHook(const Agent &a, QJsonObject p, const QString &agentId, const QString &agentType)
{
    p.insert(QStringLiteral("session_id"), a.sessionId);
    p.insert(QStringLiteral("cwd"), m_root);
    p.insert(QStringLiteral("transcript_path"), QStringLiteral("(simulated)"));
    p.insert(QStringLiteral("permission_mode"), QStringLiteral("default"));
    if (!agentId.isEmpty()) { p.insert(QStringLiteral("agent_id"), agentId); p.insert(QStringLiteral("agent_type"), agentType); }
    core::NexusEvent e = ingest::Normalizer::fromHook(p, QDateTime::currentMSecsSinceEpoch(), 0);
    e.simulated = true;
    e.source = core::NexusEvent::Source::Simulation;
    e.summary = QStringLiteral("[SIM] ") + e.summary;
    emit eventReady(e);
}

void SimulationSource::step(Agent &a)
{
    if (a.script.empty()) buildScript(a);
    auto fn = a.script.front();
    a.script.pop_front();
    fn();
    // human-like pacing: fast bursts of reads, slower edits and commands
    const int delay = 260 + int(m_rng.bounded(1100u));
    a.timer->start(delay);
}

void SimulationSource::buildScript(Agent &a)
{
    auto &s = a.script;
    const bool first = a.round == 0;
    ++a.round;
    const QStringList files = cluster(5);
    const QString target = files.first();
    const QString test = m_tests.isEmpty() ? QString() : pick(m_tests);
    const QString agentRef = a.sessionId;
    auto tool = [this, agentRef](const QString &name, const QJsonObject &input, bool ok, int durationMs,
                                 const QString &error = {}, const QString &agentId = {}, const QString &agentType = {}) {
        return [this, agentRef, name, input, ok, durationMs, error, agentId, agentType]() {
            const Agent *ag = nullptr;
            for (const Agent &x : m_agents) if (x.sessionId == agentRef) ag = &x;
            if (!ag) return;
            const QString id = QStringLiteral("toolu_sim_%1").arg(++m_counter);
            emitHook(*ag, QJsonObject{ { "hook_event_name", "PreToolUse" }, { "tool_name", name }, { "tool_input", input }, { "tool_use_id", id } }, agentId, agentType);
            // the Post event follows after the simulated duration
            QTimer::singleShot(std::max(60, durationMs), this, [this, agentRef, name, input, ok, durationMs, error, id, agentId, agentType]() {
                if (!m_running) return;
                const Agent *ag2 = nullptr;
                for (const Agent &x : m_agents) if (x.sessionId == agentRef) ag2 = &x;
                if (!ag2) return;
                QJsonObject post{ { "hook_event_name", ok ? "PostToolUse" : "PostToolUseFailure" }, { "tool_name", name },
                                  { "tool_input", input }, { "tool_use_id", id }, { "duration_ms", durationMs } };
                if (!ok) post.insert(QStringLiteral("error"), error);
                else post.insert(QStringLiteral("tool_response"), QJsonObject{ { "simulated", true } });
                emitHook(*ag2, post, agentId, agentType);
            });
        };
    };
    auto hook = [this, agentRef](QJsonObject p) {
        return [this, agentRef, p]() {
            for (const Agent &x : m_agents) if (x.sessionId == agentRef) { emitHook(x, p); return; }
        };
    };
    auto readFile = [this](const QString &rel) { return QJsonObject{ { "file_path", abs(rel) } }; };

    if (first)
        s.push_back(hook({ { "hook_event_name", "SessionStart" }, { "source", "startup" }, { "model", "simulated-model" } }));
    const QString dir = target.section(QLatin1Char('/'), 0, -2);
    s.push_back(hook({ { "hook_event_name", "UserPromptSubmit" },
                       { "prompt", QStringLiteral("[Simulation] Investigate and fix an issue in %1").arg(dir.isEmpty() ? QStringLiteral("the project root") : dir) } }));
    s.push_back(tool(QStringLiteral("Glob"), { { "pattern", QStringLiteral("%1/**/*").arg(dir.isEmpty() ? QStringLiteral(".") : dir) }, { "path", abs(dir) } }, true, 40));
    for (const QString &f : files)
        s.push_back(tool(QStringLiteral("Read"), readFile(f), true, 25 + int(m_rng.bounded(60u))));
    s.push_back(tool(QStringLiteral("Grep"), { { "pattern", "TODO|FIXME" }, { "path", abs(dir) } }, true, 120));
    if (!test.isEmpty()) s.push_back(tool(QStringLiteral("Read"), readFile(test), true, 30));
    s.push_back(hook({ { "hook_event_name", "PermissionRequest" }, { "tool_name", "Bash" },
                       { "tool_input", QJsonObject{ { "command", "ctest --output-on-failure" } } } }));
    s.push_back(tool(QStringLiteral("Bash"), { { "command", "ctest --output-on-failure" }, { "description", "Run the test suite (simulated)" } },
                     false, 2400, QStringLiteral("Exit code 8\n[simulated] 1 test failed")));
    // an edit with a small, plausible diff built from the file's real first lines
    QString oldText, newText;
    {
        QFile f(abs(target));
        if (f.open(QIODevice::ReadOnly)) {
            QStringList lines = QString::fromUtf8(f.read(4000)).split(QLatin1Char('\n')).mid(0, 6);
            oldText = lines.join(QLatin1Char('\n'));
            QStringList edited = lines;
            edited.insert(std::min<qsizetype>(2, edited.size()), QStringLiteral("// [simulated edit — not applied to disk]"));
            newText = edited.join(QLatin1Char('\n'));
        }
    }
    s.push_back(tool(QStringLiteral("Edit"), { { "file_path", abs(target) }, { "old_string", oldText }, { "new_string", newText } }, true, 90));
    if (m_rng.bounded(3u) == 0)
        s.push_back(tool(QStringLiteral("Edit"), { { "file_path", abs(files.value(1)) }, { "old_string", "a" }, { "new_string", "b" } }, true, 70));
    // a subagent exploring
    const QString subId = QStringLiteral("agent-sim-%1").arg(m_counter + 1);
    s.push_back([this, agentRef, subId]() {
        for (const Agent &x : m_agents) if (x.sessionId == agentRef) emitHook(x, { { "hook_event_name", "SubagentStart" }, { "agent_id", subId }, { "agent_type", "Explore" } }, subId, QStringLiteral("Explore"));
    });
    for (const QString &f : cluster(3))
        s.push_back(tool(QStringLiteral("Read"), readFile(f), true, 30, {}, subId, QStringLiteral("Explore")));
    s.push_back([this, agentRef, subId]() {
        for (const Agent &x : m_agents) if (x.sessionId == agentRef)
            emitHook(x, { { "hook_event_name", "SubagentStop" }, { "agent_id", subId }, { "agent_type", "Explore" }, { "last_assistant_message", "[SIM] exploration done" } }, subId, QStringLiteral("Explore"));
    });
    s.push_back(tool(QStringLiteral("Bash"), { { "command", "ctest --output-on-failure" }, { "description", "Re-run tests (simulated)" } }, true, 2100));
    s.push_back(hook({ { "hook_event_name", "Stop" }, { "last_assistant_message", QStringLiteral("[Simulation] Fixed the issue in %1; tests pass.").arg(target) } }));
    // idle pause before the next round
    s.push_back([]() {});
    s.push_back([]() {});
}

} // namespace nexus::sim
