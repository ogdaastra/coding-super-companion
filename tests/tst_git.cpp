#include "project/GitService.h"

#include <QTest>

using namespace nexus::project;

class TestGit : public QObject
{
    Q_OBJECT
private slots:
    void porcelainV2()
    {
        QByteArray data;
        data += "# branch.oid 1234abcd\0"_qba;
        data += "# branch.head main\0"_qba;
        data += "# branch.upstream origin/main\0"_qba;
        data += "# branch.ab +2 -1\0"_qba;
        data += "1 .M N... 100644 100644 100644 aaa bbb src/file with space.cpp\0"_qba;
        data += "1 A. N... 000000 100644 100644 000 ccc src/new.h\0"_qba;
        data += "2 R. N... 100644 100644 100644 ddd eee R100 src/renamed.cpp\0src/old.cpp\0"_qba;
        data += "u UU N... 100644 100644 100644 100644 f1 f2 f3 conflict.txt\0"_qba;
        data += "? untracked.md\0"_qba;
        GitState st;
        GitService::parsePorcelainV2(data, st);
        QCOMPARE(st.branch, QStringLiteral("main"));
        QCOMPARE(st.upstream, QStringLiteral("origin/main"));
        QCOMPARE(st.ahead, 2);
        QCOMPARE(st.behind, 1);
        QCOMPARE(int(st.files.size()), 5);
        QCOMPARE(st.files[0].path, QStringLiteral("src/file with space.cpp"));
        QCOMPARE(st.files[0].change, GitChange::Modified);
        QVERIFY(!st.files[0].staged);
        QVERIFY(st.files[0].unstaged);
        QCOMPARE(st.files[1].change, GitChange::Added);
        QVERIFY(st.files[1].staged);
        QCOMPARE(st.files[2].change, GitChange::Renamed);
        QCOMPARE(st.files[2].origPath, QStringLiteral("src/old.cpp"));
        QCOMPARE(st.files[3].change, GitChange::Conflict);
        QCOMPARE(st.files[4].change, GitChange::Untracked);
    }

    void numstat()
    {
        GitState st;
        GitService::parsePorcelainV2("1 .M N... 100644 100644 100644 a b src/a.cpp\0"
                                     "1 .M N... 100644 100644 100644 a b img.png\0"
                                     "2 R. N... 100644 100644 100644 a b R90 src/new.cpp\0src/old.cpp\0"_qba, st);
        GitService::parseNumstat("10\t2\tsrc/a.cpp\n-\t-\timg.png\n3\t1\tsrc/{old.cpp => new.cpp}\n", st);
        QCOMPARE(st.files[0].added, 10);
        QCOMPARE(st.files[0].removed, 2);
        QCOMPARE(st.files[1].added, -1);
        QCOMPARE(st.files[2].added, 3);
    }

    void log()
    {
        const auto commits = GitService::parseLog("abc\x1f" "abc\x1f" "Ada\x1f" "1700000000\x1f" "Fix renderer\x1e\n"
                                                  "def\x1f" "def\x1f" "Bob\x1f" "1700000100\x1f" "Add tests\x1e\n");
        QCOMPARE(int(commits.size()), 2);
        QCOMPARE(commits[0].subject, QStringLiteral("Fix renderer"));
        QCOMPARE(commits[1].time, 1700000100);
    }
};

QTEST_GUILESS_MAIN(TestGit)
#include "tst_git.moc"
