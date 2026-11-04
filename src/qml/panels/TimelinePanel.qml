import QtQuick
import Nexus

Item {
    id: tp

    TimelineView {
        id: tl
        anchors.fill: parent
        engine: nexus.sessions
        live: nexus.timeline.live
        playhead: nexus.timeline.playhead
        selectedEvent: Ui.selection.type === "event" ? Ui.selection.index : nexus.timeline.selectedEvent
        activeSession: nexus.sessions.activeSession
        labelWidth: 168
        onEventClicked: (idx, sid) => { Ui.select("event", "", idx); nexus.timeline.selectedEvent = idx }
        onSeekRequested: (ts) => nexus.timeline.seek(ts)
        onLaneClicked: (sid) => { Ui.select("session", sid); nexus.sessions.activeSession = sid }
    }

    // time axis labels
    Repeater {
        model: tl.ticks
        Label {
            x: modelData.x + 4
            y: 2
            text: modelData.label
            mono: true
            font.pixelSize: 10
            color: Theme.textFaint
        }
    }

    // lane labels
    Repeater {
        model: tl.lanes
        Item {
            x: 0
            y: modelData.y
            width: tl.labelWidth - 10
            height: modelData.h
            Rectangle { width: 2; height: parent.height - 6; y: 3; color: modelData.color; opacity: modelData.state === "ended" ? 0.35 : 1 }
            Label {
                x: 9
                width: parent.width - 12
                anchors.verticalCenter: parent.verticalCenter
                text: (modelData.simulated ? "SIM · " : "") + modelData.title
                font.pixelSize: modelData.h < 20 ? 9.5 : 10.5
                font.weight: modelData.active ? Font.DemiBold : Font.Normal
                color: modelData.active ? Theme.glacier : Theme.textSecondary
            }
        }
    }

    // empty state
    Column {
        anchors.centerIn: parent
        visible: tl.lanes.length === 0
        spacing: 6
        Label { anchors.horizontalCenter: parent.horizontalCenter; text: "No sessions on the timeline yet"; color: Theme.textSecondary }
        Label { anchors.horizontalCenter: parent.horizontalCenter; text: "Tool calls, waits and milestones appear here as agents work. Scroll to zoom, drag to pan, click to scrub."; color: Theme.textTertiary; font.pixelSize: 11 }
    }

    // hover card
    Glass {
        visible: tl.hoverInfo.title !== undefined
        x: Math.min(tp.width - width - 4, Math.max(tl.labelWidth, (tl.hoverInfo.x || 0) + 12))
        y: Math.max(0, Math.min(tp.height - height, (tl.hoverInfo.y || 0) - height - 6))
        width: Math.min(380, hc.implicitWidth + 24)
        height: hc.implicitHeight + 16
        fill: 0.97
        chamfer: 6
        Column {
            id: hc
            x: 12; y: 8
            spacing: 2
            Row {
                spacing: 6
                Rectangle { width: 7; height: 7; radius: 3.5; color: tl.hoverInfo.color || Theme.cyan; anchors.verticalCenter: parent.verticalCenter }
                Micro { text: (tl.hoverInfo.tool || "") + (tl.hoverInfo.running ? "  ·  running" : ""); anchors.verticalCenter: parent.verticalCenter }
            }
            Label { text: tl.hoverInfo.title || ""; width: Math.min(356, implicitWidth); font.pixelSize: 12 }
            Label {
                visible: tl.hoverInfo.milestone !== true
                text: nexus.formatTime(tl.hoverInfo.ts || 0) + "  ·  " + nexus.formatDuration(tl.hoverInfo.duration === undefined ? -1 : tl.hoverInfo.duration)
                      + (tl.hoverInfo.observed ? " (observed)" : " (derived)") + (tl.hoverInfo.ok === 0 ? "  ·  failed" : "")
                mono: true; font.pixelSize: 10; color: Theme.textTertiary
            }
        }
    }

    Row {
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        spacing: 4
        IconButton { icon: "plus"; iconSize: 13; implicitWidth: 24; implicitHeight: 24; tooltip: "Zoom in"; onClicked: tl.zoomBy(0.6) }
        IconButton { icon: "close"; iconSize: 11; implicitWidth: 24; implicitHeight: 24; rotation: 45; tooltip: "Zoom out"; onClicked: tl.zoomBy(1.6) }
        IconButton { icon: "fit"; iconSize: 13; implicitWidth: 24; implicitHeight: 24; tooltip: "Fit all"; onClicked: tl.zoomToFit() }
    }
}
