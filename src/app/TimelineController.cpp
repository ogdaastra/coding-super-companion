#include "TimelineController.h"
#include "VisualDirector.h"

#include "session/SessionEngine.h"

#include <QDateTime>
#include <algorithm>

namespace nexus::app {

TimelineController::TimelineController(session::SessionEngine *engine, VisualDirector *director, QObject *parent)
    : QObject(parent), m_engine(engine), m_director(director)
{
    m_timer.setInterval(33);
    connect(&m_timer, &QTimer::timeout, this, &TimelineController::advance);
}

qint64 TimelineController::now() const { return QDateTime::currentMSecsSinceEpoch(); }

qint64 TimelineController::playhead() const { return m_live ? now() : m_head; }

void TimelineController::setSpeed(double s)
{
    s = std::clamp(s, 0.25, 64.0);
    if (qFuzzyCompare(s, m_speed)) return;
    m_speed = s;
    emit changed();
}

void TimelineController::setSelectedEvent(int e)
{
    if (e == m_selected) return;
    m_selected = e;
    emit selectedEventChanged();
}

int TimelineController::firstEventAfter(qint64 ts) const
{
    const auto &ev = m_engine->events();
    // events are appended in arrival order, which is (nearly) time order
    auto it = std::upper_bound(ev.begin(), ev.end(), ts, [](qint64 t, const core::NexusEvent &e) { return t < e.ts; });
    return m_engine->eventBase() + int(it - ev.begin());
}

void TimelineController::seek(qint64 ts)
{
    const qint64 n = now();
    if (ts >= n - 250) { goLive(); return; }
    m_live = false;
    m_head = std::max(ts, m_engine->firstEventTs());
    m_cursor = firstEventAfter(m_head);
    auto *model = qobject_cast<session::EventListModel *>(m_engine->eventsModel());
    if (model) model->setUntilTs(m_head);
    emit changed();
    emit playheadChanged();
}

void TimelineController::play()
{
    if (m_live) {
        // start a replay from the beginning of the recorded history
        if (m_engine->eventCount() == 0) return;
        seek(m_engine->firstEventTs());
    }
    m_playing = true;
    m_clock.restart();
    m_timer.start();
    emit changed();
}

void TimelineController::pause()
{
    m_playing = false;
    m_timer.stop();
    emit changed();
}

void TimelineController::goLive()
{
    m_live = true;
    m_playing = false;
    m_timer.stop();
    auto *model = qobject_cast<session::EventListModel *>(m_engine->eventsModel());
    if (model) model->setUntilTs(0);
    emit changed();
    emit playheadChanged();
}

void TimelineController::stepEvent(int direction)
{
    if (m_engine->eventCount() == 0) return;
    if (m_live) seek(m_engine->lastEventTs());
    int target = direction > 0 ? firstEventAfter(m_head) : firstEventAfter(m_head - 1) - 1;
    target = std::clamp(target, m_engine->eventBase(), m_engine->eventEnd() - 1);
    const core::NexusEvent &e = m_engine->event(target);
    m_director->play(e);
    m_head = e.ts;
    m_cursor = target + 1;
    setSelectedEvent(target);
    auto *model = qobject_cast<session::EventListModel *>(m_engine->eventsModel());
    if (model) model->setUntilTs(m_head);
    emit playheadChanged();
}

void TimelineController::advance()
{
    const qint64 dt = m_clock.restart();
    // compress idle gaps: if nothing happens in the next 3 s of history, jump ahead
    qint64 next = m_head + qint64(double(dt) * m_speed);
    if (m_cursor < m_engine->eventEnd()) {
        const qint64 nextTs = m_engine->event(m_cursor).ts;
        if (nextTs - m_head > 3000) next = std::max(next, nextTs - 400);
    }
    bool crossed = false;
    while (m_cursor < m_engine->eventEnd() && m_engine->event(m_cursor).ts <= next) {
        m_director->play(m_engine->event(m_cursor));
        ++m_cursor;
        crossed = true;
    }
    m_head = next;
    if (crossed) {
        // only refilter the stream when the playhead actually passed an event
        auto *model = qobject_cast<session::EventListModel *>(m_engine->eventsModel());
        if (model) model->setUntilTs(m_head);
        setSelectedEvent(m_cursor - 1);
    }
    if (m_cursor >= m_engine->eventEnd() || m_head >= now()) {
        goLive();
        return;
    }
    emit playheadChanged();
}

} // namespace nexus::app
