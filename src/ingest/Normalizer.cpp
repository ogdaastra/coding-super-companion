#include "Normalizer.h"

#include "core/Redactor.h"

#include <QDateTime>
#include <QJsonArray>
#include <QRegularExpression>
#include <QUuid>

namespace nexus::ingest {

using core::NexusEvent;
using core::Redactor;

QString Normalizer::kindForHookEvent(const QString &n)
{
    static const QHash<QString, QString> map = {
        { "SessionStart", "session.start" }, { "SessionEnd", "session.end" }, { "Setup", "session.setup" },
        { "UserPromptSubmit", "prompt.submit" }, { "UserPromptExpansion", "prompt.expand" },
        { "PreToolUse", "tool.pre" }, { "PostToolUse", "tool.post" }, { "PostToolUseFailure", "tool.fail" },
        { "PostToolBatch", "tool.batch" }, { "PermissionRequest", "permission.request" },
        { "PermissionDenied", "permission.denied" }, { "Notification", "notification" },
        { "SubagentStart", "subagent.start" }, { "SubagentStop", "subagent.stop" },
        { "TaskCreated", "task.created" }, { "TaskCompleted", "task.completed" },
        { "Stop", "turn.stop" }, { "StopFailure", "turn.fail" }, { "TeammateIdle", "teammate.idle" },
        { "PreCompact", "compact.pre" }, { "PostCompact", "compact.post" }, { "CwdChanged", "cwd.changed" },
        { "FileChanged", "file.changed" }, { "InstructionsLoaded", "instructions.loaded" },
        { "ConfigChange", "config.change" }, { "PostModelSwitch", "model.switch" }, { "PreModelSwitch", "model.switch.pre" },
        { "WorktreeCreate", "worktree.create" }, { "WorktreeRemove", "worktree.remove" },
        { "Elicitation", "elicitation" }, { "ElicitationResult", "elicitation.result" },
        { "DirectoryAdded", "directory.added" }, { "MessageDisplay", "message.display" },
        { "NexusSetupTest", "system.setup_test" },
        { "NexusMilestone", "agent.milestone" },
    };
    return map.value(n, QStringLiteral("unknown"));
}

QString Normalizer::toolCategory(const QString &t)
{
    if (t.startsWith(QLatin1String("mcp__"))) return QStringLiteral("mcp");
    static const QHash<QString, QString> map = {
        { "Read", "read" }, { "NotebookRead", "read" }, { "LS", "read" },
        { "Edit", "write" }, { "MultiEdit", "write" }, { "Write", "write" }, { "NotebookEdit", "write" },
        { "Grep", "search" }, { "Glob", "search" }, { "ToolSearch", "search" },
        { "Bash", "exec" }, { "PowerShell", "exec" }, { "BashOutput", "exec" }, { "KillShell", "exec" }, { "KillBash", "exec" },
        { "Monitor", "exec" },
        { "WebFetch", "web" }, { "WebSearch", "web" },
        { "Agent", "agent" }, { "Task", "agent" }, { "SendMessage", "agent" },
        { "TaskCreate", "task" }, { "TaskUpdate", "task" }, { "TaskList", "task" }, { "TaskGet", "task" },
        { "TodoWrite", "task" }, { "TaskStop", "task" },
    };
    return map.value(t, QStringLiteral("other"));
}

bool Normalizer::looksLikeTestCommand(const QString &command)
{
    static const QRegularExpression re(QStringLiteral(
        R"re((^|[\s;&|(])(pytest|py\.test|ctest|jest|vitest|mocha|karma|phpunit|rspec|tox|nox)\b|)re"
        R"re((^|[\s;&|(])(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|)re"
        R"re((^|[\s;&|(])(cargo|go|dotnet|swift|deno|mix|zig)\s+test\b|)re"
        R"re((^|[\s;&|(])(mvn|mvnw|\./mvnw)\s+(\S+\s+)*test\b|)re"
        R"re((^|[\s;&|(])(gradle|gradlew|\./gradlew)\s+(\S+\s+)*(test|check)\b|)re"
        R"re((^|[\s;&|(])make\s+(test|check)\b|)re"
        R"re(python3?\s+-m\s+(pytest|unittest)\b|)re"
        R"re((^|[\s;&|(])ninja\s+(-C\s+\S+\s+)?test\b)re"));
    return re.match(command).hasMatch();
}

QString Normalizer::shortPath(const QString &path, const QString &cwd)
{
    if (path.isEmpty()) return path;
    QString p = path;
    if (!cwd.isEmpty() && p.startsWith(cwd + QLatin1Char('/')))
        p = p.mid(cwd.size() + 1);
    const QStringList parts = p.split(QLatin1Char('/'), Qt::SkipEmptyParts);
    if (parts.size() > 3)
        return QStringLiteral("…/") + parts.mid(parts.size() - 3).join(QLatin1Char('/'));
    return p;
}

QJsonObject Normalizer::capPayload(const QJsonObject &payload)
{
    QJsonObject out;
    for (auto it = payload.begin(); it != payload.end(); ++it) {
        const QString &k = it.key();
        int cap = 8192;
        if (k == QLatin1String("tool_input")) cap = 65536;          // keeps per-event diffs (Edit/Write)
        else if (k == QLatin1String("tool_response")) cap = 2048;   // file contents are not kept
        else if (k == QLatin1String("tool_calls")) cap = 1024;
        if (Redactor::isSecretKeyName(k) && (it.value().isString() || it.value().isDouble()))
            out.insert(k, QStringLiteral("[REDACTED]"));
        else
            out.insert(k, Redactor::redactJson(it.value(), cap, 1));
    }
    return out;
}

namespace {

QString firstLine(const QString &s, int max = 140)
{
    QString l = s.section(QLatin1Char('\n'), 0, 0).trimmed();
    if (l.size() > max) l = l.left(max - 1) + QStringLiteral("…");
    return l;
}

} // namespace

NexusEvent Normalizer::fromHook(const QJsonObject &p, qint64 capturedMs, int parentPid)
{
    NexusEvent e;
    e.id = QUuid::createUuid().toString(QUuid::WithoutBraces);
    e.recvTs = QDateTime::currentMSecsSinceEpoch();
    e.ts = capturedMs > 0 ? capturedMs : e.recvTs;
    e.source = NexusEvent::Source::Hook;
    const QString hookName = p.value(QStringLiteral("hook_event_name")).toString();
    e.kind = kindForHookEvent(hookName);
    e.sessionId = p.value(QStringLiteral("session_id")).toString();
    e.agentId = p.value(QStringLiteral("agent_id")).toString();
    e.agentType = p.value(QStringLiteral("agent_type")).toString();
    e.cwd = p.value(QStringLiteral("cwd")).toString();
    e.claudePid = parentPid;
    e.toolName = p.value(QStringLiteral("tool_name")).toString();
    e.toolUseId = p.value(QStringLiteral("tool_use_id")).toString();
    if (p.contains(QStringLiteral("duration_ms")))
        e.durationMs = p.value(QStringLiteral("duration_ms")).toInteger();

    const QJsonObject in = p.value(QStringLiteral("tool_input")).toObject();
    const QJsonObject resp = p.value(QStringLiteral("tool_response")).toObject();
    if (!e.toolName.isEmpty()) {
        e.category = toolCategory(e.toolName);
        for (const char *key : { "file_path", "notebook_path", "path" }) {
            const QString v = in.value(QLatin1String(key)).toString();
            if (!v.isEmpty() && !e.files.contains(v)) e.files.append(v);
        }
        const QString respPath = resp.value(QStringLiteral("filePath")).toString();
        if (!respPath.isEmpty() && !e.files.contains(respPath)) e.files.append(respPath);
        if (e.category == QLatin1String("exec"))
            e.command = Redactor::redact(in.value(QStringLiteral("command")).toString());
    }
    // A relative path from a hook is relative to the hook's cwd.
    for (QString &f : e.files)
        if (!f.startsWith(QLatin1Char('/')) && !(f.size() > 1 && f[1] == QLatin1Char(':')) && !e.cwd.isEmpty())
            f = e.cwd + QLatin1Char('/') + f;

    if (e.kind == QLatin1String("tool.post")) e.ok = 1;
    if (e.kind == QLatin1String("tool.fail")) {
        e.ok = 0;
        e.error = Redactor::redact(p.value(QStringLiteral("error")).toString()).left(4096);
    }
    if (e.kind == QLatin1String("turn.fail")) {
        e.ok = 0;
        e.error = Redactor::redact(p.value(QStringLiteral("error")).toString() + QStringLiteral(": ")
                                   + p.value(QStringLiteral("error_details")).toString()).left(4096);
    }
    if (e.kind == QLatin1String("turn.stop")) e.ok = 1;
    if (!e.command.isEmpty() && looksLikeTestCommand(e.command)) {
        e.testRun = true;  // inferred from the observed command
    }

    // Human-readable summary
    const QString file = e.files.isEmpty() ? QString() : shortPath(e.files.first(), e.cwd);
    if (e.isTool()) {
        QString what;
        if (e.category == QLatin1String("exec") && !e.command.isEmpty())
            what = firstLine(e.command, 120);
        else if (e.toolName == QLatin1String("Grep"))
            what = QStringLiteral("\"%1\"%2").arg(firstLine(in.value(QStringLiteral("pattern")).toString(), 60),
                                                  file.isEmpty() ? QString() : QStringLiteral(" in ") + file);
        else if (e.toolName == QLatin1String("Glob"))
            what = firstLine(in.value(QStringLiteral("pattern")).toString(), 80);
        else if (e.category == QLatin1String("web"))
            what = firstLine(in.value(e.toolName == QLatin1String("WebSearch") ? QStringLiteral("query") : QStringLiteral("url")).toString(), 100);
        else if (e.category == QLatin1String("agent"))
            what = firstLine(in.value(QStringLiteral("description")).toString(), 100);
        else
            what = file;
        const QString verb = e.kind == QLatin1String("tool.pre") ? QString()
                           : e.kind == QLatin1String("tool.fail") ? QStringLiteral(" — failed") : QString();
        e.summary = e.toolName + (what.isEmpty() ? QString() : QStringLiteral("  ") + what) + verb;
    } else if (e.kind == QLatin1String("session.start")) {
        e.summary = QStringLiteral("Session started (%1)").arg(p.value(QStringLiteral("source")).toString(QStringLiteral("startup")));
    } else if (e.kind == QLatin1String("session.end")) {
        e.summary = QStringLiteral("Session ended (%1)").arg(p.value(QStringLiteral("reason")).toString(QStringLiteral("other")));
    } else if (e.kind == QLatin1String("prompt.submit")) {
        e.summary = QStringLiteral("Prompt: ") + firstLine(Redactor::redact(p.value(QStringLiteral("prompt")).toString()), 110);
    } else if (e.kind == QLatin1String("permission.request")) {
        e.summary = QStringLiteral("Permission requested: ") + e.toolName + (file.isEmpty() ? QString() : QStringLiteral("  ") + file)
                    + (e.command.isEmpty() ? QString() : QStringLiteral("  ") + firstLine(e.command, 80));
    } else if (e.kind == QLatin1String("permission.denied")) {
        e.summary = QStringLiteral("Permission denied: ") + e.toolName;
    } else if (e.kind == QLatin1String("notification")) {
        e.summary = firstLine(p.value(QStringLiteral("message")).toString(), 120);
    } else if (e.kind == QLatin1String("subagent.start")) {
        e.summary = QStringLiteral("Subagent started: ") + e.agentType;
    } else if (e.kind == QLatin1String("subagent.stop")) {
        e.summary = QStringLiteral("Subagent finished: ") + e.agentType;
    } else if (e.kind == QLatin1String("turn.stop")) {
        e.summary = QStringLiteral("Turn complete");
    } else if (e.kind == QLatin1String("turn.fail")) {
        e.summary = QStringLiteral("Turn failed: ") + p.value(QStringLiteral("error")).toString();
    } else if (e.kind == QLatin1String("task.created")) {
        e.summary = QStringLiteral("Task created: ") + firstLine(p.value(QStringLiteral("task_subject")).toString(p.value(QStringLiteral("subject")).toString()), 100);
    } else if (e.kind == QLatin1String("task.completed")) {
        e.summary = QStringLiteral("Task completed: ") + firstLine(p.value(QStringLiteral("task_subject")).toString(p.value(QStringLiteral("subject")).toString()), 100);
    } else if (e.kind == QLatin1String("compact.pre")) {
        e.summary = QStringLiteral("Context compaction starting");
    } else if (e.kind == QLatin1String("compact.post")) {
        e.summary = QStringLiteral("Context compacted");
    } else if (e.kind == QLatin1String("cwd.changed")) {
        e.summary = QStringLiteral("Working directory → ") + shortPath(p.value(QStringLiteral("new_cwd")).toString(e.cwd), QString());
    } else if (e.kind == QLatin1String("instructions.loaded")) {
        const QString fp = p.value(QStringLiteral("file_path")).toString();
        if (!fp.isEmpty()) e.files.append(fp);
        e.summary = QStringLiteral("Instructions loaded: ") + shortPath(fp, e.cwd);
    } else if (e.kind == QLatin1String("model.switch")) {
        e.summary = QStringLiteral("Model: %1 → %2").arg(p.value(QStringLiteral("from_model")).toString(), p.value(QStringLiteral("to_model")).toString());
    } else if (e.kind == QLatin1String("agent.milestone")) {
        // self-reported through the NEXUS MCP server; attributed by Claude Code's pid
        e.provenance = NexusEvent::Provenance::Declared;
        e.claudePid = p.value(QStringLiteral("claude_pid")).toInt(parentPid);
        e.summary = QStringLiteral("Declared: ") + firstLine(Redactor::redact(p.value(QStringLiteral("title")).toString()), 120);
    } else if (e.kind == QLatin1String("system.setup_test")) {
        e.source = NexusEvent::Source::System;
        e.summary = QStringLiteral("Setup test event received through nexus-relay");
    } else {
        e.summary = hookName.isEmpty() ? QStringLiteral("Unknown event") : hookName;
    }
    if (e.kind == QLatin1String("permission.request") || e.kind == QLatin1String("notification"))
        e.provenance = NexusEvent::Provenance::Observed;
    e.payload = capPayload(p);
    return e;
}

NexusEvent Normalizer::fromStatusLine(const QJsonObject &p, qint64 capturedMs)
{
    NexusEvent e;
    e.id = QUuid::createUuid().toString(QUuid::WithoutBraces);
    e.recvTs = QDateTime::currentMSecsSinceEpoch();
    e.ts = capturedMs > 0 ? capturedMs : e.recvTs;
    e.source = NexusEvent::Source::StatusLine;
    e.kind = QStringLiteral("status.update");
    e.sessionId = p.value(QStringLiteral("session_id")).toString();
    e.cwd = p.value(QStringLiteral("cwd")).toString();
    if (e.cwd.isEmpty())
        e.cwd = p.value(QStringLiteral("workspace")).toObject().value(QStringLiteral("current_dir")).toString();
    const QJsonObject cw = p.value(QStringLiteral("context_window")).toObject();
    const QJsonObject cost = p.value(QStringLiteral("cost")).toObject();
    const QString model = p.value(QStringLiteral("model")).toObject().value(QStringLiteral("display_name")).toString();
    QStringList parts;
    if (!model.isEmpty()) parts << model;
    if (cw.contains(QStringLiteral("used_percentage")) && !cw.value(QStringLiteral("used_percentage")).isNull())
        parts << QStringLiteral("context %1%").arg(cw.value(QStringLiteral("used_percentage")).toDouble(), 0, 'f', 0);
    if (cost.contains(QStringLiteral("total_cost_usd")))
        parts << QStringLiteral("$%1").arg(cost.value(QStringLiteral("total_cost_usd")).toDouble(), 0, 'f', 2);
    e.summary = QStringLiteral("Status: ") + parts.join(QStringLiteral(" · "));
    e.payload = capPayload(p);
    return e;
}

bool Normalizer::fromStreamJson(const QJsonObject &m, const QString &fallbackSession, qint64 ts, NexusEvent *out)
{
    const QString type = m.value(QStringLiteral("type")).toString();
    NexusEvent e;
    e.id = QUuid::createUuid().toString(QUuid::WithoutBraces);
    e.ts = e.recvTs = ts;
    e.source = NexusEvent::Source::Stream;
    e.sessionId = m.value(QStringLiteral("session_id")).toString(fallbackSession);
    if (type == QLatin1String("system") && m.value(QStringLiteral("subtype")).toString() == QLatin1String("init")) {
        e.kind = QStringLiteral("stream.init");
        e.cwd = m.value(QStringLiteral("cwd")).toString();
        e.summary = QStringLiteral("Headless session initialised · ") + m.value(QStringLiteral("model")).toString();
        QJsonObject keep;
        for (const char *k : { "model", "cwd", "permissionMode", "claude_code_version", "apiKeySource" })
            if (m.contains(QLatin1String(k))) keep.insert(QLatin1String(k), m.value(QLatin1String(k)));
        keep.insert(QStringLiteral("tools"), m.value(QStringLiteral("tools")));
        e.payload = Normalizer::capPayload(keep);
    } else if (type == QLatin1String("assistant")) {
        const QJsonObject msg = m.value(QStringLiteral("message")).toObject();
        QString text;
        for (const QJsonValue &c : msg.value(QStringLiteral("content")).toArray()) {
            const QJsonObject co = c.toObject();
            if (co.value(QStringLiteral("type")).toString() == QLatin1String("text"))
                text += co.value(QStringLiteral("text")).toString();
        }
        if (text.trimmed().isEmpty())
            return false;  // tool_use blocks are covered by hooks
        e.kind = QStringLiteral("stream.message");
        e.summary = firstLine(Redactor::redact(text), 160);
        QJsonObject keep;
        keep.insert(QStringLiteral("text"), Redactor::redact(text).left(16384));
        keep.insert(QStringLiteral("usage"), msg.value(QStringLiteral("usage")));
        keep.insert(QStringLiteral("model"), msg.value(QStringLiteral("model")));
        e.payload = keep;
    } else if (type == QLatin1String("result")) {
        e.kind = QStringLiteral("stream.result");
        const bool isError = m.value(QStringLiteral("is_error")).toBool();
        e.ok = isError ? 0 : 1;
        e.durationMs = m.value(QStringLiteral("duration_ms")).toInteger();
        e.summary = QStringLiteral("Result: %1 · %2 turns · $%3")
                        .arg(m.value(QStringLiteral("subtype")).toString())
                        .arg(m.value(QStringLiteral("num_turns")).toInt())
                        .arg(m.value(QStringLiteral("total_cost_usd")).toDouble(), 0, 'f', 3);
        QJsonObject keep;
        for (const char *k : { "subtype", "is_error", "duration_ms", "duration_api_ms", "num_turns", "total_cost_usd", "usage", "permission_denials" })
            if (m.contains(QLatin1String(k))) keep.insert(QLatin1String(k), m.value(QLatin1String(k)));
        keep.insert(QStringLiteral("result"), Redactor::redact(m.value(QStringLiteral("result")).toString()).left(16384));
        e.payload = keep;
    } else {
        return false;
    }
    *out = e;
    return true;
}

} // namespace nexus::ingest
