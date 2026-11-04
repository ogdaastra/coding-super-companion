#pragma once

#include <QString>
#include <memory>
#include <utility>
#include <vector>

namespace nexus::integration {

// Minimal JSON tree that preserves object key order and the exact text of numbers, so
// that editing a user's settings.json changes only what NEXUS intends to change.
struct OJson {
    enum class Type { Null, Bool, Number, String, Array, Object };
    Type type = Type::Null;
    bool b = false;
    QString text;    // number literal or string value
    std::vector<OJson> items;                       // arrays
    std::vector<std::pair<QString, OJson>> members; // objects (ordered)

    static OJson object() { OJson o; o.type = Type::Object; return o; }
    static OJson array() { OJson a; a.type = Type::Array; return a; }
    static OJson string(const QString &s) { OJson v; v.type = Type::String; v.text = s; return v; }
    static OJson boolean(bool x) { OJson v; v.type = Type::Bool; v.b = x; return v; }
    static OJson number(qint64 n) { OJson v; v.type = Type::Number; v.text = QString::number(n); return v; }

    bool isObject() const { return type == Type::Object; }
    bool isArray() const { return type == Type::Array; }
    bool isString() const { return type == Type::String; }
    OJson *find(const QString &key);
    const OJson *find(const QString &key) const;
    OJson &set(const QString &key, OJson value);   // replaces in place or appends
    bool remove(const QString &key);

    static bool parse(const QString &text, OJson *out, QString *error);
    QString serialize(int indent = 2) const;
};

} // namespace nexus::integration
