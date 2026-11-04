#include "Redactor.h"

#include <QJsonArray>
#include <QRegularExpression>

namespace nexus::core {

namespace {

struct Rule {
    QRegularExpression re;
    QString replacement;
};

const std::vector<Rule> &rules()
{
    static const std::vector<Rule> r = {
        // PEM private key blocks
        { QRegularExpression(QStringLiteral("-----BEGIN [A-Z ]*PRIVATE KEY-----[\\s\\S]*?-----END [A-Z ]*PRIVATE KEY-----")),
          QStringLiteral("[REDACTED PRIVATE KEY]") },
        // Anthropic keys, then generic sk- style keys
        { QRegularExpression(QStringLiteral("sk-ant-[A-Za-z0-9_\\-]{16,}")), QStringLiteral("sk-ant-[REDACTED]") },
        { QRegularExpression(QStringLiteral("\\bsk-(?:proj-|live-|test-)?[A-Za-z0-9_\\-]{20,}")), QStringLiteral("sk-[REDACTED]") },
        // AWS access key ids
        { QRegularExpression(QStringLiteral("\\b(?:AKIA|ASIA)[0-9A-Z]{16}\\b")), QStringLiteral("[REDACTED AWS KEY]") },
        // GitHub / GitLab / Slack / Stripe / Google
        { QRegularExpression(QStringLiteral("\\bgh[pousr]_[A-Za-z0-9]{30,}\\b")), QStringLiteral("gh_[REDACTED]") },
        { QRegularExpression(QStringLiteral("\\bgithub_pat_[A-Za-z0-9_]{30,}\\b")), QStringLiteral("github_pat_[REDACTED]") },
        { QRegularExpression(QStringLiteral("\\bglpat-[A-Za-z0-9_\\-]{20,}\\b")), QStringLiteral("glpat-[REDACTED]") },
        { QRegularExpression(QStringLiteral("\\bxox[abprs]-[A-Za-z0-9\\-]{10,}\\b")), QStringLiteral("xox-[REDACTED]") },
        { QRegularExpression(QStringLiteral("\\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\\b")), QStringLiteral("stripe_[REDACTED]") },
        { QRegularExpression(QStringLiteral("\\bAIza[0-9A-Za-z_\\-]{35}\\b")), QStringLiteral("AIza[REDACTED]") },
        // JSON Web Tokens
        { QRegularExpression(QStringLiteral("\\beyJ[A-Za-z0-9_\\-]{8,}\\.[A-Za-z0-9_\\-]{8,}\\.[A-Za-z0-9_\\-]{8,}\\b")), QStringLiteral("[REDACTED JWT]") },
        // Authorization headers
        { QRegularExpression(QStringLiteral("(?i)(authorization\\s*[:=]\\s*(?:bearer|basic|token)\\s+)[A-Za-z0-9._~+/=\\-]{8,}")), QStringLiteral("\\1[REDACTED]") },
        { QRegularExpression(QStringLiteral("(?i)\\b(bearer\\s+)[A-Za-z0-9._~+/=\\-]{16,}")), QStringLiteral("\\1[REDACTED]") },
        // credentials in URLs: scheme://user:pass@host
        { QRegularExpression(QStringLiteral("([a-zA-Z][a-zA-Z0-9+.\\-]*://[^\\s:/@]+:)[^\\s@/]+@")), QStringLiteral("\\1[REDACTED]@") },
        // KEY=value / KEY: value where KEY names a secret
        { QRegularExpression(QStringLiteral("(?i)\\b([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|CREDENTIALS?)[A-Z0-9_]*\\s*[=:]\\s*)(\"[^\"]*\"|'[^']*'|[^\\s'\"]+)")),
          QStringLiteral("\\1[REDACTED]") },
    };
    return r;
}

} // namespace

QString Redactor::redact(const QString &text)
{
    if (text.isEmpty())
        return text;
    QString out = text;
    for (const Rule &r : rules())
        out.replace(r.re, r.replacement);
    return out;
}

bool Redactor::isSecretKeyName(const QString &key)
{
    static const QRegularExpression re(QStringLiteral("(?i)(secret|token|password|passwd|api[_-]?key|access[_-]?key|private[_-]?key|credential|authorization|cookie)"));
    // usage counters such as "input_tokens" / "total_output_tokens" are telemetry, not secrets
    static const QRegularExpression counters(QStringLiteral("(?i)(tokens|token_count|_count$|_percentage$)"));
    return re.match(key).hasMatch() && !counters.match(key).hasMatch();
}

QJsonValue Redactor::redactJson(const QJsonValue &v, int maxString, int depth)
{
    if (depth > 24)
        return QStringLiteral("[depth limit]");
    if (v.isString()) {
        QString s = redact(v.toString());
        if (s.size() > maxString)
            s = s.left(maxString) + QStringLiteral("… [+%1 chars truncated by NEXUS]").arg(s.size() - maxString);
        return s;
    }
    if (v.isArray()) {
        QJsonArray out;
        const QJsonArray in = v.toArray();
        int n = 0;
        for (const QJsonValue &e : in) {
            if (++n > 500) { out.append(QStringLiteral("[array truncated by NEXUS]")); break; }
            out.append(redactJson(e, maxString, depth + 1));
        }
        return out;
    }
    if (v.isObject())
        return redactObject(v.toObject(), maxString);
    return v;
}

QJsonObject Redactor::redactObject(const QJsonObject &o, int maxString)
{
    QJsonObject out;
    for (auto it = o.begin(); it != o.end(); ++it) {
        if (isSecretKeyName(it.key()) && (it.value().isString() || it.value().isDouble()))
            out.insert(it.key(), QStringLiteral("[REDACTED]"));
        else
            out.insert(it.key(), redactJson(it.value(), maxString, 1));
    }
    return out;
}

} // namespace nexus::core
