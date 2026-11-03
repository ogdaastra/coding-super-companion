import QtQuick
import Nexus

// Camera presets, layout selector and visual modes for the 3D environment.
Glass {
    id: vc
    property var viewport
    width: 46
    height: col.implicitHeight + 16
    chamfer: 8
    fill: 0.78

    Column {
        id: col
        anchors.horizontalCenter: parent.horizontalCenter
        y: 8
        spacing: 2
        IconButton { icon: "target"; tooltip: "Reset view (R)"; onClicked: vc.viewport.resetView() }
        IconButton { icon: "core"; tooltip: "Focus the NEXUS core"; onClicked: vc.viewport.preset("core") }
        IconButton { icon: "layers"; tooltip: "Top-down view"; onClicked: vc.viewport.preset("top") }
        IconButton { icon: "eye"; tooltip: "Horizon view"; onClicked: vc.viewport.preset("horizon") }
        IconButton { icon: "fit"; tooltip: "Wide view"; onClicked: vc.viewport.preset("wide") }
        Rectangle { width: 26; height: 1; color: Theme.hairline; anchors.horizontalCenter: parent.horizontalCenter }
        IconButton { icon: "refresh"; tooltip: "Auto-rotate when idle"; checked: vc.viewport.autoRotate; onClicked: vc.viewport.autoRotate = !vc.viewport.autoRotate }
        IconButton { icon: "pulse"; tooltip: "Activity heat"; checked: nexus.director.heatMode; onClicked: nexus.director.heatMode = !nexus.director.heatMode }
        Rectangle { width: 26; height: 1; color: Theme.hairline; anchors.horizontalCenter: parent.horizontalCenter }
        Repeater {
            model: [
                { icon: "universe", tip: "Hierarchical galaxy" },
                { icon: "agents", tip: "Dependency constellation" },
                { icon: "link", tip: "Force-directed graph" },
                { icon: "stack", tip: "Layered architecture" },
                { icon: "branch", tip: "Directory tree" },
                { icon: "gpu", tip: "Activity heatmap" }
            ]
            IconButton {
                icon: modelData.icon
                tooltip: modelData.tip
                checked: nexus.project.layout === index
                onClicked: nexus.project.layout = index
            }
        }
    }
}
