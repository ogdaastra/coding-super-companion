#pragma once

#include "SessionTypes.h"
#include "core/NexusEvent.h"

#include <QAbstractListModel>
#include <QObject>
#include <QTimer>
#include <QVariantList>
#include <QVariantMap>
#include <deque>
#include <map>
#include <memory>

namespace nexus::session {

class SessionEngine;

class SessionListModel : public QAbstractListModel
{
    Q_OBJECT
public:
    enum Roles { IdRole = Qt::UserRole + 1, TitleRole, StateRole, StateLabelRole, DetailRole, ColorRole, CwdRole,
                 FirstTsRole, LastTsRole, ToolCountRole, ErrorCountRole, SimulatedRole, AliveRole, ProjectRole,
                 FilesRole, LaunchedRole, PidRole };
    explicit SessionListModel(SessionEngine *engine);
    int rowCount(const QModelIndex &parent = {}) const override;
    QVariant data(const QModelIndex &index, int role) const override;
    QHash<int, QByteArray> roleNames() const override;
    void reset();
    void sessionChanged(const QString &id);

private:
    SessionEngine *m_engine;
    QStringList m_order;  // most recently active first
};

class EventListModel : public QAbstractListModel
{
    Q_OBJECT
    Q_PROPERTY(QString sessionFilter READ sessionFilter WRITE setSessionFilter NOTIFY filterChanged)
    Q_PROPERTY(QString categoryFilter READ categoryFilter WRITE setCategoryFilter NOTIFY filterChanged)
    Q_PROPERTY(QString textFilter READ textFilter WRITE setTextFilter NOTIFY filterChanged)
    Q_PROPERTY(qint64 untilTs READ untilTs WRITE setUntilTs NOTIFY filterChanged)
    Q_PROPERTY(int count READ count NOTIFY countChanged)
public:
    enum Roles { IndexRole = Qt::UserRole + 1, TsRole, KindRole, CategoryRole, ToolRole, SummaryRole, SessionRole,
                 DurationRole, OkRole, SourceRole, SimulatedRole, ProvenanceRole, FilesRole, ColorRole, AgentRole, TestRole };
    explicit EventListModel(SessionEngine *engine);
    int rowCount(const QModelIndex &parent = {}) const override;
    QVariant data(const QModelIndex &index, int role) const override;
    QHash<int, QByteArray> roleNames() const override;
    int count() const { return int(m_rows.size()); }

    QString sessionFilter() const { return m_session; }
    void setSessionFilter(const QString &s);
    QString categoryFilter() const { return m_category; }
    void setCategoryFilter(const QString &c);
    QString textFilter() const { return m_text; }
    void setTextFilter(const QString &t);
    qint64 untilTs() const { return m_until; }
    void setUntilTs(qint64 t);

    void appended(int firstIndex, int lastIndex);
    void rebuild();
    void updatedAt(int eventIndex);

signals:
    void filterChanged();
    void countChanged();

private:
    bool accepts(int eventIndex) const;
    SessionEngine *m_engine;
    std::vector<int> m_rows;   // event indices, newest first
    QString m_session, m_category, m_text;
    qint64 m_until = 0;        // 0 = live
};

// Reconstructs observable agent state from the normalised event stream. Lives on the
// GUI thread; work per event is O(1) amortised.
class SessionEngine : public QObject
{
    Q_OBJECT
    Q_PROPERTY(QObject *sessions READ sessionsModel CONSTANT)
    Q_PROPERTY(QObject *events READ eventsModel CONSTANT)
    Q_PROPERTY(QString activeSession READ activeSession WRITE setActiveSession NOTIFY activeSessionChanged)
    Q_PROPERTY(int sessionCount READ sessionCount NOTIFY sessionsChanged)
    Q_PROPERTY(int liveSessionCount READ liveSessionCount NOTIFY revisionChanged)
    Q_PROPERTY(int eventCount READ eventCount NOTIFY eventsChanged)
    Q_PROPERTY(qreal activity READ activity NOTIFY activityChanged)
    Q_PROPERTY(qreal eventRate READ eventRate NOTIFY activityChanged)
    Q_PROPERTY(bool hasSimulated READ hasSimulated NOTIFY sessionsChanged)
    Q_PROPERTY(QVariantList conflicts READ conflicts NOTIFY conflictsChanged)
    Q_PROPERTY(qint64 lastEventTs READ lastEventTs NOTIFY eventsChanged)
    Q_PROPERTY(qint64 firstEventTs READ firstEventTs NOTIFY eventsChanged)
    // bumps whenever any session's observable state changes (including timer-driven inference)
    Q_PROPERTY(int revision READ revision NOTIFY revisionChanged)

public:
    explicit SessionEngine(QObject *parent = nullptr);

    // `live` false for history replayed from the store (no visual effects, no toasts).
    void ingest(const core::EventList &events, bool live);
    void ingestOne(const core::NexusEvent &e, bool live);
    void markLaunchedByNexus(const QString &sessionId);
    void clearSimulated();

    QObject *sessionsModel() { return &m_sessionModel; }
    QObject *eventsModel() { return &m_eventModel; }
    QString activeSession() const { return m_active; }
    void setActiveSession(const QString &id);
    int sessionCount() const { return int(m_sessions.size()); }
    int liveSessionCount() const;
    int eventCount() const { return int(m_events.size()); }
    qreal activity() const { return m_activity; }
    qreal eventRate() const { return m_rate; }
    bool hasSimulated() const;
    QVariantList conflicts() const { return m_conflicts; }
    qint64 lastEventTs() const { return m_events.empty() ? 0 : m_events.back().ts; }
    qint64 firstEventTs() const { return m_events.empty() ? 0 : m_events.front().ts; }
    int revision() const { return m_revision; }

    const std::deque<core::NexusEvent> &events() const { return m_events; }
    const core::NexusEvent &event(int i) const { return m_events[size_t(i - m_eventBase)]; }
    int eventBase() const { return m_eventBase; }
    int eventEnd() const { return m_eventBase + int(m_events.size()); }
    const SessionRecord *session(const QString &id) const;
    QStringList sessionIds() const;
    const std::map<QString, std::unique_ptr<SessionRecord>> &allSessions() const { return m_sessions; }

    Q_INVOKABLE QVariantMap sessionInfo(const QString &id) const;
    // active session if set, else the most recently active live session, else ""
    Q_INVOKABLE QString primarySession() const;
    Q_INVOKABLE QStringList instructionFiles() const;   // across all sessions
    Q_INVOKABLE QVariantMap eventInfo(int eventIndex) const;
    Q_INVOKABLE QVariantList sessionFiles(const QString &id, int limit = 60) const;
    Q_INVOKABLE QVariantList touchedFiles(int limit = 200) const;   // all sessions, most recent first
    Q_INVOKABLE QString colorForSession(const QString &id) const;
    Q_INVOKABLE QVariantMap fileActivity(const QString &absPath) const;
    Q_INVOKABLE QVariantMap heatByFile() const;                     // abs path → 0..1

    static QString colorHex(int index);

signals:
    void eventIngested(const nexus::core::NexusEvent &e, int eventIndex, bool live);
    void sessionsChanged();
    void sessionUpdated(const QString &id);
    void eventsChanged();
    void activityChanged();
    void activeSessionChanged();
    void conflictsChanged();
    void agentsChanged();                 // set of visualised agents changed
    void notify(const QString &level, const QString &title, const QString &body);
    void revisionChanged();

private:
    SessionRecord &sessionFor(const core::NexusEvent &e);
    void apply(SessionRecord &s, const core::NexusEvent &e, int eventIndex, bool live);
    void setState(SessionRecord &s, AgentState st, core::NexusEvent::Provenance p, const QString &detail, qint64 ts);
    void tick();
    void recomputeConflicts();

    std::map<QString, std::unique_ptr<SessionRecord>> m_sessions;
    std::deque<core::NexusEvent> m_events;
    int m_eventBase = 0;            // index of m_events.front() (events are trimmed from the front)
    SessionListModel m_sessionModel;
    EventListModel m_eventModel;
    QString m_active;
    qreal m_activity = 0.15;
    qreal m_rate = 0.0;
    std::deque<qint64> m_recentLive;   // timestamps of recent live tool events (for rate)
    QVariantList m_conflicts;
    QTimer m_tick;
    int m_nextColor = 0;
    int m_nextRing = 0;
    bool m_conflictsDirty = false;
    int m_revision = 0;
    void bump() { ++m_revision; emit revisionChanged(); }
};

} // namespace nexus::session
