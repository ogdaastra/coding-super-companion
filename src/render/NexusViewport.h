#pragma once

#include "Camera.h"
#include "LabelModel.h"
#include "RenderSnapshot.h"
#include "VisualScene.h"

#include <QElapsedTimer>
#include <QQuickRhiItem>
#include <QtQml/qqmlregistration.h>

namespace nexus::render {

// The 3D viewport. Lives on the GUI thread: owns the camera, the authoritative scene
// state and input handling. Rendering happens in NexusRenderer on the render thread.
class NexusViewport : public QQuickRhiItem
{
    Q_OBJECT
    QML_ELEMENT

    Q_PROPERTY(int quality READ quality WRITE setQuality NOTIFY qualityChanged)
    Q_PROPERTY(qreal activity READ activity WRITE setActivity NOTIFY activityChanged)
    Q_PROPERTY(bool autoRotate READ autoRotate WRITE setAutoRotate NOTIFY autoRotateChanged)
    Q_PROPERTY(qreal alert READ alert WRITE setAlert NOTIFY alertChanged)
    Q_PROPERTY(int selectedNode READ selectedNode NOTIFY selectedNodeChanged)
    Q_PROPERTY(int hoveredNode READ hoveredNode NOTIFY hoveredNodeChanged)
    Q_PROPERTY(LabelModel *labels READ labels CONSTANT)

    Q_PROPERTY(qreal fps READ fps NOTIFY statsChanged)
    Q_PROPERTY(qreal frameMs READ frameMs NOTIFY statsChanged)
    Q_PROPERTY(qreal gpuMs READ gpuMs NOTIFY statsChanged)
    Q_PROPERTY(qreal renderMs READ renderMs NOTIFY statsChanged)
    Q_PROPERTY(QString backend READ backend NOTIFY statsChanged)
    Q_PROPERTY(int nodeCount READ nodeCount NOTIFY statsChanged)
    Q_PROPERTY(int edgeCount READ edgeCount NOTIFY statsChanged)
    Q_PROPERTY(int particleCapacity READ particleCapacity NOTIFY statsChanged)
    Q_PROPERTY(int msaa READ msaa NOTIFY statsChanged)
    Q_PROPERTY(bool computeParticles READ computeParticles NOTIFY statsChanged)
    Q_PROPERTY(QString targetSize READ targetSize NOTIFY statsChanged)
    Q_PROPERTY(qreal cameraDistance READ cameraDistance NOTIFY statsChanged)

public:
    explicit NexusViewport(QQuickItem *parent = nullptr);
    ~NexusViewport() override;

    VisualScene *scene() { return &m_scene; }
    OrbitCamera *camera() { return &m_camera; }
    float sceneTime() const { return m_time; }

    int quality() const { return m_quality.preset; }
    void setQuality(int preset);
    qreal activity() const { return m_activityTarget; }
    void setActivity(qreal a);
    bool autoRotate() const { return m_camera.idleDrift(); }
    void setAutoRotate(bool on);
    qreal alert() const { return m_alertTarget; }
    void setAlert(qreal a);
    int selectedNode() const { return m_selected; }
    int hoveredNode() const { return m_hovered; }
    LabelModel *labels() { return &m_labels; }

    qreal fps() const { return m_fps; }
    qreal frameMs() const { return m_frameMs; }
    qreal gpuMs() const { return m_stats.gpuMs; }
    qreal renderMs() const { return m_stats.renderCpuMs; }
    QString backend() const { return m_stats.backend; }
    int nodeCount() const { return m_stats.nodeCount; }
    int edgeCount() const { return m_stats.edgeCount; }
    int particleCapacity() const { return m_stats.particleCapacity; }
    int msaa() const { return m_stats.msaa; }
    bool computeParticles() const { return m_stats.computeParticles; }
    QString targetSize() const;
    qreal cameraDistance() const { return m_camera.distance(); }

    Q_INVOKABLE void flyToNode(int globalIndex);
    Q_INVOKABLE void resetView();
    // Frames a structure of the given radius around the core (keeps the viewing angle).
    void frameRadius(float radius, float duration = 1.6f);
    // Cinematic move: sweep toward a point while rotating around it.
    void sweepTo(const QVector3D &target, float distance, float yawOffset, float duration);
    void returnHome(float duration);
    Q_INVOKABLE void preset(const QString &name);
    Q_INVOKABLE void select(int globalIndex);
    Q_INVOKABLE QString nodeKey(int globalIndex) const;
    Q_INVOKABLE QPointF screenPosition(int globalIndex) const;

    // Called by the renderer during synchronize() (GUI thread blocked).
    void exchangeRenderData(RenderSnapshot &snap, const RenderStats &stats);

signals:
    void qualityChanged();
    void activityChanged();
    void autoRotateChanged();
    void alertChanged();
    void selectedNodeChanged();
    void hoveredNodeChanged();
    void statsChanged();
    void nodeClicked(int globalIndex, const QString &key);
    void nodeDoubleClicked(int globalIndex, const QString &key);
    void nodeHovered(int globalIndex, const QString &key);
    void backgroundClicked();
    void frameTick(float time, float dt);

protected:
    QQuickRhiItemRenderer *createRenderer() override;
    void itemChange(ItemChange change, const ItemChangeData &value) override;
    void mousePressEvent(QMouseEvent *e) override;
    void mouseMoveEvent(QMouseEvent *e) override;
    void mouseReleaseEvent(QMouseEvent *e) override;
    void mouseDoubleClickEvent(QMouseEvent *e) override;
    void hoverMoveEvent(QHoverEvent *e) override;
    void hoverLeaveEvent(QHoverEvent *e) override;
    void wheelEvent(QWheelEvent *e) override;

private:
    void onFrame();
    void updateLabels();
    int pickAt(const QPointF &pos) const;
    void setHovered(int g);

    VisualScene m_scene;
    OrbitCamera m_camera;
    LabelModel m_labels;
    QualitySettings m_quality = QualitySettings::fromPreset(2);
    RenderStats m_stats;

    QElapsedTimer m_clock;
    float m_time = 0.f;
    float m_lastTime = 0.f;
    float m_dt = 0.016f;
    float m_activity = 0.15f;
    float m_activityTarget = 0.15f;
    float m_alert = 0.f;
    float m_alertTarget = 0.f;

    int m_selected = -1;
    int m_hovered = -1;
    QPointF m_pressPos;
    QPointF m_lastPos;
    Qt::MouseButton m_pressButton = Qt::NoButton;
    bool m_dragging = false;
    QPointF m_hoverPos;
    bool m_hoverDirty = false;

    // frame statistics
    int m_frameCounter = 0;
    float m_statWindow = 0.f;
    qreal m_fps = 0.0;
    qreal m_frameMs = 0.0;
    int m_labelTick = 0;
    QMetaObject::Connection m_frameConn;
    float m_homeDistance = 185.f;
};

} // namespace nexus::render
