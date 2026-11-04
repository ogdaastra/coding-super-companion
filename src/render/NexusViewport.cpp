#include "NexusViewport.h"
#include "NexusRenderer.h"

#include <QQuickWindow>
#include <QtMath>
#include <algorithm>
#include <cmath>

namespace nexus::render {

namespace {
constexpr float kLabelRecentSeconds = 7.f;
}

NexusViewport::NexusViewport(QQuickItem *parent)
    : QQuickRhiItem(parent), m_labels(40)
{
    setAcceptedMouseButtons(Qt::AllButtons);
    setAcceptHoverEvents(true);
    setFlag(ItemHasContents, true);
    m_clock.start();
}

NexusViewport::~NexusViewport() = default;

QQuickRhiItemRenderer *NexusViewport::createRenderer()
{
    return new NexusRenderer();
}

void NexusViewport::itemChange(ItemChange change, const ItemChangeData &value)
{
    QQuickRhiItem::itemChange(change, value);
    if (change == ItemSceneChange) {
        disconnect(m_frameConn);
        if (value.window)
            m_frameConn = connect(value.window, &QQuickWindow::afterAnimating, this, &NexusViewport::onFrame);
    }
}

void NexusViewport::setQuality(int preset)
{
    preset = std::clamp(preset, 0, 3);
    if (preset == m_quality.preset)
        return;
    m_quality = QualitySettings::fromPreset(preset);
    emit qualityChanged();
    update();
}

void NexusViewport::setActivity(qreal a)
{
    const float v = std::clamp(float(a), 0.f, 1.f);
    if (qFuzzyCompare(v, m_activityTarget))
        return;
    m_activityTarget = v;
    emit activityChanged();
}

void NexusViewport::setAutoRotate(bool on)
{
    if (on == m_camera.idleDrift())
        return;
    m_camera.setIdleDrift(on);
    emit autoRotateChanged();
}

void NexusViewport::setAlert(qreal a)
{
    const float v = std::clamp(float(a), 0.f, 1.f);
    if (qFuzzyCompare(v + 1.f, m_alertTarget + 1.f))
        return;
    m_alertTarget = v;
    emit alertChanged();
}

QString NexusViewport::targetSize() const
{
    return QStringLiteral("%1×%2").arg(m_stats.targetSize.width()).arg(m_stats.targetSize.height());
}

void NexusViewport::onFrame()
{
    const float now = float(m_clock.nsecsElapsed()) / 1.0e9f;
    // raw wall-clock frame time for statistics; clamped step for animation stability
    const float rawDt = std::max(now - m_lastTime, 0.0001f);
    m_dt = std::min(rawDt, 0.1f);
    m_lastTime = now;
    m_time = now;

    m_camera.update(m_dt);
    m_scene.setTime(m_time);
    m_activity += (m_activityTarget - m_activity) * (1.f - std::exp(-m_dt * 2.5f));
    m_alert += (m_alertTarget - m_alert) * (1.f - std::exp(-m_dt * 3.f));

    if (m_hoverDirty && !m_dragging) {
        m_hoverDirty = false;
        setHovered(pickAt(m_hoverPos));
    }

    if ((++m_labelTick & 1) == 0)
        updateLabels();

    ++m_frameCounter;
    m_statWindow += rawDt;
    if (m_statWindow >= 0.5f) {
        m_fps = m_frameCounter / m_statWindow;
        m_frameMs = 1000.0 * m_statWindow / m_frameCounter;
        m_frameCounter = 0;
        m_statWindow = 0.f;
        emit statsChanged();
    }
    emit frameTick(m_time, rawDt);
    update();
}

void NexusViewport::exchangeRenderData(RenderSnapshot &snap, const RenderStats &stats)
{
    m_stats = stats;
    const QSizeF sz = size();
    const float aspect = float(sz.width() / std::max(1.0, sz.height()));
    snap.view = m_camera.view();
    snap.proj = m_camera.projection(aspect);
    snap.cameraPos = m_camera.position();
    snap.cameraRight = m_camera.right();
    snap.cameraUp = m_camera.up();
    snap.nucleus = m_scene.nucleus();
    snap.nucleusRadius = m_scene.nucleusRadius();
    snap.time = m_time;
    snap.dt = m_dt;
    snap.globalActivity = m_activity;
    snap.transitionDuration = 1.8f;
    snap.pixelScale = window() ? float(window()->effectiveDevicePixelRatio()) : 1.f;
    snap.tint = QVector4D(1.0f, 0.30f, 0.37f, m_alert);
    snap.mode = QVector4D(0.f, 0.f, m_selected >= 0 ? 1.f : 0.f, 1.f);
    snap.nodes = m_scene.nodesSnapshot();
    snap.nodesVersion = m_scene.nodesVersion();
    snap.edges = m_scene.edgesSnapshot();
    snap.edgesVersion = m_scene.edgesVersion();
    std::vector<SpawnCommand> fresh = m_scene.takeSpawns();
    snap.spawns.insert(snap.spawns.end(), fresh.begin(), fresh.end());
    snap.quality = m_quality;
    snap.exposure = 1.0f;
    snap.bloomIntensity = 0.85f;
}

int NexusViewport::pickAt(const QPointF &pos) const
{
    const QSizeF vp = size();
    if (vp.isEmpty())
        return -1;
    const Ray ray = m_camera.rayThrough(pos, vp);
    const float ppu1 = float(vp.height()) / (2.f * std::tan(qDegreesToRadians(m_camera.fovY()) * 0.5f));
    return m_scene.pick(ray.origin, ray.dir, 7.f, ppu1);
}

void NexusViewport::setHovered(int g)
{
    if (g == m_hovered)
        return;
    m_hovered = g;
    emit hoveredNodeChanged();
    emit nodeHovered(g, nodeKey(g));
    setCursor(g >= 0 ? Qt::PointingHandCursor : Qt::ArrowCursor);
}

QString NexusViewport::nodeKey(int g) const
{
    const int p = m_scene.projectForGlobal(g);
    if (p >= 0)
        return m_scene.projectNode(p).key;
    const int a = m_scene.agentForGlobal(g);
    if (a >= 0)
        return QStringLiteral("agent:") + m_scene.agent(a).key;
    return {};
}

QPointF NexusViewport::screenPosition(int g) const
{
    QPointF p;
    if (m_camera.project(m_scene.globalPosition(g), size(), &p))
        return p;
    return { -1e4, -1e4 };
}

void NexusViewport::select(int g)
{
    if (g == m_selected)
        return;
    const int prev = m_scene.projectForGlobal(m_selected);
    if (prev >= 0)
        m_scene.setHighlight(prev, 0.f);
    m_selected = g;
    const int p = m_scene.projectForGlobal(g);
    if (p >= 0)
        m_scene.setHighlight(p, 1.f);
    emit selectedNodeChanged();
}

void NexusViewport::flyToNode(int g)
{
    if (g < 0)
        return;
    const QVector3D pos = m_scene.globalPosition(g);
    const int p = m_scene.projectForGlobal(g);
    // frame the node together with its immediate neighbourhood
    float dist = 40.f;
    if (p >= 0) {
        const auto &n = m_scene.projectNode(p);
        dist = n.kind == NodeKind::Directory ? 72.f + n.radius * 6.f : 42.f + n.radius * 7.f;
    }
    m_camera.flyTo(p >= 0 ? m_scene.projectTarget(p) : pos, dist, 1.4f);
}

void NexusViewport::resetView()
{
    m_camera.flyToPose({ 0, 0, 0 }, m_homeDistance, 0.62f, 0.34f, 1.6f);
}

void NexusViewport::frameRadius(float radius, float duration)
{
    const float aspect = float(width() / std::max(1.0, height()));
    const float halfFov = qDegreesToRadians(m_camera.fovY()) * 0.5f;
    // fit the sphere of `radius` vertically and horizontally, with a margin for panels
    const float fitV = radius / std::sin(halfFov);
    const float fitH = radius / std::sin(std::atan(std::tan(halfFov) * aspect));
    m_homeDistance = std::clamp(std::max(fitV, fitH) * 0.92f, 90.f, 900.f);
    m_camera.flyToPose({ 0, 0, 0 }, m_homeDistance, m_camera.yaw(), std::max(0.25f, m_camera.pitch()), duration);
}

void NexusViewport::preset(const QString &name)
{
    if (name == QLatin1String("core"))
        m_camera.flyToPose({ 0, 0, 0 }, 62.f, m_camera.yaw(), 0.22f, 1.4f);
    else if (name == QLatin1String("top"))
        m_camera.flyToPose({ 0, 0, 0 }, m_homeDistance * 1.3f, m_camera.yaw(), 1.40f, 1.6f);
    else if (name == QLatin1String("horizon"))
        m_camera.flyToPose({ 0, 0, 0 }, m_homeDistance * 1.1f, m_camera.yaw(), 0.05f, 1.6f);
    else if (name == QLatin1String("wide"))
        m_camera.flyToPose({ 0, 0, 0 }, std::min(950.f, m_homeDistance * 1.7f), m_camera.yaw(), 0.45f, 1.6f);
    else
        resetView();
}

void NexusViewport::mousePressEvent(QMouseEvent *e)
{
    m_pressPos = e->position();
    m_lastPos = e->position();
    m_pressButton = e->button();
    m_dragging = false;
    forceActiveFocus();
    e->accept();
}

void NexusViewport::mouseMoveEvent(QMouseEvent *e)
{
    const QPointF delta = e->position() - m_lastPos;
    m_lastPos = e->position();
    if (!m_dragging && (e->position() - m_pressPos).manhattanLength() > 4.0)
        m_dragging = true;
    if (!m_dragging)
        return;
    const bool panMode = m_pressButton == Qt::RightButton || m_pressButton == Qt::MiddleButton
                         || (e->modifiers() & Qt::ShiftModifier);
    if (panMode)
        m_camera.pan(delta, size());
    else
        m_camera.orbit(float(-delta.x()) * 0.0055f, float(delta.y()) * 0.0045f);
    e->accept();
}

void NexusViewport::mouseReleaseEvent(QMouseEvent *e)
{
    if (!m_dragging && e->button() == Qt::LeftButton) {
        const int g = pickAt(e->position());
        if (g >= 0) {
            select(g);
            emit nodeClicked(g, nodeKey(g));
        } else {
            select(-1);
            emit backgroundClicked();
        }
    }
    m_dragging = false;
    m_pressButton = Qt::NoButton;
    e->accept();
}

void NexusViewport::mouseDoubleClickEvent(QMouseEvent *e)
{
    const int g = pickAt(e->position());
    if (g >= 0) {
        select(g);
        flyToNode(g);
        emit nodeDoubleClicked(g, nodeKey(g));
    } else {
        resetView();
    }
    e->accept();
}

void NexusViewport::hoverMoveEvent(QHoverEvent *e)
{
    m_hoverPos = e->position();
    m_hoverDirty = true;
}

void NexusViewport::hoverLeaveEvent(QHoverEvent *)
{
    m_hoverDirty = false;
    setHovered(-1);
}

void NexusViewport::wheelEvent(QWheelEvent *e)
{
    const float steps = float(e->angleDelta().y()) / 120.f;
    m_camera.dolly(std::pow(0.88f, steps));
    e->accept();
}

void NexusViewport::updateLabels()
{
    const QSizeF vp = size();
    if (vp.isEmpty())
        return;
    struct Candidate {
        int g;
        float priority;
        int kind;
        QString text;
        QString sub;
        QColor accent;
    };
    std::vector<Candidate> cands;
    const auto &inst = m_scene.instances();
    const QColor ice(155, 231, 255), cyan(63, 212, 255), violet(154, 134, 255), alert(255, 77, 94), glacier(221, 246, 255);

    for (int i = 0; i < m_scene.projectNodeCount(); ++i) {
        const int g = m_scene.globalForProject(i);
        const SceneNode &n = m_scene.projectNode(i);
        const NodeInstance &ni = inst[size_t(g)];
        if (ni.color[3] < 0.3f && g != m_selected)
            continue;
        const float lastRead = m_time - ni.act[0];
        const float lastWrite = m_time - ni.act[1];
        const float lastErr = m_time - ni.act[2];
        float pr = n.importance * 300.f;
        int kind = n.kind == NodeKind::Directory ? 1 : 0;
        QColor accent = n.kind == NodeKind::Directory ? glacier : ice;
        QString sub;
        if (lastErr >= 0 && lastErr < kLabelRecentSeconds * 1.5f) { pr += 700.f; accent = alert; sub = QStringLiteral("FAILED"); }
        else if (lastWrite >= 0 && lastWrite < kLabelRecentSeconds) { pr += 650.f - lastWrite * 20.f; accent = cyan; sub = QStringLiteral("WRITE"); }
        else if (lastRead >= 0 && lastRead < kLabelRecentSeconds) { pr += 600.f - lastRead * 20.f; accent = ice; sub = QStringLiteral("READ"); }
        if (g == m_hovered) pr += 900.f;
        if (g == m_selected) { pr += 1000.f; kind = 3; }
        if (pr < 60.f)
            continue;
        cands.push_back({ g, pr, kind, n.label, sub, accent });
    }
    for (int a = 0; a < m_scene.agentCount(); ++a) {
        const SceneAgent &ag = m_scene.agent(a);
        const int g = m_scene.agentBase() + a;
        QColor c = QColor::fromRgbF(std::min(1.f, ag.color.x()), std::min(1.f, ag.color.y()), std::min(1.f, ag.color.z()));
        cands.push_back({ g, 800.f + (g == m_hovered ? 200.f : 0.f), 2, ag.label,
                          ag.simulated ? QStringLiteral("SIMULATED") : (ag.active ? QStringLiteral("ACTIVE") : QStringLiteral("IDLE")), c });
    }
    std::sort(cands.begin(), cands.end(), [](const Candidate &a, const Candidate &b) { return a.priority > b.priority; });

    std::vector<LabelData> out;
    std::vector<QRectF> occupied;
    const int cap = m_labels.capacity();
    for (const Candidate &c : cands) {
        if (int(out.size()) >= cap)
            break;
        QPointF p;
        float depth = 0.f;
        const QVector3D world = m_scene.globalPosition(c.g);
        if (!m_camera.project(world, vp, &p, &depth))
            continue;
        if (p.x() < -40 || p.y() < -20 || p.x() > vp.width() + 40 || p.y() > vp.height() + 20)
            continue;
        const float ppu = float(vp.height()) / (2.f * std::tan(qDegreesToRadians(m_camera.fovY()) * 0.5f)) / std::max(depth, 0.1f);
        const float pxR = m_scene.globalRadius(c.g) * ppu;
        // directories need to be reasonably close (or important) to earn a label
        if (c.kind == 1 && c.priority < 600.f && pxR < 2.5f && c.priority < 250.f)
            continue;
        const QPointF anchor(p.x() + std::max(6.f, pxR + 6.f), p.y() - 7.0);
        const QRectF box(anchor.x() - 2, anchor.y() - 2, 7.0 * c.text.size() + 16, 18);
        bool overlap = false;
        if (c.priority < 900.f) {
            for (const QRectF &r : occupied)
                if (r.intersects(box)) { overlap = true; break; }
        }
        if (overlap)
            continue;
        occupied.push_back(box);
        LabelData l;
        l.pos = anchor;
        l.text = c.text;
        l.sub = c.sub;
        l.accent = c.accent;
        l.kind = c.kind;
        l.nodeIndex = c.g;
        l.visible = true;
        const float fade = std::clamp(1.f - (depth - 140.f) / 380.f, 0.35f, 1.f);
        l.opacity = c.priority >= 600.f ? 1.f : fade;
        out.push_back(std::move(l));
    }
    m_labels.update(std::move(out));
}

} // namespace nexus::render
