#include "ChangeReview.h"
#include "ProjectScene.h"

#include "core/Paths.h"
#include "core/Redactor.h"
#include "project/GitService.h"
#include "session/SessionEngine.h"

#include <QDir>
#include <QFileInfo>
#include <QRegularExpression>
#include <QSettings>
#include <QSet>

namespace nexus::app {

using project::GitChange;

ChangeReview::ChangeReview(project::GitService *git, session::SessionEngine *engine, ProjectScene *project, QObject *parent)
    : QObject(parent), m_git(git), m_engine(engine), m_project(project)
{
    connect(git, &project::GitService::stateChanged, this, &ChangeReview::rebuild);
    connect(git, &project::GitService::diffReady, this, [this](const QString &rel, const QString &text) {
        if (rel != m_selected) return;
        m_diff = parseUnifiedDiff(text);
        m_diffLoading = false;
        emit diffChanged();
    });
    connect(git, &project::GitService::actionFinished, this, [this](bool ok, const QString &msg) {
        emit actionResult(ok, msg);
        if (!m_selected.isEmpty()) select(m_selected);
    });
    connect(engine, &session::SessionEngine::eventIngested, this, [this](const core::NexusEvent &e, int, bool live) {
        if (live && e.category == QLatin1String("write") && e.kind == QLatin1String("tool.post") && !e.simulated)
            m_git->refreshSoon(250);
    });
    connect(project, &ProjectScene::projectChanged, this, [this]() {
        m_testCommand = QSettings().value(QStringLiteral("tests/") + m_project->projectRoot()).toString();
        if (m_testCommand.isEmpty()) m_testCommand = suggestTestCommand();
        emit testCommandChanged();
    });
}

QString ChangeReview::branch() const { auto s = m_git->state(); return s ? s->branch : QString(); }
QString ChangeReview::upstream() const { auto s = m_git->state(); return s ? s->upstream : QString(); }
int ChangeReview::ahead() const { auto s = m_git->state(); return s ? s->ahead : 0; }
int ChangeReview::behind() const { auto s = m_git->state(); return s ? s->behind : 0; }
bool ChangeReview::isRepo() const { auto s = m_git->state(); return s && s->isRepo; }
qint64 ChangeReview::refreshedAt() const { auto s = m_git->state(); return s ? s->refreshedAtMs : 0; }

void ChangeReview::refresh() { m_git->refreshNow(); }

QString ChangeReview::absolutePath(const QString &relPath) const
{
    const auto st = m_git->state();
    const QString root = st && !st->repoRoot.isEmpty() ? st->repoRoot : m_project->projectRoot();
    return root + QLatin1Char('/') + relPath;
}

void ChangeReview::rebuild()
{
    const auto st = m_git->state();
    m_files.clear();
    m_commits.clear();
    m_agentOnly.clear();
    m_added = m_removed = 0;
    QSet<QString> changedAbs;
    if (st && st->isRepo) {
        for (const auto &f : st->files) {
            const QString abs = st->repoRoot + QLatin1Char('/') + f.path;
            changedAbs.insert(abs);
            const QVariantMap act = m_engine->fileActivity(abs);
            QStringList colors;
            for (const QVariant &sid : act.value(QStringLiteral("sessions")).toList())
                colors << m_engine->colorForSession(sid.toString());
            const QString dir = f.path.section(QLatin1Char('/'), 0, -2);
            m_files.append(QVariantMap{
                { QStringLiteral("path"), f.path }, { QStringLiteral("name"), f.path.section(QLatin1Char('/'), -1) },
                { QStringLiteral("dir"), dir }, { QStringLiteral("change"), project::gitChangeName(f.change) },
                { QStringLiteral("staged"), f.staged }, { QStringLiteral("unstaged"), f.unstaged },
                { QStringLiteral("added"), f.added }, { QStringLiteral("removed"), f.removed },
                { QStringLiteral("origPath"), f.origPath }, { QStringLiteral("agentWrites"), act.value(QStringLiteral("writes")) },
                { QStringLiteral("agentReads"), act.value(QStringLiteral("reads")) },
                { QStringLiteral("agentColors"), colors }, { QStringLiteral("lastAgentTouch"), act.value(QStringLiteral("last")) } });
            if (f.added > 0) m_added += f.added;
            if (f.removed > 0) m_removed += f.removed;
        }
        for (const auto &c : st->log)
            m_commits.append(QVariantMap{ { QStringLiteral("hash"), c.hash }, { QStringLiteral("short"), c.shortHash },
                                          { QStringLiteral("author"), c.author }, { QStringLiteral("subject"), c.subject },
                                          { QStringLiteral("time"), c.time * 1000 } });
    }
    // files written by agents that currently show no git change (committed, reverted, or outside the repo)
    for (const QVariant &v : m_engine->touchedFiles(300)) {
        const QVariantMap m = v.toMap();
        if (m.value(QStringLiteral("writes")).toInt() <= 0) continue;
        const QString path = m.value(QStringLiteral("path")).toString();
        if (changedAbs.contains(path)) continue;
        m_agentOnly.append(QVariantMap{ { QStringLiteral("path"), path }, { QStringLiteral("name"), QFileInfo(path).fileName() },
                                        { QStringLiteral("writes"), m.value(QStringLiteral("writes")) },
                                        { QStringLiteral("simulated"), m.value(QStringLiteral("simulated")) },
                                        { QStringLiteral("last"), m.value(QStringLiteral("last")) } });
    }
    emit changed();
    if (!m_selected.isEmpty()) {
        bool still = false;
        for (const QVariant &v : m_files) if (v.toMap().value(QStringLiteral("path")).toString() == m_selected) still = true;
        if (still) m_git->requestDiff(m_selected);
    }
}

void ChangeReview::select(const QString &relPath)
{
    m_selected = relPath;
    emit selectionChanged();
    if (relPath.isEmpty()) { m_diff.clear(); emit diffChanged(); return; }
    m_diffLoading = true;
    emit diffChanged();
    m_git->requestDiff(relPath);
}

void ChangeReview::stage(const QString &relPath) { m_git->stage(relPath); }
void ChangeReview::unstage(const QString &relPath) { m_git->unstage(relPath); }
void ChangeReview::discard(const QString &relPath) { m_git->discard(relPath, core::Paths::safetyDir()); }

void ChangeReview::setTestCommand(const QString &c)
{
    if (c == m_testCommand) return;
    m_testCommand = c;
    QSettings().setValue(QStringLiteral("tests/") + m_project->projectRoot(), c);
    emit testCommandChanged();
}

QString ChangeReview::suggestTestCommand() const
{
    const QString root = m_project->projectRoot();
    auto has = [&](const QString &f) { return QFileInfo::exists(root + QLatin1Char('/') + f); };
    if (has(QStringLiteral("CMakeLists.txt")) && QFileInfo::exists(root + QStringLiteral("/build/CTestTestfile.cmake")))
        return QStringLiteral("ctest --test-dir build --output-on-failure");
    if (has(QStringLiteral("package.json"))) return QStringLiteral("npm test");
    if (has(QStringLiteral("Cargo.toml"))) return QStringLiteral("cargo test");
    if (has(QStringLiteral("go.mod"))) return QStringLiteral("go test ./...");
    if (has(QStringLiteral("pyproject.toml")) || has(QStringLiteral("pytest.ini")) || has(QStringLiteral("setup.py"))) return QStringLiteral("pytest");
    if (has(QStringLiteral("CMakeLists.txt"))) return QStringLiteral("ctest --test-dir build --output-on-failure");
    return {};
}

void ChangeReview::runTests()
{
    if (m_testCommand.trimmed().isEmpty() || (m_testProc && m_testProc->state() != QProcess::NotRunning))
        return;
    m_testOutput.clear();
    m_testState = QStringLiteral("running");
    emit testChanged();
    m_testProc = new QProcess(this);
    m_testProc->setWorkingDirectory(m_project->projectRoot());
    m_testProc->setProcessChannelMode(QProcess::MergedChannels);
    connect(m_testProc, &QProcess::readyRead, this, [this]() {
        const QString text = QString::fromUtf8(m_testProc->readAll());
        for (const QString &l : text.split(QLatin1Char('\n'), Qt::SkipEmptyParts)) {
            m_testOutput.append(core::Redactor::redact(l));
            if (m_testOutput.size() > 800) m_testOutput.removeFirst();
        }
        emit testChanged();
    });
    connect(m_testProc, &QProcess::finished, this, [this](int code) {
        m_testState = code == 0 ? QStringLiteral("passed") : QStringLiteral("failed");
        m_testOutput.append(QStringLiteral("— exit code %1 —").arg(code));
        emit testChanged();
        m_testProc->deleteLater();
    });
#ifdef Q_OS_WIN
    m_testProc->start(QStringLiteral("cmd"), { QStringLiteral("/c"), m_testCommand });
#else
    m_testProc->start(QStringLiteral("/bin/sh"), { QStringLiteral("-c"), m_testCommand });
#endif
}

void ChangeReview::stopTests()
{
    if (m_testProc && m_testProc->state() != QProcess::NotRunning) {
        m_testProc->terminate();
        m_testState = QStringLiteral("stopped");
        emit testChanged();
    }
}

QVariantList ChangeReview::parseUnifiedDiff(const QString &text)
{
    QVariantList out;
    static const QRegularExpression hunk(QStringLiteral("^@@ -(\\d+)(?:,\\d+)? \\+(\\d+)(?:,\\d+)? @@(.*)$"));
    int oldNo = 0, newNo = 0;
    for (const QString &line : text.split(QLatin1Char('\n'))) {
        if (line.startsWith(QLatin1String("diff --git")) || line.startsWith(QLatin1String("index ")) || line.startsWith(QLatin1String("new file"))
            || line.startsWith(QLatin1String("deleted file")) || line.startsWith(QLatin1String("similarity")) || line.startsWith(QLatin1String("rename ")))
            continue;
        if (line.startsWith(QLatin1String("--- ")) || line.startsWith(QLatin1String("+++ "))) continue;
        if (line.startsWith(QLatin1String("Binary files"))) {
            out.append(QVariantMap{ { QStringLiteral("t"), QStringLiteral("h") }, { QStringLiteral("s"), line } });
            continue;
        }
        const auto m = hunk.match(line);
        if (m.hasMatch()) {
            oldNo = m.captured(1).toInt();
            newNo = m.captured(2).toInt();
            out.append(QVariantMap{ { QStringLiteral("t"), QStringLiteral("h") }, { QStringLiteral("s"), line } });
            continue;
        }
        if (line.isEmpty() && out.isEmpty()) continue;
        const QChar c = line.isEmpty() ? QLatin1Char(' ') : line.at(0);
        const QString body = line.mid(1);
        if (c == QLatin1Char('+')) out.append(QVariantMap{ { QStringLiteral("t"), QStringLiteral("+") }, { QStringLiteral("s"), body }, { QStringLiteral("n"), newNo++ } });
        else if (c == QLatin1Char('-')) out.append(QVariantMap{ { QStringLiteral("t"), QStringLiteral("-") }, { QStringLiteral("s"), body }, { QStringLiteral("o"), oldNo++ } });
        else if (c == QLatin1Char('\\')) out.append(QVariantMap{ { QStringLiteral("t"), QStringLiteral("h") }, { QStringLiteral("s"), line } });
        else out.append(QVariantMap{ { QStringLiteral("t"), QStringLiteral(" ") }, { QStringLiteral("s"), body }, { QStringLiteral("o"), oldNo++ }, { QStringLiteral("n"), newNo++ } });
        if (out.size() > 6000) {
            out.append(QVariantMap{ { QStringLiteral("t"), QStringLiteral("h") }, { QStringLiteral("s"), QStringLiteral("… diff view truncated at 6000 lines …") } });
            break;
        }
    }
    while (!out.isEmpty() && out.last().toMap().value(QStringLiteral("t")).toString() == QLatin1String(" ")
           && out.last().toMap().value(QStringLiteral("s")).toString().isEmpty())
        out.removeLast();
    return out;
}

} // namespace nexus::app
