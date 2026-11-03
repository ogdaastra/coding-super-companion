#pragma once

#include <QJsonObject>
#include <QJsonValue>
#include <QString>

namespace nexus::core {

// Masks credentials before anything is persisted, logged or displayed.
// Detected: Anthropic/OpenAI style keys, AWS access keys, GitHub/GitLab/Slack/Stripe
// tokens, Google API keys, JWTs, bearer/basic authorization values, PEM private keys,
// credentials embedded in URLs and KEY=value assignments whose key names a secret.
class Redactor
{
public:
    static QString redact(const QString &text);
    // Recursively redacts strings; truncates long strings to maxString characters;
    // values under keys that name secrets are masked wholesale.
    static QJsonValue redactJson(const QJsonValue &v, int maxString = 4096, int depth = 0);
    static QJsonObject redactObject(const QJsonObject &o, int maxString = 4096);
    static bool isSecretKeyName(const QString &key);
};

} // namespace nexus::core
