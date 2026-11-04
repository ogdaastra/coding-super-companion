import QtQuick
import Nexus

// Left navigation rail: modules of the environment.
Item {
    id: rail
    width: Theme.railWidth

    readonly property var modules: [
        { id: "core", icon: "core", label: "Core" },
        { id: "universe", icon: "universe", label: "Universe" },
        { id: "observatory", icon: "observatory", label: "Observatory" },
        { id: "changes", icon: "changes", label: "Changes" },
        { id: "command", icon: "command", label: "Command" },
        { id: "agents", icon: "agents", label: "Agents" },
        { id: "atlas", icon: "atlas", label: "Atlas" }
    ]

    Rectangle {
        anchors.fill: parent
        gradient: Gradient {
            orientation: Gradient.Horizontal
            GradientStop { position: 0; color: Theme.alpha(Theme.void_, 0.88) }
            GradientStop { position: 1; color: Theme.alpha(Theme.void_, 0.55) }
        }
    }
    Rectangle { anchors.right: parent.right; width: 1; height: parent.height; color: Theme.hairline }

    Column {
        y: 14
        width: parent.width
        spacing: 4
        Repeater {
            model: rail.modules
            delegate: railItem
        }
    }

    Column {
        anchors.bottom: parent.bottom
        anchors.bottomMargin: 14
        width: parent.width
        spacing: 4
        Loader { sourceComponent: railItem; property var modelData: ({ id: "setup", icon: "settings", label: "Setup" }); property int index: 8; width: parent.width }
    }

    Component {
        id: railItem
        Item {
            width: rail.width
            height: 52
            readonly property bool active: Ui.module === modelData.id
            Rectangle {
                anchors.left: parent.left
                width: 2
                height: parent.active ? 30 : 0
                anchors.verticalCenter: parent.verticalCenter
                color: Theme.cyan
                Behavior on height { NumberAnimation { duration: Theme.standard; easing.type: Easing.OutCubic } }
            }
            Rectangle {
                anchors.centerIn: parent
                width: 42; height: 42
                color: parent.active ? Theme.alpha(Theme.cyan, 0.09) : (ma.containsMouse ? Theme.alpha(Theme.ice, 0.05) : "transparent")
                Behavior on color { ColorAnimation { duration: Theme.micro } }
            }
            Column {
                anchors.centerIn: parent
                spacing: 3
                Icon {
                    anchors.horizontalCenter: parent.horizontalCenter
                    name: modelData.icon
                    size: 20
                    color: parent.parent.active ? Theme.cyan : (ma.containsMouse ? Theme.textPrimary : Theme.textTertiary)
                    Behavior on color { ColorAnimation { duration: Theme.micro } }
                }
                Label {
                    anchors.horizontalCenter: parent.horizontalCenter
                    text: modelData.label
                    font.pixelSize: 9
                    font.letterSpacing: 0.5
                    color: parent.parent.active ? Theme.ice : Theme.textFaint
                }
            }
            // badges with real counts
            Rectangle {
                visible: badge.text.length > 0
                x: parent.width - 18; y: 6
                width: Math.max(14, badge.implicitWidth + 6); height: 13
                color: modelData.id === "changes" ? Theme.alpha(Theme.cyan, 0.85) : Theme.alpha(Theme.amber, 0.9)
                Label {
                    id: badge
                    anchors.centerIn: parent
                    font.pixelSize: 9; font.weight: Font.Bold
                    color: Theme.void_
                    text: modelData.id === "changes" ? (nexus.project.changedCount > 0 ? String(nexus.project.changedCount) : "")
                        : modelData.id === "agents" ? (nexus.sessions.conflicts.length > 0 ? String(nexus.sessions.conflicts.length) : "")
                        : modelData.id === "core" ? (nexus.sessions.liveSessionCount > 0 ? String(nexus.sessions.liveSessionCount) : "") : ""
                }
            }
            MouseArea {
                id: ma
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onClicked: Ui.module = modelData.id
            }
        }
    }
}
