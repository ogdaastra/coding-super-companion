#include "core/Redactor.h"

#include <QJsonArray>
#include <QJsonObject>
#include <QTest>

using nexus::core::Redactor;

class TestRedactor : public QObject
{
    Q_OBJECT
private slots:
    void masksKnownKeyFormats_data()
    {
        QTest::addColumn<QString>("input");
        QTest::addColumn<QString>("secret");
        QTest::newRow("anthropic") << "key sk-ant-api03-abcdefghijklmnopqrstuvwx end" << "sk-ant-api03-abcdefghijklmnopqrstuvwx";
        QTest::newRow("openai") << "OPENAI sk-proj-ABCDEFGHIJKLMNOPQRSTUVWX12" << "sk-proj-ABCDEFGHIJKLMNOPQRSTUVWX12";
        QTest::newRow("aws") << "aws AKIAIOSFODNN7EXAMPLE here" << "AKIAIOSFODNN7EXAMPLE";
        QTest::newRow("github") << "token ghp_abcdefghijklmnopqrstuvwxyz0123456789" << "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
        QTest::newRow("slack") << "xoxb-1234567890-abcdefghij" << "xoxb-1234567890-abcdefghij";
        QTest::newRow("bearer") << "Authorization: Bearer abc.def.ghi1234567890" << "abc.def.ghi1234567890";
        QTest::newRow("url") << "git clone https://user:hunter2pass@example.com/repo" << "hunter2pass";
        QTest::newRow("env") << "export DB_PASSWORD=supersecret123" << "supersecret123";
        QTest::newRow("api_key") << "API_KEY: \"abcd1234efgh\"" << "abcd1234efgh";
        QTest::newRow("jwt") << "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U" << "dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
        QTest::newRow("pem") << "-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAK\n-----END RSA PRIVATE KEY-----" << "MIIBOgIBAAJBAK";
    }
    void masksKnownKeyFormats()
    {
        QFETCH(QString, input);
        QFETCH(QString, secret);
        const QString out = Redactor::redact(input);
        QVERIFY2(!out.contains(secret), qPrintable(out));
        QVERIFY(out.contains(QStringLiteral("REDACTED")));
    }

    void leavesOrdinaryTextAlone()
    {
        const QString s = QStringLiteral("npm test -- --watch=false && ctest --output-on-failure");
        QCOMPARE(Redactor::redact(s), s);
    }

    void jsonSecretKeysMaskedButCountersKept()
    {
        QJsonObject o{ { "api_key", "abc" }, { "total_input_tokens", 15500 }, { "password", "x" },
                       { "nested", QJsonObject{ { "access_token", "t0ken" }, { "path", "/tmp/a" } } } };
        const QJsonObject r = Redactor::redactObject(o);
        QCOMPARE(r.value("api_key").toString(), QStringLiteral("[REDACTED]"));
        QCOMPARE(r.value("password").toString(), QStringLiteral("[REDACTED]"));
        QCOMPARE(r.value("total_input_tokens").toInt(), 15500);
        QCOMPARE(r.value("nested").toObject().value("access_token").toString(), QStringLiteral("[REDACTED]"));
        QCOMPARE(r.value("nested").toObject().value("path").toString(), QStringLiteral("/tmp/a"));
    }

    void longStringsTruncated()
    {
        const QString big(10000, QLatin1Char('a'));
        const QString r = Redactor::redactJson(big, 100).toString();
        QVERIFY(r.size() < 200);
        QVERIFY(r.contains(QStringLiteral("truncated")));
    }
};

QTEST_GUILESS_MAIN(TestRedactor)
#include "tst_redactor.moc"
