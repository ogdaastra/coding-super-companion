import QtQuick
import QtQuick.Shapes
import Nexus

// Animated glyph for an observed agent state. Motion encodes the state:
// running = orbiting arc, executing = fast double arc, permission = slow amber breath,
// completed = still ring, failed = red notch, idle = faint dot.
Item {
    id: g
    property string state_: "idle"
    property real size: 22
    implicitWidth: size
    implicitHeight: size
    readonly property color tone: Theme.stateColor(state_)
    readonly property bool spinning: state_ === "running" || state_ === "executing"

    Rectangle {
        anchors.centerIn: parent
        width: g.size * 0.30
        height: width
        radius: width / 2
        color: g.tone
        opacity: g.state_ === "ended" || g.state_ === "stale" ? 0.35 : 0.95
        SequentialAnimation on opacity {
            running: g.state_ === "permission" || g.state_ === "awaiting"
            loops: Animation.Infinite
            NumberAnimation { to: 0.25; duration: 900; easing.type: Easing.InOutSine }
            NumberAnimation { to: 1.0; duration: 900; easing.type: Easing.InOutSine }
        }
    }
    Rectangle {
        anchors.centerIn: parent
        width: g.size * 0.92
        height: width
        radius: width / 2
        color: "transparent"
        border.width: 1
        border.color: Theme.alpha(g.tone, g.state_ === "completed" ? 0.7 : 0.22)
    }
    Shape {
        anchors.fill: parent
        visible: g.spinning || g.state_ === "failed"
        preferredRendererType: Shape.CurveRenderer
        RotationAnimation on rotation {
            running: g.spinning
            from: 0; to: 360
            duration: g.state_ === "executing" ? 900 : 2200
            loops: Animation.Infinite
        }
        ShapePath {
            strokeColor: g.tone
            strokeWidth: 1.6
            fillColor: "transparent"
            capStyle: ShapePath.RoundCap
            PathAngleArc {
                centerX: g.size / 2; centerY: g.size / 2
                radiusX: g.size * 0.46; radiusY: g.size * 0.46
                startAngle: -90; sweepAngle: g.state_ === "failed" ? 40 : 110
            }
        }
        ShapePath {
            strokeColor: Theme.alpha(g.tone, 0.6)
            strokeWidth: 1.2
            fillColor: "transparent"
            capStyle: ShapePath.RoundCap
            PathAngleArc {
                centerX: g.size / 2; centerY: g.size / 2
                radiusX: g.size * 0.46; radiusY: g.size * 0.46
                startAngle: 90; sweepAngle: g.state_ === "executing" ? 90 : 0
            }
        }
    }
}
