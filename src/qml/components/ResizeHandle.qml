import QtQuick
import Nexus

// Thin drag handle for resizing panels. Emits the drag delta in pixels.
Item {
    id: h
    property int orientation: Qt.Horizontal   // Horizontal: resizes width (drag left/right)
    signal dragged(real delta)
    width: orientation === Qt.Horizontal ? 8 : 100
    height: orientation === Qt.Horizontal ? 100 : 8
    z: 50

    Rectangle {
        anchors.centerIn: parent
        width: h.orientation === Qt.Horizontal ? 2 : Math.min(48, parent.width)
        height: h.orientation === Qt.Horizontal ? Math.min(48, parent.height) : 2
        color: Theme.cyan
        opacity: ma.containsMouse || ma.pressed ? 0.75 : 0.0
        Behavior on opacity { NumberAnimation { duration: Theme.micro } }
    }
    MouseArea {
        id: ma
        anchors.fill: parent
        hoverEnabled: true
        cursorShape: h.orientation === Qt.Horizontal ? Qt.SplitHCursor : Qt.SplitVCursor
        property real last: 0
        onPressed: (m) => last = h.orientation === Qt.Horizontal ? m.x : m.y
        onPositionChanged: (m) => {
            if (!pressed) return
            const cur = h.orientation === Qt.Horizontal ? m.x : m.y
            h.dragged(cur - last)
        }
    }
}
