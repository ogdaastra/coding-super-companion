import QtQuick
import Nexus

// Live activity stream: newest first, each event with time, category, summary, duration.
Item {
    id: es

    NxField {
        id: filter
        width: 260
        height: 26
        icon: "search"
        placeholder: "Filter events"
        onTextChanged: nexus.sessions.events.textFilter = text
    }
    Row {
        anchors.left: filter.right
        anchors.leftMargin: 10
        anchors.verticalCenter: filter.verticalCenter
        spacing: 8
        Chip { visible: nexus.sessions.events.sessionFilter.length > 0; text: "session " + nexus.sessions.events.sessionFilter.substring(0, 8); tone: Theme.cyan; mono: true }
        Chip { visible: nexus.sessions.events.categoryFilter.length > 0; text: nexus.sessions.events.categoryFilter; tone: Theme.ice }
        Chip { visible: !nexus.timeline.live; text: "until " + nexus.formatTime(nexus.timeline.playhead); tone: Theme.glacier }
        Label {
            visible: nexus.sessions.events.sessionFilter.length > 0 || nexus.sessions.events.categoryFilter.length > 0
            text: "clear"
            color: Theme.cyan
            font.pixelSize: 11
            anchors.verticalCenter: parent.verticalCenter
            MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: { nexus.sessions.events.sessionFilter = ""; nexus.sessions.events.categoryFilter = "" } }
        }
    }

    // column headings
    Row {
        id: heads
        y: 34
        x: 8
        spacing: 0
        Micro { width: 96; text: "Time" }
        Micro { width: 96; text: "Category" }
        Micro { width: es.width - 96 - 96 - 110 - 120; text: "Event" }
        Micro { width: 110; text: "Duration" }
        Micro { width: 100; text: "Session" }
    }

    ListView {
        id: list
        anchors.top: heads.bottom
        anchors.topMargin: 4
        anchors.bottom: parent.bottom
        width: parent.width
        clip: true
        model: nexus.sessions.events
        boundsBehavior: Flickable.StopAtBounds
        reuseItems: true
        cacheBuffer: 400
        add: Transition {
            NumberAnimation { property: "opacity"; from: 0; to: 1; duration: Theme.standard }
            NumberAnimation { property: "x"; from: -12; to: 0; duration: Theme.emphasis; easing.type: Easing.OutCubic }
        }
        displaced: Transition { NumberAnimation { properties: "y"; duration: Theme.standard; easing.type: Easing.OutCubic } }
        delegate: Item {
            id: row
            width: list.width
            height: 24
            readonly property bool selected: Ui.selection.type === "event" && Ui.selection.index === eventIndex
            readonly property color tone: ok === 0 ? Theme.alert : (testRun ? Theme.aurora : Theme.categoryColor(category))
            Rectangle {
                anchors.fill: parent
                color: row.selected ? Theme.alpha(Theme.cyan, 0.10) : (rm.containsMouse ? Theme.alpha(Theme.ice, 0.045) : (index % 2 ? Theme.alpha(Theme.ice, 0.012) : "transparent"))
            }
            Rectangle { width: 2; height: parent.height - 6; y: 3; color: row.tone; opacity: kind === "tool.pre" ? 0.4 : 0.95 }
            Label { x: 8; width: 92; anchors.verticalCenter: parent.verticalCenter; text: nexus.formatTime(ts); mono: true; font.pixelSize: 11; color: Theme.textTertiary }
            Row {
                x: 104
                width: 92
                anchors.verticalCenter: parent.verticalCenter
                spacing: 5
                Label {
                    text: category.length ? category : kind.split(".")[0]
                    font.pixelSize: 10
                    font.weight: Font.DemiBold
                    font.letterSpacing: 0.8
                    font.capitalization: Font.AllUppercase
                    color: row.tone
                }
                Label { visible: kind === "tool.pre"; text: "start"; font.pixelSize: 9; color: Theme.textFaint }
            }
            Label {
                x: 200
                width: list.width - 200 - 230
                anchors.verticalCenter: parent.verticalCenter
                text: summary
                font.pixelSize: 12
                color: ok === 0 ? "#ffc6cc" : (kind === "tool.pre" ? Theme.textSecondary : Theme.textPrimary)
            }
            Row {
                x: list.width - 228
                width: 110
                anchors.verticalCenter: parent.verticalCenter
                spacing: 4
                Label { text: durationMs >= 0 ? nexus.formatDuration(durationMs) : ""; mono: true; font.pixelSize: 11; color: Theme.textSecondary }
                Label { visible: durationMs >= 0 && provenance === "derived"; text: "der."; font.pixelSize: 9; color: Theme.textFaint; anchors.baseline: parent.children[0].baseline }
            }
            Row {
                x: list.width - 116
                anchors.verticalCenter: parent.verticalCenter
                spacing: 6
                Rectangle { width: 7; height: 7; radius: 3.5; color: agentColor; anchors.verticalCenter: parent.verticalCenter }
                Label { text: (simulated ? "SIM " : "") + (agentType.length ? agentType : sessionId.substring(0, 8)); mono: true; font.pixelSize: 10; color: simulated ? Theme.amber : Theme.textTertiary }
            }
            MouseArea {
                id: rm
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onClicked: { Ui.select("event", "", eventIndex); nexus.timeline.selectedEvent = eventIndex }
            }
        }
        Label {
            visible: list.count === 0
            anchors.centerIn: parent
            text: nexus.sessions.eventCount === 0 ? "Waiting for telemetry…" : "No events match the filter"
            color: Theme.textTertiary
        }
    }
}
