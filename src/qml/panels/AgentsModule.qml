import QtQuick
import Nexus

// Multi-agent network: concurrent sessions, their subagents, shared files and conflicts.
Item {
    id: agents
    property var viewport

    function focusPath(path) {
        const rel = path.indexOf(nexus.project.projectRoot + "/") === 0 ? path.substring(nexus.project.projectRoot.length + 1) : ""
        if (!rel.length) return
        const g = nexus.project.globalForKey(rel)
        if (g >= 0) { agents.viewport.select(g); agents.viewport.flyToNode(g); nexus.project.focus(rel); Ui.select("node", rel) }
    }

    Scroller {
        anchors.fill: parent
        Column {
            width: parent.width
            spacing: 18

            Section {
                title: "Conflicts & overlaps"
                trailing: nexus.sessions.conflicts.length
                Label {
                    visible: nexus.sessions.conflicts.length === 0
                    width: parent.width
                    wrapMode: Text.WordWrap
                    elide: Text.ElideNone
                    color: Theme.textTertiary
                    font.pixelSize: 11
                    text: "No shared files. A conflict is reported when two sessions write the same file within two hours; an overlap when they read or write the same file."
                }
                Repeater {
                    model: nexus.sessions.conflicts
                    delegate: Item {
                        width: parent.width; height: 42
                        Rectangle { anchors.fill: parent; color: cm.containsMouse ? Theme.alpha(Theme.amber, 0.08) : Theme.alpha(Theme.amber, modelData.type === "conflict" ? 0.05 : 0.02) }
                        Rectangle { width: 2; height: parent.height; color: modelData.type === "conflict" ? Theme.amber : Theme.alpha(Theme.amber, 0.4) }
                        Column {
                            x: 10; width: parent.width - 16
                            anchors.verticalCenter: parent.verticalCenter
                            spacing: 3
                            Row {
                                spacing: 6
                                Chip { text: modelData.type; tone: Theme.amber; filled: modelData.type === "conflict" }
                                Repeater {
                                    model: modelData.sessions
                                    Rectangle { width: 8; height: 8; radius: 4; color: nexus.sessions.colorForSession(modelData); anchors.verticalCenter: parent.verticalCenter }
                                }
                            }
                            Label { width: parent.width; text: modelData.path; mono: true; font.pixelSize: 10; elide: Text.ElideLeft }
                        }
                        MouseArea { id: cm; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: agents.focusPath(modelData.path) }
                    }
                }
            }

            Section {
                title: "Agents"
                trailing: nexus.sessions.liveSessionCount + " live"
                Repeater {
                    model: nexus.sessions.sessions
                    delegate: Column {
                        width: parent.width
                        spacing: 4
                        readonly property var info: { nexus.sessions.revision; return nexus.sessions.sessionInfo(sessionId) }
                        Item {
                            width: parent.width; height: 44
                            SessionRow { anchors.fill: parent; compact: true }
                        }
                        Repeater {
                            model: parent.info.subagents || []
                            Row {
                                x: 42
                                spacing: 6
                                Icon { name: "agents"; size: 12; color: Theme.violet }
                                Label { text: (modelData.type || "subagent") + "  ·  " + modelData.tools + " tools" + (modelData.end > 0 ? "  ·  finished" : "  ·  running"); font.pixelSize: 11; color: Theme.textSecondary }
                            }
                        }
                    }
                }
                Label { visible: nexus.sessions.sessionCount === 0; text: "No sessions observed."; color: Theme.textTertiary; font.pixelSize: 11 }
            }

            Label {
                width: parent.width
                wrapMode: Text.WordWrap
                elide: Text.ElideNone
                font.pixelSize: 10
                color: Theme.textFaint
                text: "NEXUS monitors sessions it observes. It never starts additional agents on its own; use the Command Centre to start one explicitly."
            }
        }
    }
}
