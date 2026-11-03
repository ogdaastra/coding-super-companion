#include "Camera.h"
#include "SceneTypes.h"

#include <algorithm>
#include <cmath>

namespace nexus::render {

namespace {
constexpr float kMinDistance = 4.f;
constexpr float kMaxDistance = 950.f;
constexpr float kPitchLimit = 1.45f;

float smoothFactor(float dt, float rate) { return 1.f - std::exp(-dt * rate); }

float wrapAngle(float a)
{
    const float twoPi = 6.2831853f;
    a = std::fmod(a + 3.14159265f, twoPi);
    if (a < 0.f) a += twoPi;
    return a - 3.14159265f;
}
} // namespace

OrbitCamera::OrbitCamera()
    : m_yaw(0.62f), m_pitch(0.34f), m_distance(185.f), m_target(0, 0, 0),
      m_goalYaw(0.62f), m_goalPitch(0.34f), m_goalDistance(185.f), m_goalTarget(0, 0, 0)
{
}

void OrbitCamera::clampGoals()
{
    m_goalPitch = std::clamp(m_goalPitch, -kPitchLimit, kPitchLimit);
    m_goalDistance = std::clamp(m_goalDistance, kMinDistance, kMaxDistance);
}

void OrbitCamera::notifyInput()
{
    m_idleTime = 0.f;
    if (m_flying) {
        // user takes over: continue from where the flight currently is
        m_flying = false;
        m_goalYaw = m_yaw;
        m_goalPitch = m_pitch;
        m_goalDistance = m_distance;
        m_goalTarget = m_target;
    }
}

void OrbitCamera::orbit(float dYaw, float dPitch)
{
    notifyInput();
    m_goalYaw += dYaw;
    m_goalPitch += dPitch;
    clampGoals();
}

void OrbitCamera::dolly(float factor)
{
    notifyInput();
    m_goalDistance *= factor;
    clampGoals();
}

void OrbitCamera::pan(const QPointF &deltaPixels, const QSizeF &viewport)
{
    notifyInput();
    const float worldPerPixel = 2.f * m_distance * std::tan(qDegreesToRadians(m_fovY) * 0.5f)
                                / float(std::max(1.0, viewport.height()));
    m_goalTarget += (-right() * float(deltaPixels.x()) + up() * float(deltaPixels.y())) * worldPerPixel;
}

void OrbitCamera::flyTo(const QVector3D &target, float distance, float duration)
{
    flyToPose(target, distance, m_goalYaw, m_goalPitch, duration);
}

void OrbitCamera::flyToPose(const QVector3D &target, float distance, float yaw, float pitch, float duration)
{
    m_idleTime = 0.f;
    m_flying = true;
    m_flyT = 0.f;
    m_flyDuration = std::max(duration, 0.05f);
    m_fromYaw = m_yaw;
    m_fromPitch = m_pitch;
    m_fromDist = m_distance;
    m_fromTarget = m_target;
    // shortest rotation
    m_toYaw = m_yaw + wrapAngle(yaw - m_yaw);
    m_toPitch = std::clamp(pitch, -kPitchLimit, kPitchLimit);
    m_toDist = std::clamp(distance, kMinDistance, kMaxDistance);
    m_toTarget = target;
}

void OrbitCamera::update(float dt)
{
    if (m_flying) {
        m_flyT += dt / m_flyDuration;
        const float k = easeInOutCubic(std::min(m_flyT, 1.f));
        m_yaw = m_fromYaw + (m_toYaw - m_fromYaw) * k;
        m_pitch = m_fromPitch + (m_toPitch - m_fromPitch) * k;
        // distance interpolated in log space feels uniform when zooming far
        m_distance = std::exp(std::log(m_fromDist) + (std::log(m_toDist) - std::log(m_fromDist)) * k);
        m_target = m_fromTarget + (m_toTarget - m_fromTarget) * k;
        m_goalYaw = m_yaw;
        m_goalPitch = m_pitch;
        m_goalDistance = m_distance;
        m_goalTarget = m_target;
        if (m_flyT >= 1.f)
            m_flying = false;
        return;
    }

    m_idleTime += dt;
    if (m_idleDrift && m_idleTime > 6.f) {
        const float ramp = std::min((m_idleTime - 6.f) / 4.f, 1.f);
        m_goalYaw += dt * 0.022f * ramp;
    }

    const float a = smoothFactor(dt, 9.f);
    const float z = smoothFactor(dt, 7.f);
    m_yaw += (m_goalYaw - m_yaw) * a;
    m_pitch += (m_goalPitch - m_pitch) * a;
    m_distance += (m_goalDistance - m_distance) * z;
    m_target += (m_goalTarget - m_target) * z;
}

QVector3D OrbitCamera::forward() const
{
    const float cp = std::cos(m_pitch);
    // camera looks from position toward target
    return -QVector3D(cp * std::sin(m_yaw), std::sin(m_pitch), cp * std::cos(m_yaw));
}

QVector3D OrbitCamera::position() const
{
    return m_target - forward() * m_distance;
}

QVector3D OrbitCamera::right() const
{
    return QVector3D::crossProduct(forward(), QVector3D(0, 1, 0)).normalized();
}

QVector3D OrbitCamera::up() const
{
    return QVector3D::crossProduct(right(), forward()).normalized();
}

QMatrix4x4 OrbitCamera::view() const
{
    QMatrix4x4 m;
    m.lookAt(position(), m_target, QVector3D(0, 1, 0));
    return m;
}

QMatrix4x4 OrbitCamera::projection(float aspect) const
{
    QMatrix4x4 m;
    const float nearPlane = std::max(0.2f, m_distance * 0.004f);
    m.perspective(m_fovY, aspect, nearPlane, 5000.f);
    return m;
}

Ray OrbitCamera::rayThrough(const QPointF &pixel, const QSizeF &viewport) const
{
    const float aspect = float(viewport.width() / std::max(1.0, viewport.height()));
    const float ndcX = float(pixel.x() / viewport.width()) * 2.f - 1.f;
    const float ndcY = 1.f - float(pixel.y() / viewport.height()) * 2.f;
    const float tanHalf = std::tan(qDegreesToRadians(m_fovY) * 0.5f);
    QVector3D dir = forward() + right() * (ndcX * tanHalf * aspect) + up() * (ndcY * tanHalf);
    return { position(), dir.normalized() };
}

bool OrbitCamera::project(const QVector3D &world, const QSizeF &viewport, QPointF *out, float *depth) const
{
    const float aspect = float(viewport.width() / std::max(1.0, viewport.height()));
    const QVector4D clip = projection(aspect) * view() * QVector4D(world, 1.f);
    if (clip.w() <= 1e-4f)
        return false;
    const float x = clip.x() / clip.w();
    const float y = clip.y() / clip.w();
    if (out)
        *out = QPointF((x * 0.5f + 0.5f) * viewport.width(), (0.5f - y * 0.5f) * viewport.height());
    if (depth)
        *depth = clip.w();
    return true;
}

} // namespace nexus::render
