#pragma once

#include <QPointer>
#include <QQuickItem>
#include <QTimer>
#include <QVariantList>
#include <QVariantMap>
#include <QtQml/qqmlregistration.h>

namespace nexus::session { class SessionEngine; }

namespace nexus::ui {

// GPU-drawn execution timeline: one lane per session, tool calls as duration bars,
// permission waits as amber spans, milestones as markers, playhead and live edge.
// Geometry is built in updatePaintNode() as vertex-coloured triangles (one draw call).
class TimelineView : public QQuickItem
{
    Q_OBJECT
    QML_ELEMENT
    Q_PROPERTY(QObject *engine READ engine WRITE setEngine NOTIFY engineChanged)
    Q_PROPERTY(qint64 playhead READ playhead WRITE setPlayhead NOTIFY playheadChanged)
    Q_PROPERTY(bool live READ live WRITE setLive NOTIFY liveChanged)
    Q_PROPERTY(qint64 viewStart READ viewStart NOTIFY viewChanged)
    Q_PROPERTY(qint64 viewEnd READ viewEnd NOTIFY viewChanged)
    Q_PROPERTY(bool follow READ follow WRITE setFollow NOTIFY viewChanged)
    Q_PROPERTY(QVariantList lanes READ lanes NOTIFY layoutChanged)
    Q_PROPERTY(QVariantList ticks READ ticks NOTIFY viewChanged)
    Q_PROPERTY(QVariantMap hoverInfo READ hoverInfo NOTIFY hoverChanged)
    Q_PROPERTY(int selectedEvent READ selectedEvent WRITE setSelectedEvent NOTIFY selectedEventChanged)
    Q_PROPERTY(qreal labelWidth READ labelWidth WRITE setLabelWidth NOTIFY layoutChanged)
    Q_PROPERTY(QString activeSession READ activeSession WRITE setActiveSession NOTIFY layoutChanged)

public:
    explicit TimelineView(QQuickItem *parent = nullptr);

    QObject *engine() const;
    void setEngine(QObject *e);
    qint64 playhead() const { return m_playhead; }
    void setPlayhead(qint64 t);
    bool live() const { return m_live; }
    void setLive(bool l);
    qint64 viewStart() const { return m_start; }
    qint64 viewEnd() const { return m_end; }
    bool follow() const { return m_follow; }
    void setFollow(bool f);
    QVariantList lanes() const { return m_lanes; }
    QVariantList ticks() const { return m_ticks; }
    QVariantMap hoverInfo() const { return m_hover; }
    int selectedEvent() const { return m_selectedEvent; }
    void setSelectedEvent(int e);
    qreal labelWidth() const { return m_labelWidth; }
    void setLabelWidth(qreal w);
    QString activeSession() const { return m_activeSession; }
    void setActiveSession(const QString &s);

    Q_INVOKABLE void zoomToFit();
    Q_INVOKABLE void zoomBy(qreal factor);
    Q_INVOKABLE qreal xForTime(qint64 t) const;
    Q_INVOKABLE qint64 timeForX(qreal x) const;

signals:
    void engineChanged();
    void playheadChanged();
    void liveChanged();
    void viewChanged();
    void layoutChanged();
    void hoverChanged();
    void selectedEventChanged();
    void eventClicked(int eventIndex, const QString &sessionId);
    void seekRequested(qint64 ts);
    void laneClicked(const QString &sessionId);

protected:
    QSGNode *updatePaintNode(QSGNode *old, UpdatePaintNodeData *) override;
    void geometryChange(const QRectF &n, const QRectF &o) override;
    void mousePressEvent(QMouseEvent *e) override;
    void mouseMoveEvent(QMouseEvent *e) override;
    void mouseReleaseEvent(QMouseEvent *e) override;
    void mouseDoubleClickEvent(QMouseEvent *e) override;
    void wheelEvent(QWheelEvent *e) override;
    void hoverMoveEvent(QHoverEvent *e) override;
    void hoverLeaveEvent(QHoverEvent *e) override;

private:
    struct Hit {
        QRectF rect;
        int eventIndex;
        QString session;
        QVariantMap info;
    };
    void relayout();
    void computeTicks();
    void tick();
    const Hit *hitAt(const QPointF &p) const;

    QPointer<session::SessionEngine> m_engine;
    qint64 m_start = 0;
    qint64 m_end = 0;
    qint64 m_playhead = 0;
    bool m_live = true;
    bool m_follow = true;
    bool m_autoFit = true;   // span follows the data until the user zooms or pans
    QVariantList m_lanes;
    QVariantList m_ticks;
    QVariantMap m_hover;
    int m_selectedEvent = -1;
    qreal m_labelWidth = 150;
    QString m_activeSession;
    QStringList m_laneOrder;
    qreal m_laneH = 26;
    qreal m_top = 20;
    std::vector<Hit> m_hits;
    QTimer m_timer;
    bool m_dragging = false;
    QPointF m_pressPos;
    qint64 m_pressStart = 0, m_pressEnd = 0;
};

} // namespace nexus::ui
