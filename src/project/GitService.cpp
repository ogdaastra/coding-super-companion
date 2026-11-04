#include "GitService.h"

#include <QDateTime>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QPointer>
#include <QProcess>
#include <QtConcurrent/QtConcurrentRun>

namespace nexus::project {

namespace {

struct GitResult {
    int exitCode = -1;
    QByteArray out;
    QByteArray err;
};

GitResult runGit(const QString &cwd, const QStringList &args, int timeoutMs = 20000)
{
    QProcess p;
    p.setWorkingDirectory(cwd);
    // Never let git open an editor or a pager, and never prompt for credentials.
    QProcessEnvironment env = QProcessEnvironment::systemEnvironment();
    env.insert(QStringLiteral("GIT_TERMINAL_PROMPT"), QStringLiteral("0"));
    env.insert(QStringLiteral("GIT_PAGER"), QStringLiteral("cat"));
    env.insert(QStringLiteral("GIT_OPTIONAL_LOCKS"), QStringLiteral("0"));
    p.setProcessEnvironment(env);
    p.start(QStringLiteral("git"), args);
    GitResult r;
    if (!p.waitForStarted(5000)) {
        r.err = "git could not be started";
        return r;
    }
    p.closeWriteChannel();
    if (!p.waitForFinished(timeoutMs)) {
        p.kill();
        p.waitForFinished(1000);
        r.err = "git timed out";
        return r;
    }
    r.exitCode = p.exitCode();
    r.out = p.readAllStandardOutput();
    r.err = p.readAllStandardError();
    return r;
}

GitChange changeFor(QChar x, QChar y)
{
    if (x == QLatin1Char('?'))
        return GitChange::Untracked;
    if (x == QLatin1Char('A') || y == QLatin1Char('A'))
        return GitChange::Added;
    if (x == QLatin1Char('D') || y == QLatin1Char('D'))
        return GitChange::Deleted;
    if (x == QLatin1Char('R') || y == QLatin1Char('R') || x == QLatin1Char('C'))
        return GitChange::Renamed;
    if (x != QLatin1Char('.') || y != QLatin1Char('.'))
        return GitChange::Modified;
    return GitChange::None;
}

} // namespace

QString gitChangeName(GitChange c)
{
    switch (c) {
    case GitChange::Modified: return QStringLiteral("modified");
    case GitChange::Added: return QStringLiteral("added");
    case GitChange::Deleted: return QStringLiteral("deleted");
    case GitChange::Untracked: return QStringLiteral("untracked");
    case GitChange::Conflict: return QStringLiteral("conflict");
    case GitChange::Renamed: return QStringLiteral("renamed");
    default: return QStringLiteral("clean");
    }
}

GitService::GitService(QObject *parent)
    : QObject(parent), m_state(std::make_shared<GitState>())
{
    m_debounce.setSingleShot(true);
    connect(&m_debounce, &QTimer::timeout, this, &GitService::refreshNow);
}

void GitService::setRoot(const QString &root)
{
    m_root = root;
    m_state = std::make_shared<GitState>();
    emit stateChanged();
    refreshSoon(0);
}

void GitService::refreshSoon(int delayMs)
{
    m_debounce.start(delayMs);
}

void GitService::parsePorcelainV2(const QByteArray &data, GitState &st)
{
    const QList<QByteArray> tokens = data.split('\0');
    for (int i = 0; i < tokens.size(); ++i) {
        const QByteArray &t = tokens[i];
        if (t.isEmpty())
            continue;
        if (t.startsWith("# ")) {
            const QByteArray rest = t.mid(2);
            if (rest.startsWith("branch.oid ")) st.headOid = QString::fromUtf8(rest.mid(11));
            else if (rest.startsWith("branch.head ")) st.branch = QString::fromUtf8(rest.mid(12));
            else if (rest.startsWith("branch.upstream ")) st.upstream = QString::fromUtf8(rest.mid(16));
            else if (rest.startsWith("branch.ab ")) {
                const QList<QByteArray> ab = rest.mid(10).split(' ');
                if (ab.size() == 2) {
                    st.ahead = ab[0].mid(1).toInt();
                    st.behind = ab[1].mid(1).toInt();
                }
            }
            continue;
        }
        GitFileStatus fs;
        const char type = t.at(0);
        if (type == '?') {
            fs.path = QString::fromUtf8(t.mid(2));
            fs.index = QLatin1Char('?');
            fs.worktree = QLatin1Char('?');
            fs.change = GitChange::Untracked;
            fs.unstaged = true;
        } else if (type == '1' || type == '2' || type == 'u') {
            const QList<QByteArray> f = t.split(' ');
            if (f.size() < 2)
                continue;
            fs.index = QLatin1Char(f[1].at(0));
            fs.worktree = QLatin1Char(f[1].at(1));
            const int fieldsBeforePath = type == '1' ? 8 : (type == '2' ? 9 : 10);
            // the path may itself contain spaces: rejoin everything after the fixed fields
            QByteArray path;
            for (int k = fieldsBeforePath; k < f.size(); ++k) {
                if (k > fieldsBeforePath) path += ' ';
                path += f[k];
            }
            fs.path = QString::fromUtf8(path);
            if (type == '2' && i + 1 < tokens.size())
                fs.origPath = QString::fromUtf8(tokens[++i]);
            fs.change = type == 'u' ? GitChange::Conflict : changeFor(fs.index, fs.worktree);
            fs.staged = fs.index != QLatin1Char('.');
            fs.unstaged = fs.worktree != QLatin1Char('.');
        } else {
            continue;
        }
        st.byPath.insert(fs.path, int(st.files.size()));
        st.files.push_back(fs);
    }
}

void GitService::parseNumstat(const QByteArray &data, GitState &st)
{
    for (const QByteArray &line : data.split('\n')) {
        const QList<QByteArray> f = line.split('\t');
        if (f.size() < 3)
            continue;
        QString path = QString::fromUtf8(f[2]);
        // renames are printed as "old => new" or "dir/{old => new}"
        if (path.contains(QLatin1String(" => "))) {
            if (path.contains(QLatin1Char('{'))) {
                const int a = int(path.indexOf(QLatin1Char('{'))), b = int(path.indexOf(QLatin1Char('}')));
                const QString inner = path.mid(a + 1, b - a - 1).section(QLatin1String(" => "), 1);
                path = path.left(a) + inner + path.mid(b + 1);
                path.replace(QLatin1String("//"), QLatin1String("/"));
            } else {
                path = path.section(QLatin1String(" => "), 1);
            }
        }
        const int idx = st.byPath.value(path, -1);
        if (idx < 0)
            continue;
        GitFileStatus &fs = st.files[size_t(idx)];
        fs.added = f[0] == "-" ? -1 : f[0].toInt();
        fs.removed = f[1] == "-" ? -1 : f[1].toInt();
    }
}

std::vector<GitCommit> GitService::parseLog(const QByteArray &data)
{
    std::vector<GitCommit> out;
    for (const QByteArray &rec : data.split('\x1e')) {
        const QByteArray r = rec.trimmed();
        if (r.isEmpty())
            continue;
        const QList<QByteArray> f = r.split('\x1f');
        if (f.size() < 5)
            continue;
        GitCommit c;
        c.hash = QString::fromUtf8(f[0]);
        c.shortHash = QString::fromUtf8(f[1]);
        c.author = QString::fromUtf8(f[2]);
        c.time = f[3].toLongLong();
        c.subject = QString::fromUtf8(f[4]);
        out.push_back(c);
    }
    return out;
}

void GitService::refreshNow()
{
    if (m_root.isEmpty())
        return;
    if (m_running) {
        m_pending = true;
        return;
    }
    m_running = true;
    const QString root = m_root;
    QPointer<GitService> self(this);
    auto future = QtConcurrent::run([root]() {
        auto st = std::make_shared<GitState>();
        const GitResult top = runGit(root, { QStringLiteral("rev-parse"), QStringLiteral("--show-toplevel") }, 5000);
        if (top.exitCode != 0) {
            st->isRepo = false;
            st->error = QString::fromUtf8(top.err).trimmed();
            return st;
        }
        st->isRepo = true;
        st->repoRoot = QString::fromUtf8(top.out).trimmed();
        const GitResult status = runGit(root, { QStringLiteral("status"), QStringLiteral("--porcelain=v2"), QStringLiteral("-z"),
                                                QStringLiteral("--branch"), QStringLiteral("--untracked-files=all") });
        if (status.exitCode == 0)
            parsePorcelainV2(status.out, *st);
        else
            st->error = QString::fromUtf8(status.err).trimmed();
        const bool hasHead = !st->headOid.isEmpty() && st->headOid != QLatin1String("(initial)");
        const GitResult num = runGit(root, hasHead ? QStringList{ QStringLiteral("diff"), QStringLiteral("--numstat"), QStringLiteral("HEAD") }
                                                   : QStringList{ QStringLiteral("diff"), QStringLiteral("--numstat"), QStringLiteral("--cached") });
        if (num.exitCode == 0)
            parseNumstat(num.out, *st);
        if (hasHead) {
            const GitResult log = runGit(root, { QStringLiteral("log"), QStringLiteral("-n"), QStringLiteral("60"),
                                                 QStringLiteral("--format=%H%x1f%h%x1f%an%x1f%at%x1f%s%x1e") });
            if (log.exitCode == 0)
                st->log = parseLog(log.out);
        }
        st->refreshedAtMs = QDateTime::currentMSecsSinceEpoch();
        return st;
    });
    future.then(this, [self](std::shared_ptr<GitState> st) {
        if (!self)
            return;
        self->m_running = false;
        self->m_state = st;
        emit self->stateChanged();
        if (self->m_pending) {
            self->m_pending = false;
            self->refreshSoon(200);
        }
    });
}

void GitService::requestDiff(const QString &relPath)
{
    if (m_root.isEmpty())
        return;
    const QString root = m_root;
    const GitStatePtr st = m_state;
    QPointer<GitService> self(this);
    QtConcurrent::run([root, relPath, st]() {
        const int idx = st->byPath.value(relPath, -1);
        const bool untracked = idx >= 0 && st->files[size_t(idx)].change == GitChange::Untracked;
        GitResult r;
        if (untracked) {
            r = runGit(root, { QStringLiteral("diff"), QStringLiteral("--no-color"), QStringLiteral("--no-index"),
                               QStringLiteral("--"), QStringLiteral("/dev/null"), relPath });
        } else {
            const bool hasHead = !st->headOid.isEmpty() && st->headOid != QLatin1String("(initial)");
            QStringList args = { QStringLiteral("diff"), QStringLiteral("--no-color"), QStringLiteral("-U3") };
            if (hasHead) args << QStringLiteral("HEAD");
            else args << QStringLiteral("--cached");
            args << QStringLiteral("--") << relPath;
            r = runGit(root, args);
        }
        QString text = QString::fromUtf8(r.out);
        if (text.size() > 400000)
            text = text.left(400000) + QStringLiteral("\n… diff truncated by NEXUS (over 400 kB) …\n");
        return text;
    }).then(this, [self, relPath](const QString &text) {
        if (self)
            emit self->diffReady(relPath, text);
    });
}

void GitService::runAction(const QStringList &args, const QString &label)
{
    const QString root = m_root;
    QPointer<GitService> self(this);
    QtConcurrent::run([root, args]() { return runGit(root, args); }).then(this, [self, label](const GitResult &r) {
        if (!self)
            return;
        const bool ok = r.exitCode == 0;
        emit self->actionFinished(ok, ok ? label : label + QStringLiteral(" failed: ") + QString::fromUtf8(r.err).trimmed());
        self->refreshSoon(50);
    });
}

void GitService::stage(const QString &relPath)
{
    runAction({ QStringLiteral("add"), QStringLiteral("--"), relPath }, QStringLiteral("Staged ") + relPath);
}

void GitService::unstage(const QString &relPath)
{
    runAction({ QStringLiteral("restore"), QStringLiteral("--staged"), QStringLiteral("--"), relPath },
              QStringLiteral("Unstaged ") + relPath);
}

void GitService::discard(const QString &relPath, const QString &safetyDir)
{
    const QString root = m_root;
    const GitStatePtr st = m_state;
    QPointer<GitService> self(this);
    QtConcurrent::run([root, relPath, safetyDir, st]() -> std::pair<bool, QString> {
        const QString abs = root + QLatin1Char('/') + relPath;
        // 1. Safety copy of the current content (if the file exists).
        const QString stamp = QDateTime::currentDateTime().toString(QStringLiteral("yyyyMMdd-HHmmss-zzz"));
        const QString backup = safetyDir + QLatin1Char('/') + stamp + QLatin1Char('/') + relPath;
        if (QFileInfo::exists(abs)) {
            QDir().mkpath(QFileInfo(backup).absolutePath());
            if (!QFile::copy(abs, backup))
                return { false, QStringLiteral("Could not write the safety copy; nothing was discarded.") };
        }
        const int idx = st->byPath.value(relPath, -1);
        const bool untracked = idx >= 0 && st->files[size_t(idx)].change == GitChange::Untracked;
        if (untracked) {
            // Never delete: the untracked file is *moved* to the safety area.
            if (!QFile::remove(abs))
                return { false, QStringLiteral("Could not remove the untracked file (a safety copy exists at ") + backup + QLatin1Char(')') };
            return { true, QStringLiteral("Moved untracked file to safety area: ") + backup };
        }
        const GitResult r = runGit(root, { QStringLiteral("restore"), QStringLiteral("--worktree"), QStringLiteral("--"), relPath });
        if (r.exitCode != 0)
            return { false, QString::fromUtf8(r.err).trimmed() };
        return { true, QStringLiteral("Discarded working-tree changes. Previous content saved to ") + backup };
    }).then(this, [self](const std::pair<bool, QString> &res) {
        if (!self)
            return;
        emit self->actionFinished(res.first, res.second);
        self->refreshSoon(50);
    });
}

} // namespace nexus::project
