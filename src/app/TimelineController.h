#pragma once

#include <QElapsedTimer>
#include <QObject>
#include <QTimer>

namespace nexus::session { class SessionEngine; class EventListModel; }

namespace nexus::app {

class VisualDirector;

// Historical playback. In live mode the playhead tracks "now". Seeking moves into
// history: the event stream filters to events up to the playhead, and playing replays
// recorded events through the visual director at the chosen speed.
class TimelineController : public QObject
{
    Q_OBJECT
    Q_PROPERTY(bool live READ live NOTIFY changed)
    Q_PROPERTY(bool playing READ playing NOTIFY changed)
    Q_PROPERTY(qint64 playhead READ playhead NOTIFY playheadChanged)
    Q_PROPERTY(double speed READ speed WRITE setSpeed NOTIFY changed)
    Q_PROPERTY(int selectedEvent READ selectedEvent WRITE setSelectedEvent NOTIFY selectedEventChanged)

public:
    TimelineController(session::SessionEngine *engine, VisualDirector *director, QObject *parent = nullptr);

    bool live() const { return m_live; }
    bool playing() const { return m_playing; }
    qint64 playhead() const;
    double speed() const { return m_speed; }
    void setSpeed(double s);
    int selectedEvent() const { return m_selected; }
    void setSelectedEvent(int e);

    Q_INVOKABLE void seek(qint64 ts);
    Q_INVOKABLE void play();
    Q_INVOKABLE void pause();
    Q_INVOKABLE void goLive();
    Q_INVOKABLE void stepEvent(int direction);
    Q_INVOKABLE qint64 now() const;

signals:
    void changed();
    void playheadChanged();
    void selectedEventChanged();

private:
    void advance();
    int firstEventAfter(qint64 ts) const;

    session::SessionEngine *m_engine;
    VisualDirector *m_director;
    bool m_live = true;
    bool m_playing = false;
    qint64 m_head = 0;
    double m_speed = 4.0;
    int m_selected = -1;
    QTimer m_timer;
    QElapsedTimer m_clock;
    int m_cursor = 0;
};

} // namespace nexus::app
