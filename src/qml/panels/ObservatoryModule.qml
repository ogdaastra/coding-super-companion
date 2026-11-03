import QtQuick
import Nexus

Item {
    id: obs

    Column {
        id: head
        width: parent.width
        spacing: 10
        Micro { text: "Filter activity" }
        Flow {
            width: parent.width
            spacing: 6
            Repeater {
                model: [ { k: "", t: "All" }, { k: "read", t: "Reads" }, { k: "write", t: "Writes" }, { k: "exec", t: "Commands" },
                         { k: "search", t: "Search" }, { k: "tests", t: "Tests" }, { k: "errors", t: "Errors" }, { k: "lifecycle", t: "Lifecycle" } ]
                NxButton {
                    text: modelData.t
                    checked: nexus.sessions.events.categoryFilter === modelData.k
                    implicitHeight: 24
                    onClicked: nexus.sessions.events.categoryFilter = modelData.k
                }
            }
        }
        Item {
            width: parent.width; height: 16
            Micro { text: "Sessions"; anchors.verticalCenter: parent.verticalCenter }
            Label {
                visible: nexus.sessions.events.sessionFilter.length > 0
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
                text: "Show all sessions"
                color: Theme.cyan
                font.pixelSize: 11
                MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: nexus.sessions.events.sessionFilter = "" }
            }
        }
    }

    ListView {
        anchors.top: head.bottom
        anchors.topMargin: 6
        anchors.bottom: parent.bottom
        width: parent.width
        clip: true
        model: nexus.sessions.sessions
        spacing: 2
        delegate: Item {
            width: ListView.view.width
            height: 58
            SessionRow { anchors.fill: parent }
            Rectangle {
                visible: nexus.sessions.events.sessionFilter === sessionId
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
                width: 3; height: 26
                color: Theme.cyan
            }
            MouseArea {
                anchors.fill: parent
                acceptedButtons: Qt.LeftButton
                onClicked: {
                    Ui.select("session", sessionId)
                    nexus.sessions.activeSession = sessionId
                    nexus.sessions.events.sessionFilter = sessionId
                }
            }
        }
        Label {
            visible: parent.count === 0
            anchors.top: parent.top
            width: parent.width
            text: "Sessions appear here as Claude Code reports them."
            wrapMode: Text.WordWrap
            color: Theme.textTertiary
        }
    }
}
