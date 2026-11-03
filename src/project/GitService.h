#pragma once

#include <QHash>
#include <QObject>
#include <QString>
#include <QTimer>
#include <memory>
#include <vector>

namespace nexus::project {

enum class GitChange { None = 0, Modified = 1, Added = 2, Deleted = 3, Untracked = 4, Conflict = 5, Renamed = 6 };

struct GitFileStatus {
    QString path;       // relative to the repository root ('/'-separated)
    QString origPath;   // for renames
    QChar index = QLatin1Char(' ');
    QChar worktree = QLatin1Char(' ');
    GitChange change = GitChange::None;
    bool staged = false;
    bool unstaged = false;
    int added = 0;      // numstat vs HEAD (-1 for binary)
    int removed = 0;
};

struct GitCommit {
    QString hash;
    QString shortHash;
    QString author;
    QString subject;
    qint64 time = 0;    // seconds since epoch
};

struct GitState {
    bool isRepo = false;
    QString repoRoot;
    QString branch;
    QString upstream;
    QString headOid;
    int ahead = 0;
    int behind = 0;
    std::vector<GitFileStatus> files;
    QHash<QString, int> byPath;
    std::vector<GitCommit> log;
    qint64 refreshedAtMs = 0;
    QString error;
};

using GitStatePtr = std::shared_ptr<const GitState>;

QString gitChangeName(GitChange c);

// Runs git asynchronously on the thread pool. Never blocks the GUI thread.
class GitService : public QObject
{
    Q_OBJECT
public:
    explicit GitService(QObject *parent = nullptr);

    void setRoot(const QString &root);
    QString root() const { return m_root; }
    GitStatePtr state() const { return m_state; }

    void refreshSoon(int delayMs = 350);   // debounced
    void refreshNow();
    void requestDiff(const QString &relPath);

    // Consequential actions. Callers must have obtained user confirmation.
    void stage(const QString &relPath);
    void unstage(const QString &relPath);
    // Discards working-tree changes. A copy of the current file is first written to
    // safetyDir so the action is always recoverable.
    void discard(const QString &relPath, const QString &safetyDir);

    // Pure parsing helpers (exposed for tests)
    static void parsePorcelainV2(const QByteArray &data, GitState &state);
    static void parseNumstat(const QByteArray &data, GitState &state);
    static std::vector<GitCommit> parseLog(const QByteArray &data);

signals:
    void stateChanged();
    void diffReady(const QString &relPath, const QString &diff);
    void actionFinished(bool ok, const QString &message);

private:
    void runAction(const QStringList &args, const QString &label);

    QString m_root;
    GitStatePtr m_state;
    QTimer m_debounce;
    bool m_running = false;
    bool m_pending = false;
};

} // namespace nexus::project
