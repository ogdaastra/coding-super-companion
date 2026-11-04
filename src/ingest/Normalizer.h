#pragma once

#include "core/NexusEvent.h"

#include <QJsonObject>

namespace nexus::ingest {

// Converts raw Claude Code JSON (hook input, status-line input, stream-json output) into
// normalised NexusEvents. Pure functions: no I/O, safe on any thread.
class Normalizer
{
public:
    static core::NexusEvent fromHook(const QJsonObject &payload, qint64 capturedMs, int parentPid);
    static core::NexusEvent fromStatusLine(const QJsonObject &payload, qint64 capturedMs);
    // Returns false when the stream message carries nothing worth recording.
    static bool fromStreamJson(const QJsonObject &msg, const QString &fallbackSession, qint64 ts, core::NexusEvent *out);

    static QString kindForHookEvent(const QString &hookEventName);
    static QString toolCategory(const QString &toolName);
    static bool looksLikeTestCommand(const QString &command);
    static QString shortPath(const QString &path, const QString &cwd);
    static QJsonObject capPayload(const QJsonObject &payload);
};

} // namespace nexus::ingest
