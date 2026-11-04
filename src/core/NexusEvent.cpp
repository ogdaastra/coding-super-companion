#include "NexusEvent.h"

#include <QJsonArray>

namespace nexus::core {

QString NexusEvent::sourceName(Source s)
{
    switch (s) {
    case Source::Hook: return QStringLiteral("hook");
    case Source::StatusLine: return QStringLiteral("statusline");
    case Source::Stream: return QStringLiteral("stream");
    case Source::Simulation: return QStringLiteral("simulation");
    case Source::System: return QStringLiteral("system");
    }
    return QStringLiteral("hook");
}

NexusEvent::Source NexusEvent::sourceFromName(const QString &s)
{
    if (s == QLatin1String("statusline")) return Source::StatusLine;
    if (s == QLatin1String("stream")) return Source::Stream;
    if (s == QLatin1String("simulation")) return Source::Simulation;
    if (s == QLatin1String("system")) return Source::System;
    return Source::Hook;
}

QString NexusEvent::provenanceName(Provenance p)
{
    switch (p) {
    case Provenance::Observed: return QStringLiteral("observed");
    case Provenance::Derived: return QStringLiteral("derived");
    case Provenance::Inferred: return QStringLiteral("inferred");
    case Provenance::Declared: return QStringLiteral("declared");
    }
    return QStringLiteral("observed");
}

QJsonObject NexusEvent::toJson() const
{
    QJsonObject o;
    o.insert(QStringLiteral("v"), 1);
    o.insert(QStringLiteral("id"), id);
    o.insert(QStringLiteral("seq"), seq);
    o.insert(QStringLiteral("ts"), ts);
    o.insert(QStringLiteral("recv_ts"), recvTs);
    o.insert(QStringLiteral("source"), sourceName(source));
    o.insert(QStringLiteral("simulated"), simulated);
    o.insert(QStringLiteral("session_id"), sessionId);
    if (!agentId.isEmpty()) o.insert(QStringLiteral("agent_id"), agentId);
    if (!agentType.isEmpty()) o.insert(QStringLiteral("agent_type"), agentType);
    o.insert(QStringLiteral("kind"), kind);
    if (!category.isEmpty()) o.insert(QStringLiteral("category"), category);
    if (!toolName.isEmpty()) o.insert(QStringLiteral("tool_name"), toolName);
    if (!toolUseId.isEmpty()) o.insert(QStringLiteral("tool_use_id"), toolUseId);
    if (!files.isEmpty()) o.insert(QStringLiteral("files"), QJsonArray::fromStringList(files));
    if (!command.isEmpty()) o.insert(QStringLiteral("command"), command);
    if (durationMs >= 0) o.insert(QStringLiteral("duration_ms"), durationMs);
    if (ok >= 0) o.insert(QStringLiteral("ok"), ok == 1);
    if (!error.isEmpty()) o.insert(QStringLiteral("error"), error);
    if (!cwd.isEmpty()) o.insert(QStringLiteral("cwd"), cwd);
    o.insert(QStringLiteral("summary"), summary);
    o.insert(QStringLiteral("provenance"), provenanceName(provenance));
    if (claudePid > 0) o.insert(QStringLiteral("claude_pid"), claudePid);
    if (testRun) o.insert(QStringLiteral("test_run"), true);
    if (!payload.isEmpty()) o.insert(QStringLiteral("payload"), payload);
    return o;
}

NexusEvent NexusEvent::fromJson(const QJsonObject &o)
{
    NexusEvent e;
    e.id = o.value(QStringLiteral("id")).toString();
    e.seq = o.value(QStringLiteral("seq")).toInteger();
    e.ts = o.value(QStringLiteral("ts")).toInteger();
    e.recvTs = o.value(QStringLiteral("recv_ts")).toInteger();
    e.source = sourceFromName(o.value(QStringLiteral("source")).toString());
    e.simulated = o.value(QStringLiteral("simulated")).toBool();
    e.sessionId = o.value(QStringLiteral("session_id")).toString();
    e.agentId = o.value(QStringLiteral("agent_id")).toString();
    e.agentType = o.value(QStringLiteral("agent_type")).toString();
    e.kind = o.value(QStringLiteral("kind")).toString();
    e.category = o.value(QStringLiteral("category")).toString();
    e.toolName = o.value(QStringLiteral("tool_name")).toString();
    e.toolUseId = o.value(QStringLiteral("tool_use_id")).toString();
    for (const QJsonValue &v : o.value(QStringLiteral("files")).toArray())
        e.files.append(v.toString());
    e.command = o.value(QStringLiteral("command")).toString();
    e.durationMs = o.contains(QStringLiteral("duration_ms")) ? o.value(QStringLiteral("duration_ms")).toInteger() : -1;
    e.ok = o.contains(QStringLiteral("ok")) ? (o.value(QStringLiteral("ok")).toBool() ? 1 : 0) : -1;
    e.error = o.value(QStringLiteral("error")).toString();
    e.cwd = o.value(QStringLiteral("cwd")).toString();
    e.summary = o.value(QStringLiteral("summary")).toString();
    const QString prov = o.value(QStringLiteral("provenance")).toString();
    e.provenance = prov == QLatin1String("derived") ? Provenance::Derived
                 : prov == QLatin1String("inferred") ? Provenance::Inferred
                 : prov == QLatin1String("declared") ? Provenance::Declared : Provenance::Observed;
    e.claudePid = o.value(QStringLiteral("claude_pid")).toInt();
    e.testRun = o.value(QStringLiteral("test_run")).toBool();
    e.payload = o.value(QStringLiteral("payload")).toObject();
    return e;
}

} // namespace nexus::core
