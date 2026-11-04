import QtQuick
import Nexus

// Indeterminate loading indicator: a bright segment sweeping along a hairline.
Item {
    id: s
    property bool running: true
    property real progress: -1   // 0..1 for determinate progress
    implicitHeight: 2
    clip: true
    Rectangle { anchors.fill: parent; color: Theme.alpha(Theme.cyan, 0.08) }
    Rectangle {
        visible: s.progress >= 0
        height: parent.height
        width: parent.width * Math.max(0, Math.min(1, s.progress))
        color: Theme.cyan
        Behavior on width { NumberAnimation { duration: 200 } }
    }
    Rectangle {
        id: sweep
        visible: s.progress < 0 && s.running
        height: parent.height
        width: parent.width * 0.28
        gradient: Gradient {
            orientation: Gradient.Horizontal
            GradientStop { position: 0; color: "transparent" }
            GradientStop { position: 0.7; color: Theme.cyan }
            GradientStop { position: 1; color: Theme.glacier }
        }
        NumberAnimation on x {
            running: sweep.visible
            from: -sweep.width; to: s.width
            duration: 1300
            loops: Animation.Infinite
            easing.type: Easing.InOutQuad
        }
    }
}
