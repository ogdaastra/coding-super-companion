#include "HookInstaller.h"
#include "OrderedJson.h"

#include <QDateTime>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QSaveFile>
#include <QVariantMap>

namespace nexus::integration {

namespace {

bool isRelayCommand(const QString &cmd)
{
    const QString name = QFileInfo(cmd).fileName();
    return name == QLatin1String("nexus-relay") || name == QLatin1String("nexus-relay.exe");
}

bool isNexusHandler(const OJson &h)
{
    if (!h.isObject()) return false;
    const OJson *cmd = h.find(QStringLiteral("command"));
    if (!cmd || !cmd->isString() || !isRelayCommand(cmd->text)) return false;
    const OJson *args = h.find(QStringLiteral("args"));
    return args && args->isArray() && !args->items.empty() && args->items[0].text == QLatin1String("hook");
}

OJson makeHandler(const QString &relayPath)
{
    OJson h = OJson::object();
    h.set(QStringLiteral("type"), OJson::string(QStringLiteral("command")));
    h.set(QStringLiteral("command"), OJson::string(relayPath));
    OJson args = OJson::array();
    args.items.push_back(OJson::string(QStringLiteral("hook")));
    h.set(QStringLiteral("args"), args);
    h.set(QStringLiteral("async"), OJson::boolean(true));
    h.set(QStringLiteral("timeout"), OJson::number(15));
    return h;
}

QString quoted(const QString &p)
{
    return QLatin1Char('"') + p + QLatin1Char('"');
}

bool isNexusStatusline(const QString &cmd)
{
    return cmd.contains(QLatin1String("nexus-relay")) && cmd.contains(QLatin1String(" statusline"));
}

bool load(const QString &path, OJson *root, QString *text, bool *exists, QString *error)
{
    QFile f(path);
    *exists = f.exists();
    if (!*exists) {
        *root = OJson::object();
        text->clear();
        return true;
    }
    if (!f.open(QIODevice::ReadOnly)) {
        *error = QStringLiteral("Cannot read %1: %2").arg(path, f.errorString());
        return false;
    }
    *text = QString::fromUtf8(f.readAll());
    if (text->trimmed().isEmpty()) {
        *root = OJson::object();
        return true;
    }
    QString perr;
    if (!OJson::parse(*text, root, &perr) || !root->isObject()) {
        *error = QStringLiteral("%1 is not valid JSON (%2). NEXUS will not modify it; fix or move the file first.").arg(path, perr);
        return false;
    }
    return true;
}

} // namespace

QStringList HookInstaller::hookEvents()
{
    return { QStringLiteral("SessionStart"), QStringLiteral("SessionEnd"), QStringLiteral("UserPromptSubmit"),
             QStringLiteral("PreToolUse"), QStringLiteral("PostToolUse"), QStringLiteral("PostToolUseFailure"),
             QStringLiteral("PermissionRequest"), QStringLiteral("PermissionDenied"), QStringLiteral("Notification"),
             QStringLiteral("SubagentStart"), QStringLiteral("SubagentStop"), QStringLiteral("Stop"),
             QStringLiteral("StopFailure"), QStringLiteral("TaskCreated"), QStringLiteral("TaskCompleted"),
             QStringLiteral("PreCompact"), QStringLiteral("PostCompact"), QStringLiteral("CwdChanged"),
             QStringLiteral("InstructionsLoaded"), QStringLiteral("PostModelSwitch") };
}

QString HookInstaller::claudeConfigDir()
{
    const QString env = qEnvironmentVariable("CLAUDE_CONFIG_DIR");
    return env.isEmpty() ? QDir::homePath() + QStringLiteral("/.claude") : env;
}

QString HookInstaller::userSettingsPath()
{
    return claudeConfigDir() + QStringLiteral("/settings.json");
}

QString HookInstaller::projectLocalSettingsPath(const QString &projectRoot)
{
    return projectRoot + QStringLiteral("/.claude/settings.local.json");
}

InstallPlan HookInstaller::planInstall(const QString &settingsPath, const QString &relayPath, bool statusline)
{
    InstallPlan plan;
    plan.path = settingsPath;
    plan.events = hookEvents();
    plan.statusline = statusline;
    OJson root;
    if (!load(settingsPath, &root, &plan.before, &plan.exists, &plan.error))
        return plan;

    OJson *hooks = root.find(QStringLiteral("hooks"));
    if (!hooks || !hooks->isObject())
        hooks = &root.set(QStringLiteral("hooks"), OJson::object());
    for (const QString &event : plan.events) {
        OJson *groups = hooks->find(event);
        if (!groups || !groups->isArray())
            groups = &hooks->set(event, OJson::array());
        bool present = false;
        for (OJson &g : groups->items) {
            OJson *hs = g.find(QStringLiteral("hooks"));
            if (!hs || !hs->isArray()) continue;
            for (OJson &h : hs->items) {
                if (isNexusHandler(h)) {
                    present = true;
                    if (h.find(QStringLiteral("command"))->text != relayPath)
                        h.set(QStringLiteral("command"), OJson::string(relayPath));   // relay moved
                }
            }
        }
        if (!present) {
            OJson group = OJson::object();
            OJson hs = OJson::array();
            hs.items.push_back(makeHandler(relayPath));
            group.set(QStringLiteral("hooks"), hs);
            groups->items.push_back(group);
        }
    }

    if (statusline) {
        OJson *sl = root.find(QStringLiteral("statusLine"));
        const QString ours = quoted(relayPath) + QStringLiteral(" statusline");
        if (sl && sl->isObject()) {
            OJson *cmd = sl->find(QStringLiteral("command"));
            const QString existing = cmd && cmd->isString() ? cmd->text : QString();
            if (!isNexusStatusline(existing) && !existing.isEmpty())
                sl->set(QStringLiteral("command"), OJson::string(ours + QStringLiteral(" --chain ") + existing));
            else if (existing.isEmpty() || isNexusStatusline(existing)) {
                // already ours: refresh the relay path but keep any chained command
                const int chain = int(existing.indexOf(QLatin1String(" --chain ")));
                sl->set(QStringLiteral("command"), OJson::string(chain >= 0 ? ours + existing.mid(chain) : ours));
            }
        } else {
            OJson s = OJson::object();
            s.set(QStringLiteral("type"), OJson::string(QStringLiteral("command")));
            s.set(QStringLiteral("command"), OJson::string(ours));
            root.set(QStringLiteral("statusLine"), s);
        }
    }

    plan.after = root.serialize(2);
    plan.changed = plan.after.trimmed() != plan.before.trimmed();
    return plan;
}

InstallPlan HookInstaller::planUninstall(const QString &settingsPath)
{
    InstallPlan plan;
    plan.path = settingsPath;
    plan.uninstall = true;
    OJson root;
    if (!load(settingsPath, &root, &plan.before, &plan.exists, &plan.error))
        return plan;
    if (!plan.exists) {
        plan.after = plan.before;
        return plan;
    }
    if (OJson *hooks = root.find(QStringLiteral("hooks")); hooks && hooks->isObject()) {
        std::vector<QString> emptyEvents;
        for (auto &[event, groups] : hooks->members) {
            if (!groups.isArray()) continue;
            std::vector<OJson> keptGroups;
            for (OJson &g : groups.items) {
                OJson *hs = g.find(QStringLiteral("hooks"));
                if (hs && hs->isArray()) {
                    std::vector<OJson> kept;
                    for (OJson &h : hs->items)
                        if (!isNexusHandler(h)) kept.push_back(h);
                    const bool hadOurs = kept.size() != hs->items.size();
                    hs->items = kept;
                    if (hadOurs && kept.empty()) continue;  // group existed only for NEXUS
                }
                keptGroups.push_back(g);
            }
            groups.items = keptGroups;
            if (groups.items.empty()) emptyEvents.push_back(event);
        }
        for (const QString &e : emptyEvents) hooks->remove(e);
        if (hooks->members.empty()) root.remove(QStringLiteral("hooks"));
    }
    if (OJson *sl = root.find(QStringLiteral("statusLine")); sl && sl->isObject()) {
        OJson *cmd = sl->find(QStringLiteral("command"));
        if (cmd && cmd->isString() && isNexusStatusline(cmd->text)) {
            const int chain = int(cmd->text.indexOf(QLatin1String(" --chain ")));
            if (chain >= 0) sl->set(QStringLiteral("command"), OJson::string(cmd->text.mid(chain + 9)));
            else root.remove(QStringLiteral("statusLine"));
        }
    }
    plan.after = root.serialize(2);
    plan.changed = plan.after.trimmed() != plan.before.trimmed();
    return plan;
}

bool HookInstaller::apply(const InstallPlan &plan, QString *backupPath, QString *error)
{
    if (!plan.error.isEmpty()) { *error = plan.error; return false; }
    if (!plan.changed) return true;
    // Refuse if the file changed since the plan was computed.
    QFile current(plan.path);
    QString now;
    if (current.exists() && current.open(QIODevice::ReadOnly)) {
        now = QString::fromUtf8(current.readAll());
        current.close();
    }
    if (now != plan.before) {
        *error = QStringLiteral("%1 changed after the preview was generated. Review the new preview and try again.").arg(plan.path);
        return false;
    }
    QDir().mkpath(QFileInfo(plan.path).absolutePath());
    if (plan.exists) {
        const QString backup = plan.path + QStringLiteral(".nexus-backup-") + QDateTime::currentDateTime().toString(QStringLiteral("yyyyMMdd-HHmmss"));
        if (!QFile::copy(plan.path, backup)) {
            *error = QStringLiteral("Could not create a backup at %1; nothing was changed.").arg(backup);
            return false;
        }
        if (backupPath) *backupPath = backup;
    }
    QSaveFile f(plan.path);
    if (!f.open(QIODevice::WriteOnly)) { *error = f.errorString(); return false; }
    f.write(plan.after.toUtf8());
    if (!f.commit()) { *error = f.errorString(); return false; }
    return true;
}

QJsonObject HookInstaller::sessionSettings(const QString &relayPath, bool statusline)
{
    QJsonObject handler{ { QStringLiteral("type"), QStringLiteral("command") }, { QStringLiteral("command"), relayPath },
                         { QStringLiteral("args"), QJsonArray{ QStringLiteral("hook") } }, { QStringLiteral("async"), true },
                         { QStringLiteral("timeout"), 15 } };
    QJsonObject hooks;
    for (const QString &e : hookEvents())
        hooks.insert(e, QJsonArray{ QJsonObject{ { QStringLiteral("hooks"), QJsonArray{ handler } } } });
    QJsonObject s{ { QStringLiteral("hooks"), hooks } };
    if (statusline)
        s.insert(QStringLiteral("statusLine"), QJsonObject{ { QStringLiteral("type"), QStringLiteral("command") },
                                                           { QStringLiteral("command"), quoted(relayPath) + QStringLiteral(" statusline") } });
    return s;
}

HookInstaller::Status HookInstaller::status(const QString &settingsPath)
{
    Status st;
    OJson root;
    QString text, error;
    bool exists = false;
    if (!load(settingsPath, &root, &text, &exists, &error)) {
        st.fileExists = exists;
        st.parseable = false;
        return st;
    }
    st.fileExists = exists;
    if (const OJson *hooks = root.find(QStringLiteral("hooks")); hooks && hooks->isObject()) {
        for (const auto &[event, groups] : hooks->members) {
            for (const OJson &g : groups.items) {
                const OJson *hs = g.find(QStringLiteral("hooks"));
                if (!hs) continue;
                for (const OJson &h : hs->items) {
                    if (isNexusHandler(h)) {
                        if (!st.events.contains(event)) st.events.append(event);
                        st.relayPathInFile = h.find(QStringLiteral("command"))->text;
                    }
                }
            }
        }
    }
    if (const OJson *sl = root.find(QStringLiteral("statusLine")); sl && sl->isObject()) {
        const OJson *cmd = sl->find(QStringLiteral("command"));
        st.statusline = cmd && isNexusStatusline(cmd->text);
    }
    return st;
}

QVariantList HookInstaller::lineDiff(const QString &before, const QString &after)
{
    const QStringList x = before.isEmpty() ? QStringList() : before.split(QLatin1Char('\n'));
    const QStringList y = after.split(QLatin1Char('\n'));
    const int n = int(x.size()), m = int(y.size());
    QVariantList out;
    auto row = [](const QString &t, const QString &s) { return QVariantMap{ { QStringLiteral("t"), t }, { QStringLiteral("s"), s } }; };
    if (qint64(n) * m > 4000000) {
        for (const QString &l : x) out.append(row(QStringLiteral("-"), l));
        for (const QString &l : y) out.append(row(QStringLiteral("+"), l));
        return out;
    }
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

} // namespace nexus::integration
