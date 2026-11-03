#pragma once

#include "core/NexusEvent.h"

#include <QHash>
#include <QString>
#include <QStringList>
#include <vector>

namespace nexus::session {

enum class AgentState { Unknown, Idle, Running, ExecutingTool, WaitingPermission, AwaitingInput, Completed, Failed, Ended, Stale };

QString stateName(AgentState s);   // machine name
QString stateLabel(AgentState s);  // human label

struct ToolCall {
    QString toolUseId;
    QString toolName;
    QString category;
    QString summary;
    QString command;
    QString error;
    QString agentId;
    QStringList files;
    qint64 start = 0;        // ms
    qint64 end = 0;          // ms, 0 while running
    qint64 durationMs = -1;
    bool durationObserved = false;
    int ok = -1;
    bool testRun = false;
    int eventStart = -1;     // index into the engine's event log
    int eventEnd = -1;
};

struct Milestone {
    qint64 ts = 0;
    QString kind;            // prompt | turn | failure | compact | task | start | end | subagent
    QString label;
    int eventIndex = -1;
};

struct SubAgent {
    QString id;
    QString type;
    qint64 start = 0;
    qint64 end = 0;
    int toolCount = 0;
};

struct ContextInfo {
    bool available = false;
    qint64 updatedTs = 0;
    double usedPercentage = -1;
    qint64 windowSize = 0;
    qint64 inputTokens = 0;
    qint64 outputTokens = 0;
    qint64 cacheReadTokens = 0;
    qint64 cacheCreationTokens = 0;
    double costUsd = -1;
    double rate5h = -1;
    double rate7d = -1;
    QString model;
    QString source;          // "status line" | "stream-json"
};

struct SessionRecord {
    QString id;
    QString title;
    QString cwd;
    QString model;
    QString permissionMode;
    int claudePid = 0;
    bool simulated = false;
    bool launchedByNexus = false;
    bool processAlive = true;
    qint64 firstTs = 0;
    qint64 lastTs = 0;

    AgentState state = AgentState::Unknown;
    core::NexusEvent::Provenance stateProvenance = core::NexusEvent::Provenance::Observed;
    QString stateDetail;
    qint64 stateSince = 0;

    QString currentTask;
    QString lastAssistantMessage;
    int prompts = 0, turns = 0, toolCount = 0, reads = 0, writes = 0, searches = 0, execs = 0;
    int errors = 0, testRuns = 0, testFailures = 0, permissionRequests = 0, compactions = 0;
    QHash<QString, int> filesRead;
    QHash<QString, int> filesWritten;
    QHash<QString, qint64> fileLastTouch;
    QHash<QString, int> toolsUsed;
    QStringList commands;    // most recent last, capped
    std::vector<ToolCall> toolCalls;
    QHash<QString, int> openCalls;   // tool_use_id → index into toolCalls
    std::vector<Milestone> milestones;
    QHash<QString, SubAgent> subagents;
    QStringList instructionFiles;
    std::vector<std::pair<qint64, qint64>> waits;   // waiting-for-permission intervals
    qint64 waitStart = 0;
    ContextInfo context;
    int colorIndex = 0;
    int ring = 0;
};

} // namespace nexus::session
