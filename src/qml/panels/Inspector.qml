import QtQuick
import Nexus

// Right intelligence layer: context-sensitive details for the current selection.
Glass {
    id: insp
    property var viewport
    readonly property string selType: Ui.selection.type
    readonly property string primary: { nexus.sessions.sessionCount; nexus.sessions.activeSession; return nexus.sessions.primarySession() }
    // falls back to the primary live session when nothing is selected
    readonly property string mode: selType.length ? selType : (primary.length ? "session" : "")
    readonly property bool hasContent: mode.length > 0
    ticks: selType.length > 0

    Loader {
        anchors.fill: parent
        anchors.margins: 18
        sourceComponent: insp.mode === "node" ? nodeC : insp.mode === "event" ? eventC : insp.mode === "session" ? sessionC : null
    }

    Component { id: nodeC; NodeInspector { keyValue: Ui.selection.key; viewport: insp.viewport } }
    Component { id: sessionC; SessionInspector { sessionId: insp.selType === "session" ? Ui.selection.key : insp.primary } }
    Component { id: eventC; EventInspector { eventIndex: Ui.selection.index; viewport: insp.viewport } }

    IconButton {
        visible: insp.selType.length > 0
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.margins: 10
        icon: "close"
        iconSize: 14
        tooltip: "Close (Esc)"
        onClicked: { Ui.clearSelection(); nexus.project.clearFocus() }
    }
}
