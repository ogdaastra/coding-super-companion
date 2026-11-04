#include "integration/HookInstaller.h"
#include "integration/OrderedJson.h"

#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QTemporaryDir>
#include <QTest>

using namespace nexus::integration;

class TestInstaller : public QObject
{
    Q_OBJECT
private:
    QString writeFile(const QTemporaryDir &d, const QByteArray &content)
    {
        const QString p = d.path() + "/settings.json";
        QFile f(p);
        f.open(QIODevice::WriteOnly);
        f.write(content);
        return p;
    }
    QString read(const QString &p)
    {
        QFile f(p);
        f.open(QIODevice::ReadOnly);
        return QString::fromUtf8(f.readAll());
    }

private slots:
    void orderedJsonPreservesOrderAndNumbers()
    {
        const QString in = "{\n  \"zeta\": 1.50,\n  \"alpha\": [true, null, \"x\\n\"],\n  \"mid\": {\"b\": 2, \"a\": 1}\n}\n";
        OJson v;
        QString err;
        QVERIFY(OJson::parse(in, &v, &err));
        const QString out = v.serialize(2);
        QVERIFY(out.indexOf("zeta") < out.indexOf("alpha"));
        QVERIFY(out.indexOf("\"b\"") < out.indexOf("\"a\""));
        QVERIFY(out.contains("1.50"));
        OJson again;
        QVERIFY(OJson::parse(out, &again, &err));
        QCOMPARE(again.serialize(2), out);
    }

    void invalidJsonIsNeverTouched()
    {
        QTemporaryDir d;
        const QString p = writeFile(d, "{ \"hooks\": [ broken ");
        const InstallPlan plan = HookInstaller::planInstall(p, "/opt/nexus/nexus-relay", false);
        QVERIFY(!plan.error.isEmpty());
        QString backup, err;
        QVERIFY(!HookInstaller::apply(plan, &backup, &err));
        QCOMPARE(read(p), QStringLiteral("{ \"hooks\": [ broken "));
    }

    void installMergesAndIsIdempotent()
    {
        QTemporaryDir d;
        const QString p = writeFile(d, R"({
  "model": "opus",
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [ { "type": "command", "command": "/usr/local/bin/guard.sh" } ] }
    ]
  },
  "statusLine": { "type": "command", "command": "~/.claude/status.sh" }
})");
        const InstallPlan plan = HookInstaller::planInstall(p, "/opt/nexus/nexus-relay", true);
        QVERIFY2(plan.error.isEmpty(), qPrintable(plan.error));
        QVERIFY(plan.changed);
        QString backup, err;
        QVERIFY(HookInstaller::apply(plan, &backup, &err));
        QVERIFY(QFile::exists(backup));
        const QJsonObject o = QJsonDocument::fromJson(read(p).toUtf8()).object();
        QCOMPARE(o.value("model").toString(), QStringLiteral("opus"));
        const QJsonObject hooks = o.value("hooks").toObject();
        for (const QString &e : HookInstaller::hookEvents())
            QVERIFY2(hooks.contains(e), qPrintable(e));
        // the user's own hook is kept
        QVERIFY(read(p).contains("/usr/local/bin/guard.sh"));
        // existing status line chained, not replaced
        QVERIFY(o.value("statusLine").toObject().value("command").toString().contains("--chain ~/.claude/status.sh"));

        const auto st = HookInstaller::status(p);
        QCOMPARE(st.events.size(), HookInstaller::hookEvents().size());
        QVERIFY(st.statusline);

        const InstallPlan again = HookInstaller::planInstall(p, "/opt/nexus/nexus-relay", true);
        QVERIFY2(!again.changed, "second install must be a no-op");
    }

    void uninstallRemovesOnlyNexus()
    {
        QTemporaryDir d;
        const QString original = R"({
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [ { "type": "command", "command": "/usr/local/bin/guard.sh" } ] }
    ]
  },
  "statusLine": { "type": "command", "command": "~/.claude/status.sh" }
}
)";
        const QString p = writeFile(d, original.toUtf8());
        QString backup, err;
        QVERIFY(HookInstaller::apply(HookInstaller::planInstall(p, "/opt/nexus/nexus-relay", true), &backup, &err));
        const InstallPlan un = HookInstaller::planUninstall(p);
        QVERIFY(un.changed);
        QVERIFY(HookInstaller::apply(un, &backup, &err));
        const QJsonObject o = QJsonDocument::fromJson(read(p).toUtf8()).object();
        QVERIFY(!read(p).contains("nexus-relay"));
        QCOMPARE(o.value("statusLine").toObject().value("command").toString(), QStringLiteral("~/.claude/status.sh"));
        QCOMPARE(o.value("hooks").toObject().keys(), QStringList{ "PreToolUse" });
        QCOMPARE(QJsonDocument::fromJson(read(p).toUtf8()), QJsonDocument::fromJson(original.toUtf8()));
    }

    void refusesStalePlan()
    {
        QTemporaryDir d;
        const QString p = writeFile(d, "{}");
        const InstallPlan plan = HookInstaller::planInstall(p, "/opt/nexus/nexus-relay", false);
        writeFile(d, "{ \"changed\": true }");
        QString backup, err;
        QVERIFY(!HookInstaller::apply(plan, &backup, &err));
        QVERIFY(err.contains("changed after the preview"));
    }

    void sessionSettingsUseAsyncExecForm()
    {
        const QJsonObject s = HookInstaller::sessionSettings("/x/nexus-relay", false);
        const QJsonObject h = s.value("hooks").toObject().value("PostToolUse").toArray().first().toObject()
                                  .value("hooks").toArray().first().toObject();
        QCOMPARE(h.value("command").toString(), QStringLiteral("/x/nexus-relay"));
        QCOMPARE(h.value("args").toArray().first().toString(), QStringLiteral("hook"));
        QVERIFY(h.value("async").toBool());
    }
};

QTEST_GUILESS_MAIN(TestInstaller)
#include "tst_installer.moc"
