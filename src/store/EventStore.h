#pragma once

#include "core/NexusEvent.h"

#include <QObject>
#include <QVariantList>

class QThread;

namespace nexus::store {

class EventStoreWorker : public QObject
{
    Q_OBJECT
public:
    explicit EventStoreWorker(QString path);
    ~EventStoreWorker() override;

public slots:
    void open();
    void append(const nexus::core::EventList &events);
    void loadRecent(int limit, qint64 sinceMs, bool includeSimulated);
    void addBookmark(const QString &projectRoot, const QString &path, const QString &note);
    void removeBookmark(qint64 id);
    void loadBookmarks(const QString &projectRoot);
    void purgeSimulated();
    void close();

signals:
    void opened(bool ok, const QString &message, qint64 eventCount);
    void recentLoaded(const nexus::core::EventList &events);
    void bookmarksLoaded(const QVariantList &bookmarks);
    void appended(int count);

private:
    bool exec(const QString &sql);
    QString m_path;
    QString m_conn;
    bool m_ok = false;
};

// GUI-thread facade. All database work happens on the store thread.
class EventStore : public QObject
{
    Q_OBJECT
public:
    explicit EventStore(const QString &path, QObject *parent = nullptr);
    ~EventStore() override;

    void start();
    void append(const core::EventList &events);
    void loadRecent(int limit, qint64 sinceMs, bool includeSimulated = false);
    void addBookmark(const QString &projectRoot, const QString &path, const QString &note);
    void removeBookmark(qint64 id);
    void loadBookmarks(const QString &projectRoot);
    void purgeSimulated();

    bool isOpen() const { return m_open; }
    QString status() const { return m_status; }
    qint64 storedCount() const { return m_count; }

signals:
    void opened(bool ok);
    void recentLoaded(const nexus::core::EventList &events);
    void bookmarksLoaded(const QVariantList &bookmarks);
    void countChanged();

private:
    QThread *m_thread = nullptr;
    EventStoreWorker *m_worker = nullptr;
    bool m_open = false;
    QString m_status;
    qint64 m_count = 0;
};

} // namespace nexus::store
