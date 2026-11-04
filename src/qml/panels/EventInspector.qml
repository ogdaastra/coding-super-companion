import QtQuick
import Nexus

// One event: all normalised fields, provenance, per-event diff for edits, raw payload.
Item {
    id: ei
    property int eventIndex: -1
    property var viewport
    readonly property var info: eventIndex >= 0 ? nexus.sessions.eventInfo(eventIndex) : ({})
    property bool showPayload: false

    function focusFile(path) {
        const root = nexus.project.projectRoot + "/"
        if (path.indexOf(root) !== 0) return
        const rel = path.substring(root.length)
        const g = nexus.project.globalForKey(rel)
        if (g >= 0) { ei.viewport.select(g); ei.viewport.flyToNode(g); nexus.project.focus(rel) }
    }

    Scroller {
        anchors.fill: parent
        Column {
            width: parent.width
            spacing: 14

            Column {
                width: parent.width - 26
                spacing: 4
                Row {
                    spacing: 8
                    Rectangle { width: 8; height: 8; radius: 4; color: Theme.categoryColor(ei.info.category || ""); anchors.verticalCenter: parent.verticalCenter }
                    Micro { text: (ei.info.kind || "") + (ei.info.category ? "  ·  " + ei.info.category : ""); anchors.verticalCenter: parent.verticalCenter }
                    Chip { visible: ei.info.simulated === true; text: "Simulated"; tone: Theme.amber; striped: true }
                }
                Label {
                    width: parent.width
                    text: ei.info.summary || ""
                    font.pixelSize: 14
                    font.weight: Font.DemiBold
                    wrapMode: Text.WordWrap
                    maximumLineCount: 4
                    elide: Text.ElideRight
                    color: Theme.glacier
                }
            }

            Grid {
                width: parent.width
                columns: 2
                columnSpacing: 16
                rowSpacing: 10
                Metric { label: "Time"; value: nexus.formatTime(ei.info.ts || 0) }
                Metric { label: "Duration"; value: (ei.info.duration_ms !== undefined) ? nexus.formatDuration(ei.info.duration_ms) : "—"; qualifier: ei.info.duration_ms !== undefined ? ei.info.provenance : "" }
                Metric { label: "Result"; value: ei.info.ok === undefined ? "—" : (ei.info.ok ? "success" : "failed"); tone: ei.info.ok === false ? Theme.alert : Theme.textPrimary }
                Metric { label: "Source"; value: ei.info.source || "—"; qualifier: ei.info.provenance || "" }
                Metric { label: "Tool"; value: ei.info.tool_name || "—" }
                Metric { label: "Session"; value: (ei.info.session_id || "—").substring(0, 12); tone: ei.info.color || Theme.textPrimary }
            }

            Chip { visible: ei.info.test_run === true; text: "Test run (inferred from command)"; tone: Theme.aurora }

            Section {
                title: "Files"
                visible: (ei.info.files || []).length > 0
                Repeater {
                    model: ei.info.files || []
                    Item {
                        width: parent.width; height: 22
                        Rectangle { anchors.fill: parent; color: fm.containsMouse ? Theme.alpha(Theme.cyan, 0.08) : "transparent" }
                        Label { x: 4; width: parent.width - 8; text: modelData; mono: true; font.pixelSize: 11; elide: Text.ElideLeft; anchors.verticalCenter: parent.verticalCenter; color: Theme.ice }
                        MouseArea { id: fm; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: ei.focusFile(modelData) }
                    }
                }
            }

            Section {
                title: "Command"
                visible: (ei.info.command || "").length > 0
                Label { width: parent.width; text: "$ " + (ei.info.command || ""); mono: true; wrapMode: Text.WrapAnywhere; elide: Text.ElideNone; font.pixelSize: 11; color: Theme.violet }
            }

            Section {
                title: "Error"
                visible: (ei.info.error || "").length > 0
                Rectangle {
                    width: parent.width
                    height: err.implicitHeight + 14
                    color: Theme.alpha(Theme.alert, 0.06)
                    border.color: Theme.alpha(Theme.alert, 0.35)
                    Label { id: err; x: 8; y: 7; width: parent.width - 16; text: ei.info.error || ""; mono: true; wrapMode: Text.WrapAnywhere; elide: Text.ElideNone; maximumLineCount: 40; font.pixelSize: 11; color: "#ffc6cc" }
                }
            }

            Section {
                title: ei.info.diffKind === "write" ? "Content written by this event" : "Change made by this event"
                trailing: "from tool input"
                visible: (ei.info.diff || []).length > 0
                DiffLines { width: parent.width; lines: ei.info.diff || []; maxLines: 300 }
            }

            Section {
                title: "Payload"
                trailing: "redacted"
                Row {
                    spacing: 8
                    NxButton { text: ei.showPayload ? "Hide JSON" : "Show JSON"; implicitHeight: 24; onClicked: ei.showPayload = !ei.showPayload }
                    NxButton { text: "Copy"; icon: "copy"; implicitHeight: 24; onClicked: { nexus.integration.copyToClipboard(ei.info.payloadText || ""); Ui.toast("info", "Payload copied", "") } }
                }
                Rectangle {
                    visible: ei.showPayload
                    width: parent.width
                    height: payload.implicitHeight + 14
                    color: Theme.alpha(Theme.void_, 0.6)
                    border.color: Theme.hairline
                    Label { id: payload; x: 7; y: 7; width: parent.width - 14; text: ei.info.payloadText || ""; mono: true; wrapMode: Text.WrapAnywhere; elide: Text.ElideNone; maximumLineCount: 400; font.pixelSize: 10; color: Theme.textSecondary }
                }
            }
        }
    }
}
