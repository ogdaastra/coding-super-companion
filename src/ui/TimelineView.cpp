#include "TimelineView.h"

#include "session/SessionEngine.h"

#include <QColor>
#include <QDateTime>
#include <QSGFlatColorMaterial>
#include <QSGGeometryNode>
#include <QSGVertexColorMaterial>
#include <algorithm>
#include <cmath>

namespace nexus::ui {

using session::SessionEngine;
using session::SessionRecord;

namespace {

struct Prim {
    float x0, y0, x1, y1;
    QColor c;
    bool diamond = false;
};


QColor categoryColor(const QString &cat)
{
    if (cat == QLatin1String("read")) return QColor(155, 231, 255);
    if (cat == QLatin1String("write")) return QColor(63, 212, 255);
    if (cat == QLatin1String("search")) return QColor(110, 124, 255);
    if (cat == QLatin1String("exec")) return QColor(154, 134, 255);
    if (cat == QLatin1String("web")) return QColor(111, 183, 255);
    if (cat == QLatin1String("agent")) return QColor(207, 140, 255);
    if (cat == QLatin1String("mcp")) return QColor(94, 225, 230);
    if (cat == QLatin1String("task")) return QColor(140, 160, 190);
    return QColor(98, 115, 139);
}

QColor milestoneColor(const QString &kind)
{
    if (kind == QLatin1String("prompt")) return QColor(221, 246, 255);
    if (kind == QLatin1String("turn")) return QColor(63, 212, 255);
    if (kind == QLatin1String("failure")) return QColor(255, 77, 94);
    if (kind == QLatin1String("compact")) return QColor(110, 124, 255);
    if (kind == QLatin1String("start") || kind == QLatin1String("end")) return QColor(157, 176, 200);
    if (kind == QLatin1String("declared")) return QColor(255, 205, 120);
    return QColor(154, 134, 255);
}

QColor withAlpha(QColor c, qreal a)
{
    c.setAlphaF(std::clamp(a, 0.0, 1.0));
    return c;
}

} // namespace

class TimelineNode : public QSGGeometryNode
{
public:
    TimelineNode()
        : m_geom(QSGGeometry::defaultAttributes_ColoredPoint2D(), 0)
    {
        m_geom.setDrawingMode(QSGGeometry::DrawTriangles);
        setGeometry(&m_geom);
        setMaterial(&m_mat);
    }
    void setPrims(const std::vector<Prim> &prims)
    {
        int verts = 0;
        for (const Prim &p : prims) verts += 6;
        m_geom.allocate(verts);
        auto *v = m_geom.vertexDataAsColoredPoint2D();
        for (const Prim &p : prims) {
            const QColor c = p.c;
            const float a = float(c.alphaF());
            const uchar r = uchar(c.red() * a), g = uchar(c.green() * a), b = uchar(c.blue() * a), al = uchar(255 * a);
            if (p.diamond) {
                const float cx = (p.x0 + p.x1) * 0.5f, cy = (p.y0 + p.y1) * 0.5f;
                v[0].set(cx, p.y0, r, g, b, al); v[1].set(p.x1, cy, r, g, b, al); v[2].set(cx, p.y1, r, g, b, al);
                v[3].set(cx, p.y0, r, g, b, al); v[4].set(cx, p.y1, r, g, b, al); v[5].set(p.x0, cy, r, g, b, al);
            } else {
                v[0].set(p.x0, p.y0, r, g, b, al); v[1].set(p.x1, p.y0, r, g, b, al); v[2].set(p.x1, p.y1, r, g, b, al);
                v[3].set(p.x0, p.y0, r, g, b, al); v[4].set(p.x1, p.y1, r, g, b, al); v[5].set(p.x0, p.y1, r, g, b, al);
            }
            v += 6;
        }
        markDirty(QSGNode::DirtyGeometry);
    }

private:
    QSGGeometry m_geom;
    QSGVertexColorMaterial m_mat;
};


TimelineView::TimelineView(QQuickItem *parent) : QQuickItem(parent)
{
    setFlag(ItemHasContents, true);
    setAcceptedMouseButtons(Qt::LeftButton | Qt::RightButton);
    setAcceptHoverEvents(true);
    const qint64 now = QDateTime::currentMSecsSinceEpoch();
    m_end = now + 10000;
    m_start = now - 5 * 60 * 1000;
    m_timer.setInterval(100);
    connect(&m_timer, &QTimer::timeout, this, &TimelineView::tick);
    m_timer.start();
}

QObject *TimelineView::engine() const { return m_engine; }

void TimelineView::setEngine(QObject *e)
{
    auto *eng = qobject_cast<SessionEngine *>(e);
    if (eng == m_engine) return;
    m_engine = eng;
    if (m_engine) zoomToFit();
    emit engineChanged();
    relayout();
}

void TimelineView::setPlayhead(qint64 t) { if (t != m_playhead) { m_playhead = t; emit playheadChanged(); relayout(); } }
void TimelineView::setLive(bool l) { if (l != m_live) { m_live = l; if (l) m_follow = true; emit liveChanged(); relayout(); } }
void TimelineView::setFollow(bool f) { if (f != m_follow) { m_follow = f; emit viewChanged(); relayout(); } }
void TimelineView::setSelectedEvent(int e) { if (e != m_selectedEvent) { m_selectedEvent = e; emit selectedEventChanged(); relayout(); } }
void TimelineView::setLabelWidth(qreal w) { if (!qFuzzyCompare(w, m_labelWidth)) { m_labelWidth = w; relayout(); } }
void TimelineView::setActiveSession(const QString &s) { if (s != m_activeSession) { m_activeSession = s; relayout(); } }

qreal TimelineView::xForTime(qint64 t) const
{
    const qreal w = std::max<qreal>(1.0, width() - m_labelWidth);
    return m_labelWidth + qreal(t - m_start) / qreal(std::max<qint64>(1, m_end - m_start)) * w;
}

qint64 TimelineView::timeForX(qreal x) const
{
    const qreal w = std::max<qreal>(1.0, width() - m_labelWidth);
    return m_start + qint64((x - m_labelWidth) / w * qreal(m_end - m_start));
}

void TimelineView::zoomToFit()
{
    const qint64 now = QDateTime::currentMSecsSinceEpoch();
    qint64 first = now - 5 * 60 * 1000;
    if (m_engine && m_engine->eventCount() > 0)
        first = std::min(first, m_engine->firstEventTs());
    const qint64 span = std::max<qint64>(now - first, 20000);
    m_start = now - qint64(span * 1.02);
    m_end = now + qint64(span * 0.04);
    m_follow = true;
    m_autoFit = true;
    computeTicks();
    emit viewChanged();
    relayout();
}

void TimelineView::zoomBy(qreal factor)
{
    const qint64 centre = m_follow ? m_end : (m_start + m_end) / 2;
    const qint64 span = std::clamp<qint64>(qint64(qreal(m_end - m_start) * factor), 1500, qint64(30) * 24 * 3600 * 1000);
    if (m_follow) {
        m_start = centre - span;
    } else {
        m_start = centre - span / 2;
        m_end = centre + span / 2;
    }
    computeTicks();
    emit viewChanged();
    relayout();
}

void TimelineView::geometryChange(const QRectF &n, const QRectF &o)
{
    QQuickItem::geometryChange(n, o);
    computeTicks();
    relayout();
}

void TimelineView::tick()
{
    if (!isVisible()) return;
    if (m_follow) {
        const qint64 now = QDateTime::currentMSecsSinceEpoch();
        qint64 span = m_end - m_start;
        if (m_autoFit && m_engine && m_engine->eventCount() > 0)
            span = std::clamp<qint64>(qint64(qreal(now - m_engine->firstEventTs()) * 1.12), 30000, 3600000);
        m_end = now + span / 25;
        m_start = m_end - span;
        computeTicks();
        emit viewChanged();
    }
    relayout();
}

void TimelineView::computeTicks()
{
    static const qint64 steps[] = { 100, 250, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000,
                                    900000, 1800000, 3600000, 7200000, 10800000, 21600000, 43200000, 86400000 };
    const qreal w = std::max<qreal>(1.0, width() - m_labelWidth);
    const qint64 span = std::max<qint64>(1, m_end - m_start);
    qint64 step = steps[0];
    for (qint64 s : steps) {
        step = s;
        if (qreal(s) / qreal(span) * w >= 92.0) break;
    }
    m_ticks.clear();
    const qint64 offset = QDateTime::currentDateTime().offsetFromUtc() * 1000;
    qint64 t = ((m_start + offset) / step + 1) * step - offset;
    for (; t < m_end && m_ticks.size() < 60; t += step) {
        const QDateTime dt = QDateTime::fromMSecsSinceEpoch(t);
        QString label = step >= 86400000 ? dt.toString(QStringLiteral("d MMM"))
                      : step >= 60000 ? dt.toString(QStringLiteral("HH:mm"))
                      : step >= 1000 ? dt.toString(QStringLiteral("HH:mm:ss"))
                                     : dt.toString(QStringLiteral("ss.zzz"));
        m_ticks.append(QVariantMap{ { QStringLiteral("x"), xForTime(t) }, { QStringLiteral("label"), label } });
    }
}

void TimelineView::relayout()
{
    update();
}

QSGNode *TimelineView::updatePaintNode(QSGNode *old, UpdatePaintNodeData *)
{
    auto *node = static_cast<TimelineNode *>(old);
    if (!node) node = new TimelineNode();
    std::vector<Prim> prims;
    m_hits.clear();
    const qreal W = width(), H = height();
    const qreal L = m_labelWidth;
    const qint64 now = QDateTime::currentMSecsSinceEpoch();
    QVariantList lanes;

    // grid lines for ticks
    for (const QVariant &v : m_ticks) {
        const float x = float(v.toMap().value(QStringLiteral("x")).toDouble());
        prims.push_back({ x, float(m_top - 4), x + 1.f, float(H), QColor(140, 190, 255, 14) });
    }

    if (m_engine) {
        // lanes: sessions ordered by first activity
        std::vector<const SessionRecord *> order;
        for (const auto &[id, s] : m_engine->allSessions())
            if (id != QLatin1String("unattributed")) order.push_back(s.get());
        std::sort(order.begin(), order.end(), [](const SessionRecord *a, const SessionRecord *b) { return a->firstTs < b->firstTs; });
        const int n = int(order.size());
        const qreal avail = std::max<qreal>(10.0, H - m_top - 4);
        m_laneH = n > 0 ? std::clamp(avail / n, 15.0, 34.0) : 30.0;
        const int maxLanes = int(avail / m_laneH);
        const int first = std::max(0, n - maxLanes);   // newest sessions stay visible
        auto X = [&](qint64 t) { return float(xForTime(t)); };
        const float xMin = float(L), xMax = float(W);
        for (int li = first; li < n; ++li) {
            const SessionRecord *s = order[size_t(li)];
            const float y0 = float(m_top + (li - first) * m_laneH);
            const float lh = float(m_laneH);
            const float cy = y0 + lh * 0.5f;
            const QColor sc(SessionEngine::colorHex(s->colorIndex));
            const bool active = s->id == m_activeSession;
            prims.push_back({ xMin, y0 + 1, xMax, y0 + lh - 1, active ? QColor(63, 212, 255, 16) : ((li & 1) ? QColor(140, 190, 255, 6) : QColor(0, 0, 0, 0)) });
            // lifespan
            const qint64 endTs = (s->state == session::AgentState::Ended || s->state == session::AgentState::Stale) ? s->lastTs : now;
            const float lx0 = std::max(xMin, X(s->firstTs)), lx1 = std::min(xMax, X(endTs));
            if (lx1 > lx0) prims.push_back({ lx0, cy - 0.5f, lx1, cy + 0.5f, withAlpha(sc, 0.30) });
            // permission waits
            auto drawWait = [&](qint64 a, qint64 b) {
                const float x0 = std::max(xMin, X(a)), x1 = std::min(xMax, X(b));
                if (x1 <= x0) return;
                prims.push_back({ x0, cy - lh * 0.28f, std::max(x1, x0 + 2.f), cy + lh * 0.28f, QColor(255, 181, 71, 70) });
                prims.push_back({ x0, cy - lh * 0.28f, std::max(x1, x0 + 2.f), cy - lh * 0.28f + 1.f, QColor(255, 181, 71, 200) });
            };
            for (const auto &w : s->waits) drawWait(w.first, w.second);
            if (s->waitStart > 0) drawWait(s->waitStart, now);
            // tool calls
            const float barH = lh * 0.50f;
            for (const session::ToolCall &tc : s->toolCalls) {
                const qint64 te = tc.end > 0 ? tc.end : now;
                if (te < m_start || tc.start > m_end) continue;
                float x0 = std::max(xMin, X(tc.start)), x1 = std::min(xMax, X(te));
                if (x1 - x0 < 2.f) x1 = x0 + 2.f;
                const bool sub = !tc.agentId.isEmpty();
                const float top = sub ? cy - barH * 0.15f : cy - barH * 0.5f;
                const float bot = sub ? cy + barH * 0.5f : cy + barH * 0.5f;
                QColor c = tc.ok == 0 ? QColor(255, 77, 94) : (tc.testRun ? QColor(79, 227, 193) : categoryColor(tc.category));
                const int ev = tc.eventEnd >= 0 ? tc.eventEnd : tc.eventStart;
                const bool selected = ev >= 0 && (ev == m_selectedEvent || tc.eventStart == m_selectedEvent);
                if (selected)
                    prims.push_back({ x0 - 2, top - 2, x1 + 2, bot + 2, QColor(221, 246, 255, 230) });
                const qreal alpha = tc.end > 0 ? (sub ? 0.55 : 0.82) : 0.45 + 0.35 * std::sin(qreal(now % 1000) / 1000.0 * 6.2831853);
                prims.push_back({ x0, top, x1, bot, withAlpha(c, alpha) });
                prims.push_back({ x0, top, x1, top + 1.f, withAlpha(c.lighter(140), std::min(1.0, alpha + 0.15)) });
                if (ev >= 0) {
                    QVariantMap info{ { QStringLiteral("title"), tc.summary.isEmpty() ? tc.toolName : tc.summary },
                                      { QStringLiteral("tool"), tc.toolName }, { QStringLiteral("category"), tc.category },
                                      { QStringLiteral("duration"), tc.durationMs }, { QStringLiteral("observed"), tc.durationObserved },
                                      { QStringLiteral("ok"), tc.ok }, { QStringLiteral("ts"), tc.start },
                                      { QStringLiteral("running"), tc.end == 0 }, { QStringLiteral("color"), c.name() } };
                    m_hits.push_back({ QRectF(x0, top - 3, x1 - x0, bot - top + 6), ev, s->id, info });
                }
            }
            // milestones
            for (const session::Milestone &m : s->milestones) {
                if (m.ts < m_start || m.ts > m_end) continue;
                const float x = X(m.ts);
                const float d = std::min(5.f, lh * 0.22f);
                const QColor mc = milestoneColor(m.kind);
                prims.push_back({ x - d, y0 + 2, x + d, y0 + 2 + 2 * d, mc, true });
                if (m.eventIndex >= 0)
                    m_hits.push_back({ QRectF(x - d - 2, y0, 2 * d + 4, 2 * d + 6), m.eventIndex, s->id,
                                       QVariantMap{ { QStringLiteral("title"), m.label }, { QStringLiteral("tool"), m.kind },
                                                    { QStringLiteral("ts"), m.ts }, { QStringLiteral("color"), mc.name() },
                                                    { QStringLiteral("milestone"), true } } });
            }
            QString title = s->title.isEmpty() ? (s->currentTask.isEmpty() ? QStringLiteral("Session ") + s->id.left(8) : s->currentTask) : s->title;
            lanes.append(QVariantMap{ { QStringLiteral("y"), y0 }, { QStringLiteral("h"), lh }, { QStringLiteral("title"), title },
                                      { QStringLiteral("color"), sc.name() }, { QStringLiteral("sessionId"), s->id },
                                      { QStringLiteral("simulated"), s->simulated }, { QStringLiteral("state"), session::stateName(s->state) },
                                      { QStringLiteral("active"), active } });
        }
    }

    // live edge and playhead
    const float xn = float(xForTime(now));
    if (xn >= L && xn <= W) {
        prims.push_back({ xn - 3, float(m_top - 4), xn + 3, float(H), QColor(63, 212, 255, 20) });
        prims.push_back({ xn - 0.5f, float(m_top - 4), xn + 0.5f, float(H), QColor(63, 212, 255, 200) });
    }
    if (!m_live) {
        const float xp = float(xForTime(m_playhead));
        if (xp >= L && xp <= W) {
            prims.push_back({ xp - 4, float(m_top - 4), xp + 4, float(H), QColor(221, 246, 255, 18) });
            prims.push_back({ xp - 0.75f, float(m_top - 8), xp + 0.75f, float(H), QColor(221, 246, 255, 235) });
            prims.push_back({ xp - 5, float(m_top - 12), xp + 5, float(m_top - 2), QColor(221, 246, 255, 235), true });
        }
    }
    node->setPrims(prims);
    if (lanes != m_lanes) {
        m_lanes = lanes;
        QMetaObject::invokeMethod(this, [this]() { emit layoutChanged(); }, Qt::QueuedConnection);
    }
    return node;
}

const TimelineView::Hit *TimelineView::hitAt(const QPointF &p) const
{
    const Hit *best = nullptr;
    for (const Hit &h : m_hits)
        if (h.rect.contains(p) && (!best || h.rect.width() < best->rect.width())) best = &h;
    return best;
}

void TimelineView::mousePressEvent(QMouseEvent *e)
{
    m_pressPos = e->position();
    m_pressStart = m_start;
    m_pressEnd = m_end;
    m_dragging = false;
    e->accept();
}

void TimelineView::mouseMoveEvent(QMouseEvent *e)
{
    const qreal dx = e->position().x() - m_pressPos.x();
    if (!m_dragging && std::abs(dx) > 4) m_dragging = true;
    if (!m_dragging) return;
    const qreal w = std::max<qreal>(1.0, width() - m_labelWidth);
    const qint64 dt = qint64(dx / w * qreal(m_pressEnd - m_pressStart));
    m_start = m_pressStart - dt;
    m_end = m_pressEnd - dt;
    m_follow = false;
    m_autoFit = false;
    computeTicks();
    emit viewChanged();
    relayout();
}

void TimelineView::mouseReleaseEvent(QMouseEvent *e)
{
    if (!m_dragging) {
        const QPointF p = e->position();
        if (p.x() < m_labelWidth) {
            for (const QVariant &v : m_lanes) {
                const QVariantMap m = v.toMap();
                const qreal y = m.value(QStringLiteral("y")).toDouble(), h = m.value(QStringLiteral("h")).toDouble();
                if (p.y() >= y && p.y() < y + h) emit laneClicked(m.value(QStringLiteral("sessionId")).toString());
            }
        } else if (const Hit *h = hitAt(p)) {
            setSelectedEvent(h->eventIndex);
            emit eventClicked(h->eventIndex, h->session);
        } else {
            emit seekRequested(timeForX(p.x()));
        }
    }
    m_dragging = false;
    e->accept();
}

void TimelineView::mouseDoubleClickEvent(QMouseEvent *e)
{
    zoomToFit();
    emit seekRequested(QDateTime::currentMSecsSinceEpoch());
    e->accept();
}

void TimelineView::wheelEvent(QWheelEvent *e)
{
    const qreal steps = e->angleDelta().y() / 120.0;
    const qreal x = e->position().x();
    const qint64 anchor = timeForX(x);
    const qint64 span = std::clamp<qint64>(qint64(qreal(m_end - m_start) * std::pow(0.82, steps)), 1500, qint64(30) * 24 * 3600 * 1000);
    const qreal frac = (x - m_labelWidth) / std::max<qreal>(1.0, width() - m_labelWidth);
    m_start = anchor - qint64(frac * qreal(span));
    m_end = m_start + span;
    m_autoFit = false;
    if (frac < 0.9) m_follow = false;
    computeTicks();
    emit viewChanged();
    relayout();
    e->accept();
}

void TimelineView::hoverMoveEvent(QHoverEvent *e)
{
    const Hit *h = hitAt(e->position());
    QVariantMap info;
    if (h) {
        info = h->info;
        info.insert(QStringLiteral("x"), e->position().x());
        info.insert(QStringLiteral("y"), h->rect.top());
        info.insert(QStringLiteral("event"), h->eventIndex);
    }
    if (info != m_hover) {
        m_hover = info;
        emit hoverChanged();
    }
}

void TimelineView::hoverLeaveEvent(QHoverEvent *)
{
    if (!m_hover.isEmpty()) { m_hover.clear(); emit hoverChanged(); }
}

} // namespace nexus::ui
