#include "SessionEngine.h"

#include <QColor>
#include <QDateTime>
#include <QDir>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QSet>
#include <algorithm>

#ifdef Q_OS_UNIX
#include <cerrno>
#include <signal.h>
#endif

namespace nexus::session {

using core::NexusEvent;
using Prov = core::NexusEvent::Provenance;

namespace {
constexpr int kMaxEvents = 60000;
constexpr int kTrimBy = 10000;
constexpr qint64 kStaleMs = 30 * 60 * 1000;

bool processAlive(int pid)
{
#ifdef Q_OS_UNIX
    if (pid <= 1) return true;
    return ::kill(pid, 0) == 0 || errno == EPERM;
#else
    Q_UNUSED(pid);
    return true;  // not monitored on this platform yet
#endif
}

QString firstLine(const QString &s, int max)
{
    QString l = s.section(QLatin1Char('\n'), 0, 0).trimmed();
    if (l.size() > max) l = l.left(max - 1) + QStringLiteral("…");
    return l;
}

// Minimal LCS line diff for per-event Edit inspection (bounded input sizes).
QVariantList lineDiff(const QString &a, const QString &b)
{
    const QStringList x = a.split(QLatin1Char('\n'));
    const QStringList y = b.split(QLatin1Char('\n'));
    QVariantList out;
    auto row = [](const QString &t, const QString &text) { return QVariantMap{ { QStringLiteral("t"), t }, { QStringLiteral("s"), text } }; };
    if (x.size() * y.size() > 250000) {
        for (const QString &l : x) out.append(row(QStringLiteral("-"), l));
        for (const QString &l : y) out.append(row(QStringLiteral("+"), l));
        return out;
    }
    const int n = int(x.size()), m = int(y.size());
    std::vector<int> dp(size_t((n + 1) * (m + 1)), 0);
    auto at = [&](int i, int j) -> int & { return dp[size_t(i * (m + 1) + j)]; };
    for (int i = n - 1; i >= 0; --i)
        for (int j = m - 1; j >= 0; --j)
            at(i, j) = x[i] == y[j] ? at(i + 1, j + 1) + 1 : std::max(at(i + 1, j), at(i, j + 1));
    int i = 0, j = 0;
    while (i < n && j < m) {
        if (x[i] == y[j]) { out.append(row(QStringLiteral(" "), x[i])); ++i; ++j; }
        else if (at(i + 1, j) >= at(i, j + 1)) { out.append(row(QStringLiteral("-"), x[i])); ++i; }
        else { out.append(row(QStringLiteral("+"), y[j])); ++j; }
    }
    while (i < n) out.append(row(QStringLiteral("-"), x[i++]));
    while (j < m) out.append(row(QStringLiteral("+"), y[j++]));
    return out;
}

} // namespace

QString stateName(AgentState s)
{
    switch (s) {
    case AgentState::Idle: return QStringLiteral("idle");
    case AgentState::Running: return QStringLiteral("running");
    case AgentState::ExecutingTool: return QStringLiteral("executing");
    case AgentState::WaitingPermission: return QStringLiteral("permission");
    case AgentState::AwaitingInput: return QStringLiteral("awaiting");
    case AgentState::Completed: return QStringLiteral("completed");
    case AgentState::Failed: return QStringLiteral("failed");
    case AgentState::Ended: return QStringLiteral("ended");
    case AgentState::Stale: return QStringLiteral("stale");
    default: return QStringLiteral("unknown");
    }
}

QString stateLabel(AgentState s)
{
    switch (s) {
    case AgentState::Idle: return QStringLiteral("Idle");
    case AgentState::Running: return QStringLiteral("Running");
    case AgentState::ExecutingTool: return QStringLiteral("Executing tool");
    case AgentState::WaitingPermission: return QStringLiteral("Waiting for permission");
    case AgentState::AwaitingInput: return QStringLiteral("Awaiting input");
    case AgentState::Completed: return QStringLiteral("Completed");
    case AgentState::Failed: return QStringLiteral("Failed");
    case AgentState::Ended: return QStringLiteral("Ended");
    case AgentState::Stale: return QStringLiteral("Stale");
    default: return QStringLiteral("Unknown");
    }
}

QString SessionEngine::colorHex(int index)
{
    static const char *palette[] = { "#3fd4ff", "#9a86ff", "#4fe3c1", "#6fb7ff", "#cf8cff", "#ddf6ff", "#5ee1e6", "#8fa2ff" };
    return QString::fromLatin1(palette[index % 8]);
}

// =========================================================================== models

SessionListModel::SessionListModel(SessionEngine *engine) : m_engine(engine) {}

int SessionListModel::rowCount(const QModelIndex &parent) const { return parent.isValid() ? 0 : int(m_order.size()); }

QHash<int, QByteArray> SessionListModel::roleNames() const
{
    return { { IdRole, "sessionId" }, { TitleRole, "title" }, { StateRole, "agentState" }, { StateLabelRole, "stateLabel" },
             { DetailRole, "detail" }, { ColorRole, "agentColor" }, { CwdRole, "cwd" }, { FirstTsRole, "firstTs" },
             { LastTsRole, "lastTs" }, { ToolCountRole, "toolCount" }, { ErrorCountRole, "errorCount" },
             { SimulatedRole, "simulated" }, { AliveRole, "alive" }, { ProjectRole, "project" }, { FilesRole, "fileCount" },
             { LaunchedRole, "launched" }, { PidRole, "pid" } };
}

QVariant SessionListModel::data(const QModelIndex &index, int role) const
{
    if (!index.isValid() || index.row() >= m_order.size())
        return {};
    const SessionRecord *s = m_engine->session(m_order[index.row()]);
    if (!s) return {};
    switch (role) {
    case IdRole: return s->id;
    case TitleRole: return s->title.isEmpty() ? (s->currentTask.isEmpty() ? QStringLiteral("Session ") + s->id.left(8) : s->currentTask) : s->title;
    case StateRole: return stateName(s->state);
    case StateLabelRole: return stateLabel(s->state);
    case DetailRole: return s->stateDetail;
    case ColorRole: return SessionEngine::colorHex(s->colorIndex);
    case CwdRole: return s->cwd;
    case FirstTsRole: return s->firstTs;
    case LastTsRole: return s->lastTs;
    case ToolCountRole: return s->toolCount;
    case ErrorCountRole: return s->errors;
    case SimulatedRole: return s->simulated;
    case AliveRole: return s->processAlive;
    case ProjectRole: return QFileInfo(s->cwd).fileName();
    case FilesRole: {
        QSet<QString> f;
        for (auto it = s->filesRead.cbegin(); it != s->filesRead.cend(); ++it) f.insert(it.key());
        for (auto it = s->filesWritten.cbegin(); it != s->filesWritten.cend(); ++it) f.insert(it.key());
        return int(f.size());
    }
    case LaunchedRole: return s->launchedByNexus;
    case PidRole: return s->claudePid;
    default: return {};
    }
}

void SessionListModel::reset()
{
    beginResetModel();
    m_order = m_engine->sessionIds();
    std::sort(m_order.begin(), m_order.end(), [this](const QString &a, const QString &b) {
        return m_engine->session(a)->firstTs > m_engine->session(b)->firstTs;
    });
    endResetModel();
}

void SessionListModel::sessionChanged(const QString &id)
{
    const int row = int(m_order.indexOf(id));
    if (row < 0) { reset(); return; }
    // rows keep a stable position; only their data changes
    emit dataChanged(index(row), index(row));
}

EventListModel::EventListModel(SessionEngine *engine) : m_engine(engine) {}

int EventListModel::rowCount(const QModelIndex &parent) const { return parent.isValid() ? 0 : int(m_rows.size()); }

QHash<int, QByteArray> EventListModel::roleNames() const
{
    return { { IndexRole, "eventIndex" }, { TsRole, "ts" }, { KindRole, "kind" }, { CategoryRole, "category" },
             { ToolRole, "tool" }, { SummaryRole, "summary" }, { SessionRole, "sessionId" }, { DurationRole, "durationMs" },
             { OkRole, "ok" }, { SourceRole, "source" }, { SimulatedRole, "simulated" }, { ProvenanceRole, "provenance" },
             { FilesRole, "files" }, { ColorRole, "agentColor" }, { AgentRole, "agentType" }, { TestRole, "testRun" } };
}

QVariant EventListModel::data(const QModelIndex &index, int role) const
{
    if (!index.isValid() || index.row() >= int(m_rows.size()))
        return {};
    const int ei = m_rows[size_t(index.row())];
    if (ei < m_engine->eventBase() || ei >= m_engine->eventEnd())
        return {};
    const NexusEvent &e = m_engine->event(ei);
    switch (role) {
    case IndexRole: return ei;
    case TsRole: return e.ts;
    case KindRole: return e.kind;
    case CategoryRole: return e.category;
    case ToolRole: return e.toolName;
    case SummaryRole: return e.summary;
    case SessionRole: return e.sessionId;
    case DurationRole: return e.durationMs;
    case OkRole: return e.ok;
    case SourceRole: return NexusEvent::sourceName(e.source);
    case SimulatedRole: return e.simulated;
    case ProvenanceRole: return NexusEvent::provenanceName(e.provenance);
    case FilesRole: return e.files;
    case ColorRole: return m_engine->colorForSession(e.sessionId);
    case AgentRole: return e.agentType;
    case TestRole: return e.testRun;
    default: return {};
    }
}

bool EventListModel::accepts(int ei) const
{
    const NexusEvent &e = m_engine->event(ei);
    if (e.kind == QLatin1String("status.update"))
        return false;  // shown in session intelligence, too chatty for the stream
    if (!m_session.isEmpty() && e.sessionId != m_session) return false;
    if (m_until > 0 && e.ts > m_until) return false;
    if (!m_category.isEmpty()) {
        if (m_category == QLatin1String("errors")) { if (e.ok != 0) return false; }
        else if (m_category == QLatin1String("lifecycle")) { if (e.isTool()) return false; }
        else if (m_category == QLatin1String("tests")) { if (!e.testRun) return false; }
        else if (e.category != m_category) return false;
    }
    if (!m_text.isEmpty() && !e.summary.contains(m_text, Qt::CaseInsensitive)
        && !e.files.join(QLatin1Char(' ')).contains(m_text, Qt::CaseInsensitive))
        return false;
    // hide PreToolUse rows once the paired Post exists; the stream shows completed calls
    return true;
}

void EventListModel::appended(int first, int last)
{
    std::vector<int> add;
    for (int i = last; i >= first; --i)
        if (accepts(i)) add.push_back(i);
    if (add.empty()) return;
    beginInsertRows({}, 0, int(add.size()) - 1);
    m_rows.insert(m_rows.begin(), add.begin(), add.end());
    endInsertRows();
    if (m_rows.size() > 4000) {
        beginRemoveRows({}, 4000, int(m_rows.size()) - 1);
        m_rows.resize(4000);
        endRemoveRows();
    }
    emit countChanged();
}

void EventListModel::updatedAt(int eventIndex)
{
    for (size_t r = 0; r < std::min<size_t>(m_rows.size(), 200); ++r) {
        if (m_rows[r] == eventIndex) {
            emit dataChanged(index(int(r)), index(int(r)));
            return;
        }
    }
}

void EventListModel::rebuild()
{
    beginResetModel();
    m_rows.clear();
    for (int i = m_engine->eventEnd() - 1; i >= m_engine->eventBase() && m_rows.size() < 4000; --i)
        if (accepts(i)) m_rows.push_back(i);
    endResetModel();
    emit countChanged();
}

void EventListModel::setSessionFilter(const QString &s) { if (s != m_session) { m_session = s; rebuild(); emit filterChanged(); } }
void EventListModel::setCategoryFilter(const QString &c) { if (c != m_category) { m_category = c; rebuild(); emit filterChanged(); } }
void EventListModel::setTextFilter(const QString &t) { if (t != m_text) { m_text = t; rebuild(); emit filterChanged(); } }
void EventListModel::setUntilTs(qint64 t) { if (t != m_until) { m_until = t; rebuild(); emit filterChanged(); } }

// =========================================================================== engine

SessionEngine::SessionEngine(QObject *parent)
    : QObject(parent), m_sessionModel(this), m_eventModel(this)
{
    m_tick.setInterval(500);
    connect(&m_tick, &QTimer::timeout, this, &SessionEngine::tick);
    m_tick.start();
}

const SessionRecord *SessionEngine::session(const QString &id) const
{
    auto it = m_sessions.find(id);
    return it == m_sessions.end() ? nullptr : it->second.get();
}

QStringList SessionEngine::sessionIds() const
{
    QStringList out;
    for (const auto &[id, s] : m_sessions) out.append(id);
    return out;
}

int SessionEngine::liveSessionCount() const
{
    int n = 0;
    for (const auto &[id, s] : m_sessions)
        if (s->state != AgentState::Ended && s->state != AgentState::Stale && s->processAlive) ++n;
    return n;
}

bool SessionEngine::hasSimulated() const
{
    for (const auto &[id, s] : m_sessions)
        if (s->simulated) return true;
    return false;
}

QString SessionEngine::colorForSession(const QString &id) const
{
    const SessionRecord *s = session(id);
    return s ? colorHex(s->colorIndex) : QStringLiteral("#62738b");
}

void SessionEngine::setActiveSession(const QString &id)
{
    if (id == m_active) return;
    m_active = id;
    emit activeSessionChanged();
}

void SessionEngine::markLaunchedByNexus(const QString &sessionId)
{
    auto it = m_sessions.find(sessionId);
    if (it != m_sessions.end()) it->second->launchedByNexus = true;
}

SessionRecord &SessionEngine::sessionFor(const NexusEvent &e)
{
    const QString id = e.sessionId.isEmpty() ? QStringLiteral("unattributed") : e.sessionId;
    auto it = m_sessions.find(id);
    if (it != m_sessions.end())
        return *it->second;
    auto rec = std::make_unique<SessionRecord>();
    rec->id = id;
    rec->simulated = e.simulated;
    rec->firstTs = e.ts;
    rec->colorIndex = m_nextColor++;
    rec->ring = m_nextRing++ % 6;
    rec->state = AgentState::Idle;
    rec->stateProvenance = Prov::Inferred;
    rec->stateDetail = QStringLiteral("first seen");
    rec->stateSince = e.ts;
    SessionRecord &ref = *rec;
    m_sessions.emplace(id, std::move(rec));
    m_sessionModel.reset();
    emit sessionsChanged();
    emit agentsChanged();
    return ref;
}

void SessionEngine::setState(SessionRecord &s, AgentState st, Prov p, const QString &detail, qint64 ts)
{
    if (s.state != st)
        s.stateSince = ts;
    s.state = st;
    s.stateProvenance = p;
    s.stateDetail = detail;
}

void SessionEngine::ingest(const core::EventList &events, bool live)
{
    if (events.isEmpty()) return;
    for (const NexusEvent &e : events)
        ingestOne(e, live);
}

void SessionEngine::ingestOne(const NexusEvent &eIn, bool live)
{
    NexusEvent e = eIn;
    if (e.kind == QLatin1String("system.setup_test") || e.sessionId.isEmpty()) {
        // events that belong to no session are logged but never create a session
        m_events.push_back(e);
        const int idx = eventEnd() - 1;
        m_eventModel.appended(idx, idx);
        emit eventIngested(e, idx, live);
        emit eventsChanged();
        return;
    }
    m_events.push_back(e);
    const int idx = eventEnd() - 1;
    SessionRecord &s = sessionFor(e);
    apply(s, m_events.back(), idx, live);

    if (int(m_events.size()) > kMaxEvents) {
        for (int k = 0; k < kTrimBy; ++k) m_events.pop_front();
        m_eventBase += kTrimBy;
        m_eventModel.rebuild();
    } else {
        m_eventModel.appended(idx, idx);
    }
    if (live && e.isTool()) {
        m_recentLive.push_back(e.recvTs ? e.recvTs : e.ts);
    }
    m_sessionModel.sessionChanged(s.id);
    bump();
    emit sessionUpdated(s.id);
    emit eventIngested(m_events.back(), idx, live);
    emit eventsChanged();
}

void SessionEngine::apply(SessionRecord &s, const NexusEvent &e, int idx, bool live)
{
    s.lastTs = std::max(s.lastTs, e.ts);
    if (s.firstTs == 0 || e.ts < s.firstTs) s.firstTs = e.ts;
    if (!e.cwd.isEmpty() && s.cwd.isEmpty()) s.cwd = e.cwd;
    if (e.claudePid > 1 && e.source == NexusEvent::Source::Hook) s.claudePid = e.claudePid;
    if (e.simulated) s.simulated = true;
    if (s.state == AgentState::Stale) setState(s, AgentState::Idle, Prov::Inferred, QStringLiteral("activity resumed"), e.ts);
    const QJsonObject &p = e.payload;
    if (s.permissionMode.isEmpty() || p.contains(QStringLiteral("permission_mode")))
        s.permissionMode = p.value(QStringLiteral("permission_mode")).toString(s.permissionMode);

    // Subagent attribution
    if (!e.agentId.isEmpty()) {
        SubAgent &sa = s.subagents[e.agentId];
        sa.id = e.agentId;
        if (sa.type.isEmpty()) sa.type = e.agentType;
        if (sa.start == 0) sa.start = e.ts;
        if (e.kind == QLatin1String("tool.post") || e.kind == QLatin1String("tool.fail")) ++sa.toolCount;
    }

    const QString &k = e.kind;
    // permission-wait intervals (observed start, derived end)
    const bool waitBegins = k == QLatin1String("permission.request")
        || (k == QLatin1String("notification") && p.value(QStringLiteral("notification_type")).toString() == QLatin1String("permission_prompt"));
    if (waitBegins) {
        if (s.waitStart == 0) s.waitStart = e.ts;
    } else if (s.waitStart > 0 && (e.isTool() || k.startsWith(QLatin1String("turn.")) || k == QLatin1String("session.end")
                                   || k == QLatin1String("prompt.submit") || k == QLatin1String("permission.denied"))) {
        s.waits.push_back({ s.waitStart, e.ts });
        s.waitStart = 0;
    }
    if (k == QLatin1String("session.start")) {
        s.model = p.value(QStringLiteral("model")).toString(s.model);
        const QString title = p.value(QStringLiteral("session_title")).toString();
        if (!title.isEmpty()) s.title = title;
        setState(s, AgentState::Idle, Prov::Observed, QStringLiteral("session started (%1)").arg(p.value(QStringLiteral("source")).toString(QStringLiteral("startup"))), e.ts);
        s.milestones.push_back({ e.ts, QStringLiteral("start"), e.summary, idx });
        s.processAlive = true;
    } else if (k == QLatin1String("session.end")) {
        setState(s, AgentState::Ended, Prov::Observed, p.value(QStringLiteral("reason")).toString(), e.ts);
        s.milestones.push_back({ e.ts, QStringLiteral("end"), e.summary, idx });
        emit agentsChanged();
    } else if (k == QLatin1String("prompt.submit")) {
        ++s.prompts;
        s.currentTask = firstLine(p.value(QStringLiteral("prompt")).toString(), 220);
        setState(s, AgentState::Running, Prov::Derived, QStringLiteral("processing prompt"), e.ts);
        s.milestones.push_back({ e.ts, QStringLiteral("prompt"), firstLine(s.currentTask, 80), idx });
    } else if (k == QLatin1String("tool.pre")) {
        ToolCall tc;
        tc.toolUseId = e.toolUseId;
        tc.toolName = e.toolName;
        tc.category = e.category;
        tc.summary = e.summary;
        tc.command = e.command;
        tc.files = e.files;
        tc.start = e.ts;
        tc.testRun = e.testRun;
        tc.agentId = e.agentId;
        tc.eventStart = idx;
        if (!e.toolUseId.isEmpty())
            s.openCalls.insert(e.toolUseId, int(s.toolCalls.size()));
        s.toolCalls.push_back(tc);
        setState(s, AgentState::ExecutingTool, Prov::Observed, e.summary, e.ts);
    } else if (k == QLatin1String("tool.post") || k == QLatin1String("tool.fail")) {
        int ci = -1;
        if (!e.toolUseId.isEmpty()) {
            auto open = s.openCalls.find(e.toolUseId);
            if (open != s.openCalls.end()) {
                ci = open.value();
                s.openCalls.erase(open);
            }
        }
        if (ci < 0 || ci >= int(s.toolCalls.size())) {
            // no matching PreToolUse (hook installed mid-call or Pre not configured)
            ToolCall tc;
            tc.toolUseId = e.toolUseId;
            tc.toolName = e.toolName;
            tc.category = e.category;
            tc.files = e.files;
            tc.command = e.command;
            tc.testRun = e.testRun;
            tc.agentId = e.agentId;
            tc.start = e.durationMs > 0 ? e.ts - e.durationMs : e.ts;
            tc.eventStart = idx;
            s.toolCalls.push_back(tc);
            ci = int(s.toolCalls.size()) - 1;
        }
        ToolCall &tc = s.toolCalls[size_t(ci)];
        tc.end = e.ts;
        tc.eventEnd = idx;
        tc.ok = e.ok;
        tc.summary = e.summary;
        tc.error = e.error;
        if (e.durationMs >= 0) { tc.durationMs = e.durationMs; tc.durationObserved = true; }
        else tc.durationMs = std::max<qint64>(0, tc.end - tc.start);
        if (e.durationMs < 0 && idx >= 0) {
            // derived duration: annotate the stored event
            m_events.back().durationMs = tc.durationMs;
            m_events.back().provenance = Prov::Derived;
        }
        ++s.toolCount;
        s.toolsUsed[e.toolName] += 1;
        const QString &cat = e.category;
        for (const QString &f : e.files) {
            if (cat == QLatin1String("write")) s.filesWritten[f] += 1;
            else if (cat == QLatin1String("read")) s.filesRead[f] += 1;
            s.fileLastTouch[f] = e.ts;
        }
        if (cat == QLatin1String("read")) ++s.reads;
        else if (cat == QLatin1String("write")) { ++s.writes; m_conflictsDirty = true; }
        else if (cat == QLatin1String("search")) ++s.searches;
        else if (cat == QLatin1String("exec")) {
            ++s.execs;
            if (!e.command.isEmpty()) {
                s.commands.append(e.command);
                if (s.commands.size() > 80) s.commands.removeFirst();
            }
        }
        if (e.testRun) {
            ++s.testRuns;
            if (e.ok == 0) ++s.testFailures;
        }
        if (e.ok == 0) {
            ++s.errors;
            if (live && !e.simulated)
                emit notify(QStringLiteral("error"), e.toolName + QStringLiteral(" failed"), firstLine(e.error, 160));
        }
        if (s.state == AgentState::ExecutingTool || s.state == AgentState::WaitingPermission || s.state == AgentState::Idle
            || s.state == AgentState::Completed)
            setState(s, AgentState::Running, Prov::Derived, QStringLiteral("between tool calls"), e.ts);
    } else if (k == QLatin1String("permission.request")) {
        ++s.permissionRequests;
        setState(s, AgentState::WaitingPermission, Prov::Observed, e.summary, e.ts);
        if (live && !e.simulated)
            emit notify(QStringLiteral("attention"), QStringLiteral("Permission requested"), e.summary);
    } else if (k == QLatin1String("permission.denied")) {
        s.milestones.push_back({ e.ts, QStringLiteral("failure"), e.summary, idx });
    } else if (k == QLatin1String("notification")) {
        const QString nt = p.value(QStringLiteral("notification_type")).toString();
        if (nt == QLatin1String("permission_prompt"))
            setState(s, AgentState::WaitingPermission, Prov::Observed, e.summary, e.ts);
        else if (nt == QLatin1String("idle_prompt"))
            setState(s, AgentState::AwaitingInput, Prov::Observed, e.summary, e.ts);
    } else if (k == QLatin1String("turn.stop")) {
        ++s.turns;
        s.lastAssistantMessage = p.value(QStringLiteral("last_assistant_message")).toString(s.lastAssistantMessage);
        setState(s, AgentState::Completed, Prov::Observed, QStringLiteral("turn complete — waiting for the next prompt"), e.ts);
        s.milestones.push_back({ e.ts, QStringLiteral("turn"), firstLine(s.lastAssistantMessage, 80), idx });
        s.openCalls.clear();
    } else if (k == QLatin1String("turn.fail")) {
        ++s.errors;
        setState(s, AgentState::Failed, Prov::Observed, e.error, e.ts);
        s.milestones.push_back({ e.ts, QStringLiteral("failure"), e.summary, idx });
        if (live && !e.simulated)
            emit notify(QStringLiteral("error"), QStringLiteral("Turn failed"), e.summary);
    } else if (k == QLatin1String("subagent.stop")) {
        if (!e.agentId.isEmpty()) s.subagents[e.agentId].end = e.ts;
        s.milestones.push_back({ e.ts, QStringLiteral("subagent"), e.summary, idx });
    } else if (k == QLatin1String("subagent.start")) {
        s.milestones.push_back({ e.ts, QStringLiteral("subagent"), e.summary, idx });
    } else if (k == QLatin1String("task.completed") || k == QLatin1String("task.created")) {
        s.milestones.push_back({ e.ts, QStringLiteral("task"), e.summary, idx });
    } else if (k == QLatin1String("compact.post")) {
        ++s.compactions;
        s.milestones.push_back({ e.ts, QStringLiteral("compact"), e.summary, idx });
    } else if (k == QLatin1String("instructions.loaded")) {
        for (const QString &f : e.files)
            if (!s.instructionFiles.contains(f)) s.instructionFiles.append(f);
    } else if (k == QLatin1String("model.switch")) {
        s.model = p.value(QStringLiteral("to_model")).toString(s.model);
    } else if (k == QLatin1String("status.update")) {
        ContextInfo &c = s.context;
        const QJsonObject cw = p.value(QStringLiteral("context_window")).toObject();
        c.available = true;
        c.source = QStringLiteral("status line");
        c.updatedTs = e.ts;
        if (cw.value(QStringLiteral("used_percentage")).isDouble()) c.usedPercentage = cw.value(QStringLiteral("used_percentage")).toDouble();
        c.windowSize = cw.value(QStringLiteral("context_window_size")).toInteger(c.windowSize);
        c.inputTokens = cw.value(QStringLiteral("total_input_tokens")).toInteger(c.inputTokens);
        c.outputTokens = cw.value(QStringLiteral("total_output_tokens")).toInteger(c.outputTokens);
        const QJsonObject cu = cw.value(QStringLiteral("current_usage")).toObject();
        c.cacheReadTokens = cu.value(QStringLiteral("cache_read_input_tokens")).toInteger(c.cacheReadTokens);
        c.cacheCreationTokens = cu.value(QStringLiteral("cache_creation_input_tokens")).toInteger(c.cacheCreationTokens);
        const QJsonObject cost = p.value(QStringLiteral("cost")).toObject();
        if (cost.contains(QStringLiteral("total_cost_usd"))) c.costUsd = cost.value(QStringLiteral("total_cost_usd")).toDouble();
        const QJsonObject rl = p.value(QStringLiteral("rate_limits")).toObject();
        if (rl.contains(QStringLiteral("five_hour"))) c.rate5h = rl.value(QStringLiteral("five_hour")).toObject().value(QStringLiteral("used_percentage")).toDouble(-1);
        if (rl.contains(QStringLiteral("seven_day"))) c.rate7d = rl.value(QStringLiteral("seven_day")).toObject().value(QStringLiteral("used_percentage")).toDouble(-1);
        c.model = p.value(QStringLiteral("model")).toObject().value(QStringLiteral("display_name")).toString(c.model);
        if (!c.model.isEmpty()) s.model = c.model;
    } else if (k == QLatin1String("stream.init")) {
        s.model = p.value(QStringLiteral("model")).toString(s.model);
        s.launchedByNexus = true;
        setState(s, AgentState::Running, Prov::Observed, QStringLiteral("headless session started"), e.ts);
    } else if (k == QLatin1String("stream.message")) {
        s.lastAssistantMessage = p.value(QStringLiteral("text")).toString().left(4000);
        const QJsonObject u = p.value(QStringLiteral("usage")).toObject();
        if (!u.isEmpty()) {
            ContextInfo &c = s.context;
            c.available = true;
            c.source = QStringLiteral("stream-json");
            c.updatedTs = e.ts;
            c.inputTokens = u.value(QStringLiteral("input_tokens")).toInteger() + u.value(QStringLiteral("cache_read_input_tokens")).toInteger()
                            + u.value(QStringLiteral("cache_creation_input_tokens")).toInteger();
            c.outputTokens = u.value(QStringLiteral("output_tokens")).toInteger();
            c.cacheReadTokens = u.value(QStringLiteral("cache_read_input_tokens")).toInteger();
            c.cacheCreationTokens = u.value(QStringLiteral("cache_creation_input_tokens")).toInteger();
        }
    } else if (k == QLatin1String("stream.result")) {
        if (p.contains(QStringLiteral("total_cost_usd"))) { s.context.costUsd = p.value(QStringLiteral("total_cost_usd")).toDouble(); s.context.available = true; }
        setState(s, e.ok == 0 ? AgentState::Failed : AgentState::Completed, Prov::Observed, e.summary, e.ts);
        s.milestones.push_back({ e.ts, e.ok == 0 ? QStringLiteral("failure") : QStringLiteral("turn"), e.summary, idx });
    }
}

void SessionEngine::tick()
{
    const qint64 now = QDateTime::currentMSecsSinceEpoch();
    // event rate over the last 10 s of live tool events
    while (!m_recentLive.empty() && now - m_recentLive.front() > 10000) m_recentLive.pop_front();
    const qreal rate = qreal(m_recentLive.size()) / 10.0;
    int active = 0, waiting = 0;
    bool agentsDirty = false;
    for (auto &[id, s] : m_sessions) {
        if (s->claudePid > 1 && !s->simulated && s->state != AgentState::Ended) {
            const bool alive = processAlive(s->claudePid);
            if (!alive && s->processAlive) {
                s->processAlive = false;
                setState(*s, AgentState::Ended, Prov::Inferred, QStringLiteral("Claude Code process %1 is no longer running").arg(s->claudePid), now);
                m_sessionModel.sessionChanged(id);
                agentsDirty = true;
            }
        }
        if (s->state != AgentState::Ended && s->state != AgentState::Stale && now - s->lastTs > kStaleMs) {
            setState(*s, AgentState::Stale, Prov::Inferred, QStringLiteral("no events for 30 minutes"), now);
            m_sessionModel.sessionChanged(id);
            agentsDirty = true;
        }
        if (s->state == AgentState::Running || s->state == AgentState::ExecutingTool) ++active;
        if (s->state == AgentState::WaitingPermission) ++waiting;
    }
    const qreal target = std::clamp(0.12 + 0.28 * active + 0.10 * waiting + 0.06 * rate, 0.0, 1.0);
    if (std::abs(target - m_activity) > 0.005 || std::abs(rate - m_rate) > 0.01) {
        m_activity = target;
        m_rate = rate;
        emit activityChanged();
    }
    if (agentsDirty) {
        bump();
        emit agentsChanged();
        emit sessionsChanged();
    }
    if (m_conflictsDirty) {
        m_conflictsDirty = false;
        recomputeConflicts();
    }
}

void SessionEngine::recomputeConflicts()
{
    // A conflict: the same file written by two or more distinct sessions within 2 hours.
    // An overlap: the same file read or written by two or more sessions.
    const qint64 now = QDateTime::currentMSecsSinceEpoch();
    QHash<QString, QStringList> writers, touchers;
    for (const auto &[id, s] : m_sessions) {
        if (s->state == AgentState::Ended && now - s->lastTs > 2 * 3600 * 1000) continue;
        for (auto it = s->filesWritten.cbegin(); it != s->filesWritten.cend(); ++it)
            if (now - s->fileLastTouch.value(it.key()) < 2 * 3600 * 1000) writers[it.key()].append(id);
        for (auto it = s->fileLastTouch.cbegin(); it != s->fileLastTouch.cend(); ++it)
            touchers[it.key()].append(id);
    }
    QVariantList out;
    for (auto it = writers.cbegin(); it != writers.cend(); ++it) {
        if (it.value().size() < 2) continue;
        out.append(QVariantMap{ { QStringLiteral("path"), it.key() }, { QStringLiteral("sessions"), it.value() }, { QStringLiteral("type"), QStringLiteral("conflict") } });
    }
    for (auto it = touchers.cbegin(); it != touchers.cend(); ++it) {
        if (it.value().size() < 2 || writers.value(it.key()).size() >= 2) continue;
        out.append(QVariantMap{ { QStringLiteral("path"), it.key() }, { QStringLiteral("sessions"), it.value() }, { QStringLiteral("type"), QStringLiteral("overlap") } });
    }
    if (out != m_conflicts) {
        m_conflicts = out;
        emit conflictsChanged();
    }
}

void SessionEngine::clearSimulated()
{
    std::vector<QString> drop;
    for (const auto &[id, s] : m_sessions)
        if (s->simulated) drop.push_back(id);
    for (const QString &id : drop) m_sessions.erase(id);
    std::deque<NexusEvent> kept;
    for (const NexusEvent &e : m_events)
        if (!e.simulated) kept.push_back(e);
    m_events.swap(kept);
    m_eventBase = 0;
    m_eventModel.rebuild();
    m_sessionModel.reset();
    if (!m_active.isEmpty() && !session(m_active)) setActiveSession(QString());
    emit sessionsChanged();
    emit eventsChanged();
    emit agentsChanged();
    recomputeConflicts();
}

QString SessionEngine::primarySession() const
{
    if (!m_active.isEmpty() && session(m_active))
        return m_active;
    const SessionRecord *best = nullptr;
    for (const auto &[id, s] : m_sessions) {
        if (id == QLatin1String("unattributed") || s->state == AgentState::Ended || s->state == AgentState::Stale)
            continue;
        if (!best || s->lastTs > best->lastTs) best = s.get();
    }
    return best ? best->id : QString();
}

QStringList SessionEngine::instructionFiles() const
{
    QStringList out;
    for (const auto &[id, s] : m_sessions)
        for (const QString &f : s->instructionFiles)
            if (!out.contains(f)) out.append(f);
    return out;
}

QVariantMap SessionEngine::sessionInfo(const QString &id) const
{
    QVariantMap m;
    const SessionRecord *s = session(id);
    if (!s) return m;
    const qint64 now = QDateTime::currentMSecsSinceEpoch();
    m.insert(QStringLiteral("id"), s->id);
    m.insert(QStringLiteral("title"), s->title);
    m.insert(QStringLiteral("cwd"), s->cwd);
    m.insert(QStringLiteral("project"), QFileInfo(s->cwd).fileName());
    m.insert(QStringLiteral("model"), s->model.isEmpty() ? QStringLiteral("not reported") : s->model);
    m.insert(QStringLiteral("permissionMode"), s->permissionMode);
    m.insert(QStringLiteral("pid"), s->claudePid);
    m.insert(QStringLiteral("alive"), s->processAlive);
    m.insert(QStringLiteral("simulated"), s->simulated);
    m.insert(QStringLiteral("launched"), s->launchedByNexus);
    m.insert(QStringLiteral("state"), stateName(s->state));
    m.insert(QStringLiteral("stateLabel"), stateLabel(s->state));
    m.insert(QStringLiteral("stateProvenance"), NexusEvent::provenanceName(s->stateProvenance));
    m.insert(QStringLiteral("stateDetail"), s->stateDetail);
    m.insert(QStringLiteral("stateSince"), s->stateSince);
    m.insert(QStringLiteral("firstTs"), s->firstTs);
    m.insert(QStringLiteral("lastTs"), s->lastTs);
    m.insert(QStringLiteral("elapsedMs"), (s->state == AgentState::Ended ? s->lastTs : now) - s->firstTs);
    m.insert(QStringLiteral("task"), s->currentTask);
    m.insert(QStringLiteral("lastMessage"), s->lastAssistantMessage.left(1200));
    m.insert(QStringLiteral("color"), colorHex(s->colorIndex));
    m.insert(QStringLiteral("prompts"), s->prompts);
    m.insert(QStringLiteral("turns"), s->turns);
    m.insert(QStringLiteral("tools"), s->toolCount);
    m.insert(QStringLiteral("reads"), s->reads);
    m.insert(QStringLiteral("writes"), s->writes);
    m.insert(QStringLiteral("searches"), s->searches);
    m.insert(QStringLiteral("execs"), s->execs);
    m.insert(QStringLiteral("errors"), s->errors);
    m.insert(QStringLiteral("testRuns"), s->testRuns);
    m.insert(QStringLiteral("testFailures"), s->testFailures);
    m.insert(QStringLiteral("permissionRequests"), s->permissionRequests);
    m.insert(QStringLiteral("compactions"), s->compactions);
    QSet<QString> files;
    for (auto it = s->filesRead.cbegin(); it != s->filesRead.cend(); ++it) files.insert(it.key());
    for (auto it = s->filesWritten.cbegin(); it != s->filesWritten.cend(); ++it) files.insert(it.key());
    m.insert(QStringLiteral("filesTouched"), int(files.size()));
    m.insert(QStringLiteral("filesWritten"), int(s->filesWritten.size()));
    QVariantList tools;
    QList<QPair<int, QString>> tu;
    for (auto it = s->toolsUsed.cbegin(); it != s->toolsUsed.cend(); ++it) tu.append({ it.value(), it.key() });
    std::sort(tu.begin(), tu.end(), [](const auto &a, const auto &b) { return a.first > b.first; });
    for (const auto &t : tu) tools.append(QVariantMap{ { QStringLiteral("name"), t.second }, { QStringLiteral("count"), t.first } });
    m.insert(QStringLiteral("toolsUsed"), tools);
    QVariantList cmds;
    for (int i = int(s->commands.size()) - 1; i >= 0 && cmds.size() < 12; --i) cmds.append(firstLine(s->commands[i], 160));
    m.insert(QStringLiteral("commands"), cmds);
    QVariantList ms;
    for (int i = int(s->milestones.size()) - 1; i >= 0 && ms.size() < 14; --i) {
        const Milestone &x = s->milestones[size_t(i)];
        ms.append(QVariantMap{ { QStringLiteral("ts"), x.ts }, { QStringLiteral("kind"), x.kind }, { QStringLiteral("label"), x.label }, { QStringLiteral("event"), x.eventIndex } });
    }
    m.insert(QStringLiteral("milestones"), ms);
    QVariantList subs;
    for (const SubAgent &sa : s->subagents)
        subs.append(QVariantMap{ { QStringLiteral("id"), sa.id }, { QStringLiteral("type"), sa.type }, { QStringLiteral("start"), sa.start },
                                 { QStringLiteral("end"), sa.end }, { QStringLiteral("tools"), sa.toolCount } });
    m.insert(QStringLiteral("subagents"), subs);
    QVariantList instr;
    for (const QString &f : s->instructionFiles) instr.append(f);
    m.insert(QStringLiteral("instructions"), instr);
    const ContextInfo &c = s->context;
    QVariantMap ctx{ { QStringLiteral("available"), c.available }, { QStringLiteral("source"), c.source },
                     { QStringLiteral("usedPercentage"), c.usedPercentage }, { QStringLiteral("windowSize"), c.windowSize },
                     { QStringLiteral("inputTokens"), c.inputTokens }, { QStringLiteral("outputTokens"), c.outputTokens },
                     { QStringLiteral("cacheReadTokens"), c.cacheReadTokens }, { QStringLiteral("cacheCreationTokens"), c.cacheCreationTokens },
                     { QStringLiteral("costUsd"), c.costUsd }, { QStringLiteral("rate5h"), c.rate5h }, { QStringLiteral("rate7d"), c.rate7d },
                     { QStringLiteral("updatedTs"), c.updatedTs } };
    m.insert(QStringLiteral("context"), ctx);
    // currently running tool, if any
    if (!s->openCalls.isEmpty()) {
        const int ci = *s->openCalls.cbegin();
        if (ci >= 0 && ci < int(s->toolCalls.size()))
            m.insert(QStringLiteral("runningTool"), s->toolCalls[size_t(ci)].summary);
    }
    return m;
}

QVariantMap SessionEngine::eventInfo(int ei) const
{
    QVariantMap m;
    if (ei < eventBase() || ei >= eventEnd()) return m;
    const NexusEvent &e = event(ei);
    m = e.toJson().toVariantMap();
    m.insert(QStringLiteral("eventIndex"), ei);
    m.insert(QStringLiteral("payloadText"), QString::fromUtf8(QJsonDocument(e.payload).toJson(QJsonDocument::Indented)).left(60000));
    m.insert(QStringLiteral("color"), colorForSession(e.sessionId));
    const QJsonObject in = e.payload.value(QStringLiteral("tool_input")).toObject();
    if (e.toolName == QLatin1String("Edit") && in.contains(QStringLiteral("old_string"))) {
        m.insert(QStringLiteral("diff"), lineDiff(in.value(QStringLiteral("old_string")).toString(), in.value(QStringLiteral("new_string")).toString()));
        m.insert(QStringLiteral("diffKind"), QStringLiteral("edit"));
    } else if (e.toolName == QLatin1String("MultiEdit")) {
        QVariantList all;
        for (const QJsonValue &v : in.value(QStringLiteral("edits")).toArray()) {
            const QJsonObject eo = v.toObject();
            all += lineDiff(eo.value(QStringLiteral("old_string")).toString(), eo.value(QStringLiteral("new_string")).toString());
            all.append(QVariantMap{ { QStringLiteral("t"), QStringLiteral("~") }, { QStringLiteral("s"), QStringLiteral("") } });
        }
        m.insert(QStringLiteral("diff"), all);
        m.insert(QStringLiteral("diffKind"), QStringLiteral("edit"));
    } else if (e.toolName == QLatin1String("Write") && in.contains(QStringLiteral("content"))) {
        m.insert(QStringLiteral("diff"), lineDiff(QString(), in.value(QStringLiteral("content")).toString()));
        m.insert(QStringLiteral("diffKind"), QStringLiteral("write"));
    }
    return m;
}

QVariantList SessionEngine::sessionFiles(const QString &id, int limit) const
{
    QVariantList out;
    const SessionRecord *s = session(id);
    if (!s) return out;
    QList<QPair<qint64, QString>> files;
    for (auto it = s->fileLastTouch.cbegin(); it != s->fileLastTouch.cend(); ++it) files.append({ it.value(), it.key() });
    std::sort(files.begin(), files.end(), [](const auto &a, const auto &b) { return a.first > b.first; });
    for (const auto &f : files) {
        out.append(QVariantMap{ { QStringLiteral("path"), f.second }, { QStringLiteral("name"), QFileInfo(f.second).fileName() },
                                { QStringLiteral("reads"), s->filesRead.value(f.second) }, { QStringLiteral("writes"), s->filesWritten.value(f.second) },
                                { QStringLiteral("last"), f.first } });
        if (out.size() >= limit) break;
    }
    return out;
}

QVariantList SessionEngine::touchedFiles(int limit) const
{
    QHash<QString, QVariantMap> agg;
    for (const auto &[id, s] : m_sessions) {
        for (auto it = s->fileLastTouch.cbegin(); it != s->fileLastTouch.cend(); ++it) {
            QVariantMap &m = agg[it.key()];
            m.insert(QStringLiteral("path"), it.key());
            m.insert(QStringLiteral("reads"), m.value(QStringLiteral("reads")).toInt() + s->filesRead.value(it.key()));
            m.insert(QStringLiteral("writes"), m.value(QStringLiteral("writes")).toInt() + s->filesWritten.value(it.key()));
            m.insert(QStringLiteral("last"), std::max(m.value(QStringLiteral("last")).toLongLong(), it.value()));
            QStringList sess = m.value(QStringLiteral("sessions")).toStringList();
            sess.append(id);
            m.insert(QStringLiteral("sessions"), sess);
            if (s->simulated) m.insert(QStringLiteral("simulated"), true);
        }
    }
    QVariantList out;
    QList<QVariantMap> v = agg.values();
    std::sort(v.begin(), v.end(), [](const QVariantMap &a, const QVariantMap &b) { return a.value(QStringLiteral("last")).toLongLong() > b.value(QStringLiteral("last")).toLongLong(); });
    for (const QVariantMap &m : v) {
        out.append(m);
        if (out.size() >= limit) break;
    }
    return out;
}

QVariantMap SessionEngine::fileActivity(const QString &absPath) const
{
    int reads = 0, writes = 0;
    qint64 last = 0;
    QStringList sessions;
    for (const auto &[id, s] : m_sessions) {
        const int r = s->filesRead.value(absPath), w = s->filesWritten.value(absPath);
        if (r || w) {
            reads += r;
            writes += w;
            last = std::max(last, s->fileLastTouch.value(absPath));
            sessions.append(id);
        }
    }
    return { { QStringLiteral("reads"), reads }, { QStringLiteral("writes"), writes }, { QStringLiteral("last"), last }, { QStringLiteral("sessions"), sessions } };
}

QVariantMap SessionEngine::heatByFile() const
{
    QHash<QString, int> counts;
    int maxC = 1;
    for (const auto &[id, s] : m_sessions) {
        for (auto it = s->filesRead.cbegin(); it != s->filesRead.cend(); ++it) maxC = std::max(maxC, counts[it.key()] += it.value());
        for (auto it = s->filesWritten.cbegin(); it != s->filesWritten.cend(); ++it) maxC = std::max(maxC, counts[it.key()] += 2 * it.value());
    }
    QVariantMap out;
    for (auto it = counts.cbegin(); it != counts.cend(); ++it)
        out.insert(it.key(), std::sqrt(double(it.value()) / double(maxC)));
    return out;
}

} // namespace nexus::session
