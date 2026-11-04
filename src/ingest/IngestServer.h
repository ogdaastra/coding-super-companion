#pragma once

#include "core/NexusEvent.h"

#include <QByteArray>
#include <QObject>
#include <QPointer>
#include <QTimer>

class QLocalServer;
class QLocalSocket;
class QThread;

namespace nexus::ingest {

struct IngestStats {
    qint64 received = 0;
    qint64 rejected = 0;     // bad token
    qint64 malformed = 0;    // unparsable lines
    qint64 recovered = 0;    // events recovered from the spool
    qint64 dropped = 0;      // overflow (visual coalescing never drops stored events)
    bool listening = false;
    QString socketPath;
    QString error;
};

// Worker object living on its own thread. Accepts newline-delimited JSON envelopes from
// nexus-relay over a user-only local socket, authenticates them with a per-launch token,
// normalises them and emits batches to the GUI thread.
class IngestWorker : public QObject
{
    Q_OBJECT
public:
    IngestWorker();
    ~IngestWorker() override;

public slots:
    void start();
    void stop();
    void injectLocal(const QByteArray &line);   // in-process test events (setup wizard)

signals:
    void eventsReady(const nexus::core::EventList &events);
    void statsChanged(const nexus::ingest::IngestStats &stats);

private:
    void onNewConnection();
    void onReadyRead(QLocalSocket *s);
    void handleLine(const QByteArray &line, bool trusted);
    void recoverSpool();
    void flush();

    QLocalServer *m_server = nullptr;
    QByteArray m_token;
    IngestStats m_stats;
    core::EventList m_pending;
    QTimer *m_flushTimer = nullptr;
};

// GUI-thread facade owning the worker thread.
class IngestServer : public QObject
{
    Q_OBJECT
public:
    explicit IngestServer(QObject *parent = nullptr);
    ~IngestServer() override;

    void start();
    void injectLocal(const QByteArray &line);
    const IngestStats &stats() const { return m_stats; }

signals:
    void eventsReady(const nexus::core::EventList &events);
    void statsChanged();

private:
    QThread *m_thread = nullptr;
    IngestWorker *m_worker = nullptr;
    IngestStats m_stats;
};

} // namespace nexus::ingest

Q_DECLARE_METATYPE(nexus::ingest::IngestStats)
