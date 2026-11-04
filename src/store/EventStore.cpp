#include "EventStore.h"

#include <QDateTime>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QSqlDatabase>
#include <QSqlError>
#include <QSqlQuery>
#include <QThread>
#include <QUuid>
#include <QVariantMap>

namespace nexus::store {

using core::EventList;
using core::NexusEvent;

EventStoreWorker::EventStoreWorker(QString path)
    : m_path(std::move(path)), m_conn(QStringLiteral("nexus-store-") + QUuid::createUuid().toString(QUuid::WithoutBraces))
{
}

EventStoreWorker::~EventStoreWorker() = default;

void EventStoreWorker::close()
{
    // must run on the store thread: the connection belongs to it
    if (QSqlDatabase::contains(m_conn)) {
        {
            QSqlDatabase db = QSqlDatabase::database(m_conn, false);
            db.close();
        }
        QSqlDatabase::removeDatabase(m_conn);
    }
    m_ok = false;
}

bool EventStoreWorker::exec(const QString &sql)
{
    QSqlQuery q(QSqlDatabase::database(m_conn));
    if (!q.exec(sql)) {
        qWarning("NEXUS store: %s — %s", qPrintable(sql.left(80)), qPrintable(q.lastError().text()));
        return false;
    }
    return true;
}

void EventStoreWorker::open()
{
    QSqlDatabase db = QSqlDatabase::addDatabase(QStringLiteral("QSQLITE"), m_conn);
    db.setDatabaseName(m_path);
    if (!db.open()) {
        emit opened(false, db.lastError().text(), 0);
        return;
    }
    QFile::setPermissions(m_path, QFile::ReadOwner | QFile::WriteOwner);
    exec(QStringLiteral("PRAGMA journal_mode=WAL"));
    exec(QStringLiteral("PRAGMA synchronous=NORMAL"));
    exec(QStringLiteral("PRAGMA foreign_keys=ON"));
    m_ok = exec(QStringLiteral(
        "CREATE TABLE IF NOT EXISTS events ("
        " seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, ts INTEGER NOT NULL,"
        " source TEXT NOT NULL, simulated INTEGER NOT NULL DEFAULT 0, session_id TEXT, agent_id TEXT,"
        " kind TEXT NOT NULL, category TEXT, tool_name TEXT, tool_use_id TEXT, files TEXT,"
        " duration_ms INTEGER, ok INTEGER, summary TEXT, provenance TEXT, payload TEXT)"))
        && exec(QStringLiteral("CREATE INDEX IF NOT EXISTS events_session_ts ON events(session_id, ts)"))
        && exec(QStringLiteral("CREATE INDEX IF NOT EXISTS events_ts ON events(ts)"))
        && exec(QStringLiteral(
            "CREATE TABLE IF NOT EXISTS bookmarks (id INTEGER PRIMARY KEY AUTOINCREMENT, project_root TEXT NOT NULL,"
            " path TEXT NOT NULL, note TEXT, created_ts INTEGER NOT NULL)"))
        && exec(QStringLiteral("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)"));
    exec(QStringLiteral("INSERT OR IGNORE INTO meta(key, value) VALUES('schema_version', '1')"));
    // Retention: 30 days of history.
    const qint64 cutoff = QDateTime::currentMSecsSinceEpoch() - qint64(30) * 24 * 3600 * 1000;
    QSqlQuery purge(db);
    purge.prepare(QStringLiteral("DELETE FROM events WHERE ts < ?"));
    purge.addBindValue(cutoff);
    purge.exec();
    QSqlQuery count(db);
    qint64 n = 0;
    if (count.exec(QStringLiteral("SELECT COUNT(*) FROM events")) && count.next())
        n = count.value(0).toLongLong();
    emit opened(m_ok, m_ok ? QStringLiteral("SQLite (WAL) at ") + m_path : db.lastError().text(), n);
}

void EventStoreWorker::append(const EventList &events)
{
    if (!m_ok || events.isEmpty())
        return;
    QSqlDatabase db = QSqlDatabase::database(m_conn);
    db.transaction();
    QSqlQuery q(db);
    q.prepare(QStringLiteral(
        "INSERT OR IGNORE INTO events (id, ts, source, simulated, session_id, agent_id, kind, category, tool_name,"
        " tool_use_id, files, duration_ms, ok, summary, provenance, payload)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"));
    int n = 0;
    for (const NexusEvent &e : events) {
        q.addBindValue(e.id);
        q.addBindValue(e.ts);
        q.addBindValue(NexusEvent::sourceName(e.source));
        q.addBindValue(e.simulated ? 1 : 0);
        q.addBindValue(e.sessionId);
        q.addBindValue(e.agentId);
        q.addBindValue(e.kind);
        q.addBindValue(e.category);
        q.addBindValue(e.toolName);
        q.addBindValue(e.toolUseId);
        q.addBindValue(QString::fromUtf8(QJsonDocument(QJsonArray::fromStringList(e.files)).toJson(QJsonDocument::Compact)));
        q.addBindValue(e.durationMs >= 0 ? QVariant(e.durationMs) : QVariant());
        q.addBindValue(e.ok >= 0 ? QVariant(e.ok) : QVariant());
        q.addBindValue(e.summary);
        q.addBindValue(NexusEvent::provenanceName(e.provenance));
        // the full normalised event (including derived fields) is kept as JSON
        q.addBindValue(QString::fromUtf8(QJsonDocument(e.toJson()).toJson(QJsonDocument::Compact)));
        if (q.exec()) ++n;
    }
    db.commit();
    emit appended(n);
}

void EventStoreWorker::loadRecent(int limit, qint64 sinceMs, bool includeSimulated)
{
    EventList out;
    if (m_ok) {
        QSqlQuery q(QSqlDatabase::database(m_conn));
        q.prepare(QStringLiteral("SELECT seq, payload FROM events WHERE ts >= ? %1 ORDER BY ts DESC, seq DESC LIMIT ?")
                      .arg(includeSimulated ? QString() : QStringLiteral("AND simulated = 0")));
        q.addBindValue(sinceMs);
        q.addBindValue(limit);
        if (q.exec()) {
            while (q.next()) {
                NexusEvent e = NexusEvent::fromJson(QJsonDocument::fromJson(q.value(1).toString().toUtf8()).object());
                e.seq = q.value(0).toLongLong();
                out.prepend(e);
            }
        }
    }
    emit recentLoaded(out);
}

void EventStoreWorker::addBookmark(const QString &projectRoot, const QString &path, const QString &note)
{
    if (!m_ok) return;
    QSqlQuery q(QSqlDatabase::database(m_conn));
    q.prepare(QStringLiteral("INSERT INTO bookmarks(project_root, path, note, created_ts) VALUES(?,?,?,?)"));
    q.addBindValue(projectRoot);
    q.addBindValue(path);
    q.addBindValue(note);
    q.addBindValue(QDateTime::currentMSecsSinceEpoch());
    q.exec();
    loadBookmarks(projectRoot);
}

void EventStoreWorker::removeBookmark(qint64 id)
{
    if (!m_ok) return;
    QSqlQuery sel(QSqlDatabase::database(m_conn));
    sel.prepare(QStringLiteral("SELECT project_root FROM bookmarks WHERE id = ?"));
    sel.addBindValue(id);
    QString root;
    if (sel.exec() && sel.next()) root = sel.value(0).toString();
    QSqlQuery q(QSqlDatabase::database(m_conn));
    q.prepare(QStringLiteral("DELETE FROM bookmarks WHERE id = ?"));
    q.addBindValue(id);
    q.exec();
    loadBookmarks(root);
}

void EventStoreWorker::loadBookmarks(const QString &projectRoot)
{
    QVariantList out;
    if (m_ok) {
        QSqlQuery q(QSqlDatabase::database(m_conn));
        q.prepare(QStringLiteral("SELECT id, path, note, created_ts FROM bookmarks WHERE project_root = ? ORDER BY created_ts DESC"));
        q.addBindValue(projectRoot);
        if (q.exec()) {
            while (q.next())
                out.append(QVariantMap{ { QStringLiteral("id"), q.value(0) }, { QStringLiteral("path"), q.value(1) },
                                        { QStringLiteral("note"), q.value(2) }, { QStringLiteral("created"), q.value(3) } });
        }
    }
    emit bookmarksLoaded(out);
}

void EventStoreWorker::purgeSimulated()
{
    if (m_ok) exec(QStringLiteral("DELETE FROM events WHERE simulated = 1"));
}

EventStore::EventStore(const QString &path, QObject *parent)
    : QObject(parent)
{
    qRegisterMetaType<EventList>("nexus::core::EventList");
    m_thread = new QThread(this);
    m_thread->setObjectName(QStringLiteral("nexus-store"));
    m_worker = new EventStoreWorker(path);
    m_worker->moveToThread(m_thread);
    connect(m_thread, &QThread::started, m_worker, &EventStoreWorker::open);
    connect(m_worker, &EventStoreWorker::opened, this, [this](bool ok, const QString &msg, qint64 count) {
        m_open = ok;
        m_status = msg;
        m_count = count;
        emit opened(ok);
        emit countChanged();
    });
    connect(m_worker, &EventStoreWorker::appended, this, [this](int n) {
        m_count += n;
        emit countChanged();
    });
    connect(m_worker, &EventStoreWorker::recentLoaded, this, &EventStore::recentLoaded);
    connect(m_worker, &EventStoreWorker::bookmarksLoaded, this, &EventStore::bookmarksLoaded);
}

EventStore::~EventStore()
{
    if (m_thread->isRunning())
        QMetaObject::invokeMethod(m_worker, &EventStoreWorker::close, Qt::BlockingQueuedConnection);
    m_thread->quit();
    m_thread->wait(5000);
    delete m_worker;
}

void EventStore::start() { m_thread->start(); }

void EventStore::append(const EventList &events)
{
    QMetaObject::invokeMethod(m_worker, [w = m_worker, events]() { w->append(events); }, Qt::QueuedConnection);
}

void EventStore::loadRecent(int limit, qint64 sinceMs, bool includeSimulated)
{
    QMetaObject::invokeMethod(m_worker, [w = m_worker, limit, sinceMs, includeSimulated]() { w->loadRecent(limit, sinceMs, includeSimulated); },
                              Qt::QueuedConnection);
}

void EventStore::addBookmark(const QString &projectRoot, const QString &path, const QString &note)
{
    QMetaObject::invokeMethod(m_worker, [w = m_worker, projectRoot, path, note]() { w->addBookmark(projectRoot, path, note); }, Qt::QueuedConnection);
}

void EventStore::removeBookmark(qint64 id)
{
    QMetaObject::invokeMethod(m_worker, [w = m_worker, id]() { w->removeBookmark(id); }, Qt::QueuedConnection);
}

void EventStore::loadBookmarks(const QString &projectRoot)
{
    QMetaObject::invokeMethod(m_worker, [w = m_worker, projectRoot]() { w->loadBookmarks(projectRoot); }, Qt::QueuedConnection);
}

void EventStore::purgeSimulated()
{
    QMetaObject::invokeMethod(m_worker, [w = m_worker]() { w->purgeSimulated(); }, Qt::QueuedConnection);
}

} // namespace nexus::store
