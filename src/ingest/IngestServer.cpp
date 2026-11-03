#include "IngestServer.h"
#include "Normalizer.h"

#include "core/Paths.h"

#include <QCoreApplication>
#include <QDateTime>
#include <QDir>
#include <QFile>
#include <QJsonDocument>
#include <QJsonObject>
#include <QLocalServer>
#include <QLocalSocket>
#include <QRandomGenerator>
#include <QThread>

namespace nexus::ingest {

namespace {

constexpr qint64 kMaxLine = 8 * 1024 * 1024;

bool constantTimeEquals(const QByteArray &a, const QByteArray &b)
{
    if (a.size() != b.size())
        return false;
    unsigned char diff = 0;
    for (qsizetype i = 0; i < a.size(); ++i)
        diff |= static_cast<unsigned char>(a[i] ^ b[i]);
    return diff == 0;
}

QByteArray randomToken()
{
    QByteArray raw(32, Qt::Uninitialized);
    QRandomGenerator::system()->fillRange(reinterpret_cast<quint32 *>(raw.data()), raw.size() / 4);
    return raw.toHex();
}

} // namespace

IngestWorker::IngestWorker() = default;

IngestWorker::~IngestWorker() = default;

void IngestWorker::start()
{
    using namespace core;
    m_flushTimer = new QTimer(this);
    m_flushTimer->setInterval(40);
    connect(m_flushTimer, &QTimer::timeout, this, &IngestWorker::flush);
    m_flushTimer->start();

    Paths::ensurePrivateDir(Paths::dataDir());
    Paths::ensurePrivateDir(Paths::spoolDir());
    m_token = randomToken();
    const QString socketPath = Paths::socketName();
#ifndef Q_OS_WIN
    Paths::ensurePrivateDir(QFileInfo(socketPath).absolutePath());
#endif
    m_server = new QLocalServer(this);
    m_server->setSocketOptions(QLocalServer::UserAccessOption);
    m_server->setMaxPendingConnections(256);
    QLocalServer::removeServer(socketPath);   // stale socket from a previous crash
    m_stats.socketPath = socketPath;
    if (!m_server->listen(socketPath)) {
        m_stats.listening = false;
        m_stats.error = m_server->errorString();
        qWarning("NEXUS: telemetry socket listen failed: %s", qPrintable(m_stats.error));
    } else {
        m_stats.listening = true;
        connect(m_server, &QLocalServer::newConnection, this, &IngestWorker::onNewConnection);
    }
    QJsonObject cfg{ { QStringLiteral("version"), 1 },
                     { QStringLiteral("socket"), socketPath },
                     { QStringLiteral("token"), QString::fromLatin1(m_token) },
                     { QStringLiteral("pid"), qint64(QCoreApplication::applicationPid()) },
                     { QStringLiteral("started_ms"), QDateTime::currentMSecsSinceEpoch() } };
    if (!Paths::writePrivateFile(Paths::relayConfigFile(), QJsonDocument(cfg).toJson(QJsonDocument::Compact)))
        qWarning("NEXUS: could not write relay configuration");

    recoverSpool();
    emit statsChanged(m_stats);
}

void IngestWorker::stop()
{
    flush();
    // objects owned by this thread are destroyed here, on this thread
    delete m_flushTimer;
    m_flushTimer = nullptr;
    if (m_server) {
        m_server->close();
        delete m_server;
        m_server = nullptr;
    }
    // invalidate the token on disk so stale relays spool instead of connecting
    QFile::remove(core::Paths::relayConfigFile());
}

void IngestWorker::onNewConnection()
{
    while (QLocalSocket *s = m_server->nextPendingConnection()) {
        s->setReadBufferSize(kMaxLine + 1);
        connect(s, &QLocalSocket::readyRead, this, [this, s]() { onReadyRead(s); });
        connect(s, &QLocalSocket::disconnected, s, [this, s]() {
            onReadyRead(s);  // drain
            s->deleteLater();
        });
        // a client that never finishes is closed after a while
        QTimer::singleShot(10000, s, [s]() { s->abort(); });
    }
}

void IngestWorker::onReadyRead(QLocalSocket *s)
{
    while (s->canReadLine()) {
        const QByteArray line = s->readLine(kMaxLine);
        handleLine(line.trimmed(), false);
    }
    if (s->bytesAvailable() > kMaxLine) {
        ++m_stats.malformed;
        s->abort();
    }
}

void IngestWorker::injectLocal(const QByteArray &line)
{
    handleLine(line, true);
}

void IngestWorker::handleLine(const QByteArray &line, bool trusted)
{
    if (line.isEmpty())
        return;
    QJsonParseError err;
    const QJsonDocument doc = QJsonDocument::fromJson(line, &err);
    if (err.error != QJsonParseError::NoError || !doc.isObject()) {
        ++m_stats.malformed;
        return;
    }
    const QJsonObject env = doc.object();
    if (!trusted) {
        const QByteArray tok = env.value(QStringLiteral("token")).toString().toLatin1();
        if (!constantTimeEquals(tok, m_token)) {
            ++m_stats.rejected;
            emit statsChanged(m_stats);
            return;
        }
    }
    const QString channel = env.value(QStringLiteral("channel")).toString(QStringLiteral("hook"));
    const qint64 captured = env.value(QStringLiteral("captured_ms")).toInteger();
    const int parentPid = env.value(QStringLiteral("parent_pid")).toInt();
    const QJsonObject payload = env.value(QStringLiteral("payload")).toObject();
    core::NexusEvent e;
    if (channel == QLatin1String("statusline"))
        e = Normalizer::fromStatusLine(payload, captured);
    else
        e = Normalizer::fromHook(payload, captured, parentPid);
    if (env.value(QStringLiteral("simulated")).toBool()) {
        e.simulated = true;
        e.source = core::NexusEvent::Source::Simulation;
    }
    ++m_stats.received;
    if (m_pending.size() > 20000) {
        // pathological flood: keep the newest; counted so the UI can surface it
        m_pending.removeFirst();
        ++m_stats.dropped;
    }
    m_pending.append(e);
}

void IngestWorker::recoverSpool()
{
    QDir spool(core::Paths::spoolDir());
    // remove spool files fully ingested by a previous run
    for (const QString &f : spool.entryList({ QStringLiteral("*.ingested") }, QDir::Files))
        spool.remove(f);
    const QStringList files = spool.entryList({ QStringLiteral("*.jsonl") }, QDir::Files, QDir::Name);
    for (const QString &name : files) {
        QFile f(spool.filePath(name));
        if (!f.open(QIODevice::ReadOnly))
            continue;
        qint64 n = 0;
        while (!f.atEnd()) {
            const QByteArray line = f.readLine(kMaxLine).trimmed();
            if (line.isEmpty()) continue;
            handleLine(line, true);   // the spool lives in a 0700 directory owned by the user
            ++n;
        }
        f.close();
        m_stats.recovered += n;
        spool.rename(name, name + QStringLiteral(".ingested"));
    }
    flush();
}

void IngestWorker::flush()
{
    if (m_pending.isEmpty())
        return;
    core::EventList batch;
    batch.swap(m_pending);
    emit eventsReady(batch);
    emit statsChanged(m_stats);
}

IngestServer::IngestServer(QObject *parent)
    : QObject(parent)
{
    qRegisterMetaType<core::EventList>("nexus::core::EventList");
    qRegisterMetaType<IngestStats>("nexus::ingest::IngestStats");
}

IngestServer::~IngestServer()
{
    if (m_thread) {
        QMetaObject::invokeMethod(m_worker, &IngestWorker::stop, Qt::BlockingQueuedConnection);
        m_thread->quit();
        m_thread->wait(3000);
        delete m_worker;
    }
}

void IngestServer::start()
{
    if (m_thread)
        return;
    m_thread = new QThread(this);
    m_thread->setObjectName(QStringLiteral("nexus-ingest"));
    m_worker = new IngestWorker();
    m_worker->moveToThread(m_thread);
    connect(m_thread, &QThread::started, m_worker, &IngestWorker::start);
    connect(m_worker, &IngestWorker::eventsReady, this, &IngestServer::eventsReady, Qt::QueuedConnection);
    connect(m_worker, &IngestWorker::statsChanged, this, [this](const IngestStats &s) {
        m_stats = s;
        emit statsChanged();
    }, Qt::QueuedConnection);
    m_thread->start();
}

void IngestServer::injectLocal(const QByteArray &line)
{
    if (m_worker)
        QMetaObject::invokeMethod(m_worker, [w = m_worker, line]() { w->injectLocal(line); }, Qt::QueuedConnection);
}

} // namespace nexus::ingest
