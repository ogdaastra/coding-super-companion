import QtQuick
import Nexus

// One agent session in a list. Expects model roles from SessionListModel.
Item {
    id: row
    width: ListView.view ? ListView.view.width : 280
    height: compact ? 44 : 58
    property bool compact: false
    readonly property bool selected: Ui.selection.type === "session" && Ui.selection.key === sessionId

    Rectangle {
        anchors.fill: parent
        color: row.selected ? Theme.alpha(Theme.cyan, 0.09) : (ma.containsMouse ? Theme.alpha(Theme.ice, 0.04) : "transparent")
        Behavior on color { ColorAnimation { duration: Theme.micro } }
    }
    Rectangle { x: 0; y: 8; width: 2; height: parent.height - 16; color: agentColor; opacity: agentState === "ended" || agentState === "stale" ? 0.3 : 1 }
    StateGlyph { x: 12; anchors.verticalCenter: parent.verticalCenter; state_: agentState; size: 20 }
    Column {
        x: 42
        width: parent.width - 50
        anchors.verticalCenter: parent.verticalCenter
        spacing: 2
        Row {
            width: parent.width
            spacing: 6
            Label {
                width: parent.width - (simChip.visible ? simChip.width + 6 : 0)
                text: title
                font.weight: Font.Medium
                color: agentState === "ended" || agentState === "stale" ? Theme.textSecondary : Theme.textPrimary
            }
            Chip { id: simChip; visible: simulated; text: "SIM"; tone: Theme.amber; striped: true }
        }
        Label {
            width: parent.width
            text: stateLabel + (detail.length ? "  ·  " + detail : "")
            color: Theme.stateColor(agentState)
            font.pixelSize: 11
        }
        Label {
            visible: !row.compact
            width: parent.width
            text: (project.length ? project + "  ·  " : "") + toolCount + " tools  ·  " + fileCount + " files" + (errorCount > 0 ? "  ·  " + errorCount + " errors" : "") + "  ·  " + nexus.formatAgo(lastTs)
            color: Theme.textTertiary
            font.pixelSize: 10
            mono: false
        }
    }
    MouseArea {
        id: ma
        anchors.fill: parent
        hoverEnabled: true
        cursorShape: Qt.PointingHandCursor
        onClicked: {
            Ui.select("session", sessionId)
            nexus.sessions.activeSession = sessionId
        }
    }
}
