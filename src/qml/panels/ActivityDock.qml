import QtQuick
import Nexus

// Bottom activity layer: timeline, live event stream, session output, system.
Glass {
    id: dock
    chamfer: 10
    fill: 0.88

    readonly property var tabs: [
        { id: "timeline", label: "Timeline", icon: "clock" },
        { id: "stream", label: "Activity", icon: "pulse" },
        { id: "output", label: "Output", icon: "terminal" },
        { id: "system", label: "System", icon: "gpu" }
    ]

    Item {
        id: tabBar
        width: parent.width
        height: 34
        Row {
            x: 12
            height: parent.height
            spacing: 2
            Repeater {
                model: dock.tabs
                Item {
                    width: tabRow.implicitWidth + 22
                    height: tabBar.height
                    readonly property bool active: Ui.dockTab === modelData.id && Ui.dockOpen
                    Row {
                        id: tabRow
                        anchors.centerIn: parent
                        spacing: 6
                        Icon { name: modelData.icon; size: 14; color: parent.parent.active ? Theme.cyan : Theme.textTertiary; anchors.verticalCenter: parent.verticalCenter }
                        Label { text: modelData.label; font.pixelSize: 12; font.weight: parent.parent.active ? Font.DemiBold : Font.Normal; color: parent.parent.active ? Theme.glacier : Theme.textSecondary; anchors.verticalCenter: parent.verticalCenter }
                        Label {
                            visible: modelData.id === "stream"
                            text: nexus.sessions.events.count
                            mono: true; font.pixelSize: 10; color: Theme.textFaint
                            anchors.verticalCenter: parent.verticalCenter
                        }
                    }
                    Rectangle { anchors.bottom: parent.bottom; width: parent.width; height: 1; color: Theme.cyan; visible: parent.active }
                    MouseArea {
                        anchors.fill: parent
                        cursorShape: Qt.PointingHandCursor
                        onClicked: {
                            if (Ui.dockTab === modelData.id && Ui.dockOpen) Ui.dockOpen = false
                            else { Ui.dockTab = modelData.id; Ui.dockOpen = true }
                        }
                    }
                }
            }
        }

        // playback controls live in the tab bar so they are always reachable
        Row {
            anchors.right: parent.right
            anchors.rightMargin: 10
            anchors.verticalCenter: parent.verticalCenter
            spacing: 4
            Label {
                anchors.verticalCenter: parent.verticalCenter
                text: nexus.timeline.live ? "LIVE" : "HISTORY  " + nexus.formatTime(nexus.timeline.playhead)
                font.pixelSize: 10
                font.weight: Font.DemiBold
                font.letterSpacing: 1.2
                color: nexus.timeline.live ? Theme.cyan : Theme.glacier
                rightPadding: 8
            }
            IconButton { icon: "stepBack"; iconSize: 15; tooltip: "Previous event"; onClicked: nexus.timeline.stepEvent(-1) }
            IconButton { icon: nexus.timeline.playing ? "pause" : "play"; iconSize: 15; tooltip: nexus.timeline.playing ? "Pause (Space)" : "Replay history (Space)"; checked: nexus.timeline.playing; onClicked: nexus.timeline.playing ? nexus.timeline.pause() : nexus.timeline.play() }
            IconButton { icon: "stepFwd"; iconSize: 15; tooltip: "Next event"; onClicked: nexus.timeline.stepEvent(1) }
            Segmented {
                anchors.verticalCenter: parent.verticalCenter
                model: ["1×", "4×", "16×"]
                currentIndex: nexus.timeline.speed >= 16 ? 2 : (nexus.timeline.speed >= 4 ? 1 : 0)
                onActivated: (i) => nexus.timeline.speed = [1, 4, 16][i]
            }
            IconButton { icon: "live"; iconSize: 15; tooltip: "Return to live (L)"; checked: nexus.timeline.live; onClicked: nexus.timeline.goLive() }
            Rectangle { width: 1; height: 18; color: Theme.hairline; anchors.verticalCenter: parent.verticalCenter }
            IconButton { icon: Ui.dockOpen ? "chevronDown" : "chevron"; iconSize: 14; rotation: Ui.dockOpen ? 0 : -90; tooltip: "Collapse (Ctrl+J)"; onClicked: Ui.dockOpen = !Ui.dockOpen }
        }
        Rectangle { anchors.bottom: parent.bottom; x: 10; width: parent.width - 20; height: 1; color: Theme.hairline }
    }

    Item {
        anchors.top: tabBar.bottom
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        anchors.margins: 10
        anchors.topMargin: 6
        visible: Ui.dockOpen
        clip: true
        TimelinePanel { anchors.fill: parent; visible: Ui.dockTab === "timeline" }
        EventStream { anchors.fill: parent; visible: Ui.dockTab === "stream" }
        OutputPanel { anchors.fill: parent; visible: Ui.dockTab === "output" }
        SystemPanel { anchors.fill: parent; visible: Ui.dockTab === "system" }
    }
}
