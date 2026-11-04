#pragma once

#include <QJsonObject>
#include <QMetaType>
#include <QString>
#include <QStringList>
#include <QList>

namespace nexus::core {

// Normalised telemetry event (see docs/EVENT_SCHEMA.md). Value type; cheap to copy
// except for the payload, which is implicitly shared by QJsonObject.
struct NexusEvent {
    enum class Source { Hook, StatusLine, Stream, Simulation, System };
    // Declared: self-reported by the agent (e.g. MCP milestones), not observed behaviour
    enum class Provenance { Observed, Derived, Inferred, Declared };

    QString id;
    qint64 seq = 0;
    qint64 ts = 0;          // ms since epoch (capture time)
    qint64 recvTs = 0;      // ms since epoch (receive time)
    Source source = Source::Hook;
    bool simulated = false;
    QString sessionId;
    QString agentId;
    QString agentType;
    QString kind;           // e.g. "tool.post"
    QString category;       // read | write | search | exec | web | agent | task | mcp | other
    QString toolName;
    QString toolUseId;
    QStringList files;      // absolute paths
    QString command;
    qint64 durationMs = -1;
    int ok = -1;            // -1 unknown, 0 false, 1 true
    QString error;
    QString cwd;
    QString summary;
    Provenance provenance = Provenance::Observed;
    int claudePid = 0;
    bool testRun = false;   // inferred: command matched a known test runner
    QJsonObject payload;    // redacted, size-capped raw input

    bool isTool() const { return kind.startsWith(QLatin1String("tool.")); }
    QJsonObject toJson() const;
    static NexusEvent fromJson(const QJsonObject &o);
    static QString sourceName(Source s);
    static Source sourceFromName(const QString &s);
    static QString provenanceName(Provenance p);
};

using EventList = QList<NexusEvent>;

} // namespace nexus::core

Q_DECLARE_METATYPE(nexus::core::NexusEvent)
Q_DECLARE_METATYPE(nexus::core::EventList)
