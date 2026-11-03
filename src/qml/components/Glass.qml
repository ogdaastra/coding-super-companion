import QtQuick
import Nexus

// A pane of NEXUS glass: chamfered, lit edge, scene bleeding through.
Item {
    id: glass
    property real chamfer: Theme.chamferPanel
    property real lit: 1.0
    property real tint: Backdrop.enabled ? 0.62 : 0.0
    property real fill: 0.90
    property color accent: Theme.cyan
    property real accentMix: 0.0
    property bool ticks: false          // registration ticks for focused panes
    default property alias content: contentItem.data

    ShaderEffect {
        id: fx
        anchors.fill: parent
        visible: Backdrop.source !== null
        property variant source: Backdrop.source
        property rect srcRect: Qt.rect(0, 0, 1, 1)
        property size itemSize: Qt.size(width, height)
        property real chamfer: glass.chamfer
        property real lit: glass.lit
        property real tint: glass.tint
        property real fill: glass.fill
        property color accent: glass.accent
        property real accentMix: glass.accentMix
        vertexShader: "qrc:/shaders/glass.vert.qsb"
        fragmentShader: "qrc:/shaders/glass.frag.qsb"

        function remap() {
            const vp = Backdrop.viewport
            if (!vp || vp.width <= 0 || vp.height <= 0) return
            const p = fx.mapToItem(vp, 0, 0)
            srcRect = Qt.rect(p.x / vp.width, p.y / vp.height, width / vp.width, height / vp.height)
        }
        onWidthChanged: remap()
        onHeightChanged: remap()
        Component.onCompleted: remap()
        Timer { interval: 120; running: glass.visible; repeat: true; onTriggered: fx.remap() }
    }

    // fallback when no backdrop texture is available
    Rectangle {
        anchors.fill: parent
        visible: !fx.visible
        color: Theme.alpha(Theme.graphite, 0.92)
        border.color: Theme.hairline
    }

    // registration ticks at the two square corners
    Item {
        anchors.fill: parent
        visible: glass.ticks
        opacity: 0.8
        Rectangle { x: parent.width - 7; y: -1; width: 7; height: 1; color: Theme.cyan }
        Rectangle { x: parent.width; y: -1; width: 1; height: 7; color: Theme.cyan }
        Rectangle { x: -1; y: parent.height; width: 7; height: 1; color: Theme.cyan }
        Rectangle { x: -1; y: parent.height - 6; width: 1; height: 7; color: Theme.cyan }
    }

    Item {
        id: contentItem
        anchors.fill: parent
    }
}
