#include "OrderedJson.h"

namespace nexus::integration {

OJson *OJson::find(const QString &key)
{
    for (auto &m : members)
        if (m.first == key) return &m.second;
    return nullptr;
}

const OJson *OJson::find(const QString &key) const
{
    for (const auto &m : members)
        if (m.first == key) return &m.second;
    return nullptr;
}

OJson &OJson::set(const QString &key, OJson value)
{
    for (auto &m : members) {
        if (m.first == key) { m.second = std::move(value); return m.second; }
    }
    members.emplace_back(key, std::move(value));
    return members.back().second;
}

bool OJson::remove(const QString &key)
{
    for (auto it = members.begin(); it != members.end(); ++it) {
        if (it->first == key) { members.erase(it); return true; }
    }
    return false;
}

namespace {

struct Parser {
    const QString &s;
    qsizetype i = 0;
    QString err;

    void ws() { while (i < s.size() && (s[i] == u' ' || s[i] == u'\n' || s[i] == u'\r' || s[i] == u'\t')) ++i; }
    bool fail(const QString &m) { if (err.isEmpty()) err = QStringLiteral("%1 at offset %2").arg(m).arg(i); return false; }

    bool str(QString *out)
    {
        if (i >= s.size() || s[i] != u'"') return fail(QStringLiteral("expected string"));
        ++i;
        QString r;
        while (i < s.size()) {
            const QChar c = s[i++];
            if (c == u'"') { *out = r; return true; }
            if (c == u'\\') {
                if (i >= s.size()) return fail(QStringLiteral("bad escape"));
                const QChar e = s[i++];
                switch (e.unicode()) {
                case '"': r += u'"'; break;
                case '\\': r += u'\\'; break;
                case '/': r += u'/'; break;
                case 'b': r += u'\b'; break;
                case 'f': r += u'\f'; break;
                case 'n': r += u'\n'; break;
                case 'r': r += u'\r'; break;
                case 't': r += u'\t'; break;
                case 'u': {
                    if (i + 4 > s.size()) return fail(QStringLiteral("bad unicode escape"));
                    bool ok = false;
                    const ushort code = s.mid(i, 4).toUShort(&ok, 16);
                    if (!ok) return fail(QStringLiteral("bad unicode escape"));
                    r += QChar(code);
                    i += 4;
                    break;
                }
                default: return fail(QStringLiteral("bad escape"));
                }
            } else {
                r += c;
            }
        }
        return fail(QStringLiteral("unterminated string"));
    }

    bool value(OJson *out)
    {
        ws();
        if (i >= s.size()) return fail(QStringLiteral("unexpected end"));
        const QChar c = s[i];
        if (c == u'{') {
            ++i;
            *out = OJson::object();
            ws();
            if (i < s.size() && s[i] == u'}') { ++i; return true; }
            while (true) {
                ws();
                QString key;
                if (!str(&key)) return false;
                ws();
                if (i >= s.size() || s[i] != u':') return fail(QStringLiteral("expected ':'"));
                ++i;
                OJson v;
                if (!value(&v)) return false;
                out->members.emplace_back(key, std::move(v));
                ws();
                if (i < s.size() && s[i] == u',') { ++i; continue; }
                if (i < s.size() && s[i] == u'}') { ++i; return true; }
                return fail(QStringLiteral("expected ',' or '}'"));
            }
        }
        if (c == u'[') {
            ++i;
            *out = OJson::array();
            ws();
            if (i < s.size() && s[i] == u']') { ++i; return true; }
            while (true) {
                OJson v;
                if (!value(&v)) return false;
                out->items.push_back(std::move(v));
                ws();
                if (i < s.size() && s[i] == u',') { ++i; continue; }
                if (i < s.size() && s[i] == u']') { ++i; return true; }
                return fail(QStringLiteral("expected ',' or ']'"));
            }
        }
        if (c == u'"') {
            out->type = OJson::Type::String;
            return str(&out->text);
        }
        if (s.mid(i, 4) == QLatin1String("true")) { i += 4; *out = OJson::boolean(true); return true; }
        if (s.mid(i, 5) == QLatin1String("false")) { i += 5; *out = OJson::boolean(false); return true; }
        if (s.mid(i, 4) == QLatin1String("null")) { i += 4; *out = OJson(); return true; }
        const qsizetype start = i;
        while (i < s.size() && (s[i].isDigit() || s[i] == u'-' || s[i] == u'+' || s[i] == u'.' || s[i] == u'e' || s[i] == u'E')) ++i;
        if (i == start) return fail(QStringLiteral("unexpected character"));
        out->type = OJson::Type::Number;
        out->text = s.mid(start, i - start);
        return true;
    }
};

QString escape(const QString &s)
{
    QString r;
    r.reserve(s.size() + 2);
    r += u'"';
    for (QChar c : s) {
        switch (c.unicode()) {
        case '"': r += QStringLiteral("\\\""); break;
        case '\\': r += QStringLiteral("\\\\"); break;
        case '\n': r += QStringLiteral("\\n"); break;
        case '\r': r += QStringLiteral("\\r"); break;
        case '\t': r += QStringLiteral("\\t"); break;
        case '\b': r += QStringLiteral("\\b"); break;
        case '\f': r += QStringLiteral("\\f"); break;
        default:
            if (c.unicode() < 0x20) r += QStringLiteral("\\u%1").arg(c.unicode(), 4, 16, QLatin1Char('0'));
            else r += c;
        }
    }
    r += u'"';
    return r;
}

void write(const OJson &v, QString &out, int indent, int level)
{
    const QString pad(indent * (level + 1), u' ');
    const QString padEnd(indent * level, u' ');
    switch (v.type) {
    case OJson::Type::Null: out += QStringLiteral("null"); break;
    case OJson::Type::Bool: out += v.b ? QStringLiteral("true") : QStringLiteral("false"); break;
    case OJson::Type::Number: out += v.text; break;
    case OJson::Type::String: out += escape(v.text); break;
    case OJson::Type::Array:
        if (v.items.empty()) { out += QStringLiteral("[]"); break; }
        out += QStringLiteral("[\n");
        for (size_t k = 0; k < v.items.size(); ++k) {
            out += pad;
            write(v.items[k], out, indent, level + 1);
            out += k + 1 < v.items.size() ? QStringLiteral(",\n") : QStringLiteral("\n");
        }
        out += padEnd + u']';
        break;
    case OJson::Type::Object:
        if (v.members.empty()) { out += QStringLiteral("{}"); break; }
        out += QStringLiteral("{\n");
        for (size_t k = 0; k < v.members.size(); ++k) {
            out += pad + escape(v.members[k].first) + QStringLiteral(": ");
            write(v.members[k].second, out, indent, level + 1);
            out += k + 1 < v.members.size() ? QStringLiteral(",\n") : QStringLiteral("\n");
        }
        out += padEnd + u'}';
        break;
    }
}

} // namespace

bool OJson::parse(const QString &text, OJson *out, QString *error)
{
    Parser p{ text };
    OJson v;
    if (!p.value(&v)) {
        if (error) *error = p.err;
        return false;
    }
    p.ws();
    if (p.i != text.size()) {
        if (error) *error = QStringLiteral("trailing content at offset %1").arg(p.i);
        return false;
    }
    *out = std::move(v);
    return true;
}

QString OJson::serialize(int indent) const
{
    QString out;
    write(*this, out, indent, 0);
    out += u'\n';
    return out;
}

} // namespace nexus::integration
