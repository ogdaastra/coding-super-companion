#pragma once

#include <QObject>
#include <QPointer>
#include <QProcess>
#include <QVariantList>

namespace nexus::project { class GitService; }
namespace nexus::session { class SessionEngine; }

namespace nexus::app {

class ProjectScene;

// Change intelligence: git working-tree state, agent attribution of changes, diff
// inspection and safe, confirmed actions.
class ChangeReview : public QObject
{
    Q_OBJECT
    Q_PROPERTY(QVariantList files READ files NOTIFY changed)
    Q_PROPERTY(QVariantList commits READ commits NOTIFY changed)
    Q_PROPERTY(QVariantList agentOnly READ agentOnly NOTIFY changed)
    Q_PROPERTY(QString branch READ branch NOTIFY changed)
    Q_PROPERTY(QString upstream READ upstream NOTIFY changed)
    Q_PROPERTY(int ahead READ ahead NOTIFY changed)
    Q_PROPERTY(int behind READ behind NOTIFY changed)
    Q_PROPERTY(bool isRepo READ isRepo NOTIFY changed)
    Q_PROPERTY(int totalAdded READ totalAdded NOTIFY changed)
    Q_PROPERTY(int totalRemoved READ totalRemoved NOTIFY changed)
    Q_PROPERTY(QString selected READ selected NOTIFY selectionChanged)
    Q_PROPERTY(QVariantList diff READ diff NOTIFY diffChanged)
    Q_PROPERTY(bool diffLoading READ diffLoading NOTIFY diffChanged)
    Q_PROPERTY(QString testCommand READ testCommand WRITE setTestCommand NOTIFY testCommandChanged)
    Q_PROPERTY(QString testState READ testState NOTIFY testChanged)
    Q_PROPERTY(QStringList testOutput READ testOutput NOTIFY testChanged)
    Q_PROPERTY(qint64 refreshedAt READ refreshedAt NOTIFY changed)

public:
    ChangeReview(project::GitService *git, session::SessionEngine *engine, ProjectScene *project, QObject *parent = nullptr);

    QVariantList files() const { return m_files; }
    QVariantList commits() const { return m_commits; }
    QVariantList agentOnly() const { return m_agentOnly; }
    QString branch() const;
    QString upstream() const;
    int ahead() const;
    int behind() const;
    bool isRepo() const;
    int totalAdded() const { return m_added; }
    int totalRemoved() const { return m_removed; }
    QString selected() const { return m_selected; }
    QVariantList diff() const { return m_diff; }
    bool diffLoading() const { return m_diffLoading; }
    QString testCommand() const { return m_testCommand; }
    void setTestCommand(const QString &c);
    QString testState() const { return m_testState; }
    QStringList testOutput() const { return m_testOutput; }
    qint64 refreshedAt() const;

    Q_INVOKABLE void refresh();
    Q_INVOKABLE void select(const QString &relPath);
    Q_INVOKABLE void stage(const QString &relPath);
    Q_INVOKABLE void unstage(const QString &relPath);
    Q_INVOKABLE void discard(const QString &relPath);   // UI must confirm first
    Q_INVOKABLE void runTests();                         // UI must confirm first
    Q_INVOKABLE void stopTests();
    Q_INVOKABLE QString suggestTestCommand() const;
    Q_INVOKABLE QString absolutePath(const QString &relPath) const;

    static QVariantList parseUnifiedDiff(const QString &text);

signals:
    void changed();
    void selectionChanged();
    void diffChanged();
    void testCommandChanged();
    void testChanged();
    void actionResult(bool ok, const QString &message);

private:
    void rebuild();

    project::GitService *m_git;
    session::SessionEngine *m_engine;
    ProjectScene *m_project;
    QVariantList m_files;
    QVariantList m_commits;
    QVariantList m_agentOnly;
    int m_added = 0;
    int m_removed = 0;
    QString m_selected;
    QVariantList m_diff;
    bool m_diffLoading = false;
    QString m_testCommand;
    QString m_testState = QStringLiteral("idle");
    QStringList m_testOutput;
    QPointer<QProcess> m_testProc;
};

} // namespace nexus::app
