#pragma once

#include <QMatrix4x4>
#include <QPointF>
#include <QSizeF>
#include <QVector3D>

namespace nexus::render {

struct Ray {
    QVector3D origin;
    QVector3D dir;
};

// Orbit camera with critically-damped smoothing (no overshoot), eased fly-to
// transitions and a slow idle drift. All angles in radians.
class OrbitCamera
{
public:
    OrbitCamera();

    void update(float dt);

    void orbit(float dYaw, float dPitch);
    void dolly(float factor);             // multiplicative distance change
    void pan(const QPointF &deltaPixels, const QSizeF &viewport);
    void flyTo(const QVector3D &target, float distance, float duration = 1.3f);
    void flyToPose(const QVector3D &target, float distance, float yaw, float pitch, float duration = 1.5f);
    void notifyInput();                   // resets the idle timer

    void setIdleDrift(bool on) { m_idleDrift = on; }
    bool idleDrift() const { return m_idleDrift; }
    bool isFlying() const { return m_flying; }

    QMatrix4x4 view() const;
    QMatrix4x4 projection(float aspect) const;
    QVector3D position() const;
    QVector3D right() const;
    QVector3D up() const;
    QVector3D forward() const;
    QVector3D target() const { return m_target; }
    float distance() const { return m_distance; }
    float yaw() const { return m_yaw; }
    float pitch() const { return m_pitch; }
    float fovY() const { return m_fovY; }

    Ray rayThrough(const QPointF &pixel, const QSizeF &viewport) const;
    // Projects a world point; returns false when behind the camera.
    bool project(const QVector3D &world, const QSizeF &viewport, QPointF *out, float *depth = nullptr) const;

private:
    void clampGoals();

    // current (smoothed) state
    float m_yaw;
    float m_pitch;
    float m_distance;
    QVector3D m_target;
    // goal state
    float m_goalYaw;
    float m_goalPitch;
    float m_goalDistance;
    QVector3D m_goalTarget;

    // fly-to animation
    bool m_flying = false;
    float m_flyT = 0.f;
    float m_flyDuration = 1.f;
    float m_fromYaw = 0.f, m_toYaw = 0.f;
    float m_fromPitch = 0.f, m_toPitch = 0.f;
    float m_fromDist = 0.f, m_toDist = 0.f;
    QVector3D m_fromTarget, m_toTarget;

    bool m_idleDrift = true;
    float m_idleTime = 0.f;
    float m_fovY = 42.f;
    float m_aspect = 16.f / 9.f;
};

} // namespace nexus::render
