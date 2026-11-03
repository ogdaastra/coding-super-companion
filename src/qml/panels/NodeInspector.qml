import QtQuick
import Nexus

// Details for a selected file or directory in the project universe.
Item {
    id: ni
    property string keyValue: ""
    property var viewport
    readonly property var info: { nexus.project.fileCount; nexus.project.changedCount; return nexus.project.nodeInfo(keyValue) }
    readonly property var activity: { nexus.sessions.revision; return info.absolutePath ? nexus.sessions.fileActivity(info.absolutePath) : ({}) }
    readonly property bool isFile: info.type === "file"
    property bool bookmarking: false

    function go(key) {
        const g = nexus.project.globalForKey(key)
        if (g < 0) return
        ni.viewport.select(g)
        ni.viewport.flyToNode(g)
        nexus.project.focus(key)
        Ui.select("node", key)
    }

    Scroller {
        anchors.fill: parent
        Column {
            width: parent.width
            spacing: 16

            Column {
                width: parent.width - 26
                spacing: 4
                Row {
                    spacing: 8
                    Icon { name: ni.isFile ? "file" : "folder"; size: 16; color: ni.isFile ? Theme.ice : Theme.glacier; anchors.verticalCenter: parent.verticalCenter }
                    Micro { text: ni.isFile ? (ni.info.category || "file") : "directory"; anchors.verticalCenter: parent.verticalCenter; color: Theme.ice }
                    Chip { visible: (ni.info.git || "clean") !== "clean"; text: ni.info.git || ""; tone: Theme.changeColor(ni.info.git) }
                }
                Label {
                    width: parent.width
                    text: ni.info.name || ""
                    font.pixelSize: Theme.sizeTitle
                    font.weight: Font.DemiBold
                    mono: ni.isFile
                    color: Theme.glacier
                }
                Label { width: parent.width; text: ni.info.path || ""; mono: true; font.pixelSize: 10; color: Theme.textTertiary; elide: Text.ElideLeft }
            }

            Flow {
                width: parent.width
                spacing: 6
                NxButton { text: "Open"; icon: "external"; implicitHeight: 26; tooltip: "Open in your editor"; onClicked: if (!nexus.integration.openInEditor(ni.info.absolutePath)) Ui.toast("error", "Could not open", ni.info.absolutePath) }
                NxButton { text: "Reveal"; icon: "folder"; implicitHeight: 26; onClicked: nexus.integration.revealInFileManager(ni.info.absolutePath) }
                NxButton {
                    text: "Terminal"; icon: "terminal"; implicitHeight: 26
                    onClicked: {
                        const dir = ni.isFile ? ni.info.absolutePath.substring(0, ni.info.absolutePath.lastIndexOf("/")) : ni.info.absolutePath
                        const r = nexus.integration.openTerminalAt(dir)
                        Ui.toast(r.ok ? "info" : "error", "Terminal", r.message)
                    }
                }
                NxButton { visible: (ni.info.git || "clean") !== "clean"; text: "Diff"; icon: "changes"; implicitHeight: 26; onClicked: { nexus.changes.select(ni.info.path); Ui.module = "changes" } }
                NxButton { text: "Bookmark"; icon: "bookmark"; implicitHeight: 26; onClicked: ni.bookmarking = !ni.bookmarking }
                NxButton { text: "Copy path"; icon: "copy"; implicitHeight: 26; onClicked: { nexus.integration.copyToClipboard(ni.info.absolutePath); Ui.toast("info", "Path copied", ni.info.absolutePath) } }
            }

            Row {
                visible: ni.bookmarking
                width: parent.width
                spacing: 6
                NxField { id: note; width: parent.width - 70; placeholder: "Note (optional)"; onAccepted: save.clicked() }
                NxButton { id: save; text: "Save"; variant: "primary"; onClicked: { nexus.addBookmark(ni.info.path, note.text); note.text = ""; ni.bookmarking = false; Ui.toast("info", "Bookmarked", ni.info.path) } }
            }

            // ---------------------------------------------------------------- metrics
            Grid {
                width: parent.width
                columns: 3
                columnSpacing: 16
                rowSpacing: 12
                Metric { visible: ni.isFile; label: "Lines"; value: String(ni.info.lines || 0) }
                Metric { visible: ni.isFile; label: "Size"; value: nexus.formatBytes(ni.info.size || 0) }
                Metric { visible: ni.isFile; label: "Language"; value: ni.info.language || "—" }
                Metric { visible: !ni.isFile; label: "Files"; value: String(ni.info.totalFiles || 0) }
                Metric { visible: !ni.isFile; label: "Lines"; value: String(ni.info.lines || 0); qualifier: "direct files" }
                Metric { visible: !ni.isFile; label: "Changed"; value: String(ni.info.changed || 0); tone: (ni.info.changed || 0) > 0 ? Theme.cyan : Theme.textPrimary }
                Metric { visible: ni.isFile; label: "Imports"; value: String((ni.info.imports || []).length) }
                Metric { visible: ni.isFile; label: "Imported by"; value: String((ni.info.importedBy || []).length) }
                Metric { visible: ni.isFile && ni.info.gitAdded !== undefined && ni.info.git !== "clean"; label: "Diff"; value: "+" + (ni.info.gitAdded || 0) + " −" + (ni.info.gitRemoved || 0); tone: Theme.cyan }
            }

            // ---------------------------------------------------------------- agent activity on this node
            Section {
                title: "Agent activity"
                trailing: "observed"
                visible: ni.isFile
                Label {
                    visible: (ni.activity.reads || 0) + (ni.activity.writes || 0) === 0
                    text: "No agent has read or written this file in the recorded history."
                    color: Theme.textTertiary
                    font.pixelSize: 11
                    width: parent.width
                    wrapMode: Text.WordWrap
                    elide: Text.ElideNone
                }
                Row {
                    visible: (ni.activity.reads || 0) + (ni.activity.writes || 0) > 0
                    spacing: 20
                    Metric { label: "Reads"; value: String(ni.activity.reads || 0); tone: Theme.ice }
                    Metric { label: "Writes"; value: String(ni.activity.writes || 0); tone: Theme.cyan }
                    Metric { label: "Last touch"; value: nexus.formatAgo(ni.activity.last || 0) }
                }
                Flow {
                    width: parent.width
                    spacing: 6
                    Repeater {
                        model: ni.activity.sessions || []
                        Chip { text: modelData.substring(0, 10); tone: nexus.sessions.colorForSession(modelData); mono: true }
                    }
                }
            }

            // ---------------------------------------------------------------- relationships
            Section {
                title: "Imports"
                trailing: (ni.info.imports || []).length
                visible: ni.isFile && (ni.info.imports || []).length > 0
                Repeater {
                    model: (ni.info.imports || []).slice(0, 24)
                    delegate: linkRow
                }
            }
            Section {
                title: "Imported by"
                trailing: (ni.info.importedBy || []).length
                visible: ni.isFile && (ni.info.importedBy || []).length > 0
                Repeater {
                    model: (ni.info.importedBy || []).slice(0, 24)
                    delegate: linkRow
                }
            }
            Section {
                title: "Symbols"
                trailing: (ni.info.symbolCount || 0) + (ni.info.scanned ? "" : " · not scanned")
                visible: ni.isFile && (ni.info.symbols || []).length > 0
                Repeater {
                    model: (ni.info.symbols || []).slice(0, 40)
                    Item {
                        width: parent.width; height: 20
                        Label { width: 70; text: modelData.kind; font.pixelSize: 10; color: Theme.violet; anchors.verticalCenter: parent.verticalCenter }
                        Label { x: 72; width: parent.width - 120; text: modelData.name; mono: true; font.pixelSize: 11; anchors.verticalCenter: parent.verticalCenter }
                        Label { anchors.right: parent.right; text: ":" + modelData.line; mono: true; font.pixelSize: 10; color: Theme.textTertiary; anchors.verticalCenter: parent.verticalCenter }
                    }
                }
            }
            Section {
                title: "Contents"
                trailing: (ni.info.files || 0) + " files"
                visible: !ni.isFile && (ni.info.children || []).length > 0
                Repeater {
                    model: ni.info.children || []
                    delegate: linkRow
                }
            }
            Label {
                width: parent.width
                wrapMode: Text.WordWrap
                elide: Text.ElideNone
                font.pixelSize: 10
                color: Theme.textFaint
                text: "Structure from NEXUS's lexical scanner (imports, includes and top-level symbols). Dynamic or macro-generated references may be missing."
            }
        }
    }

    Component {
        id: linkRow
        Item {
            width: parent ? parent.width : 200
            height: 22
            Rectangle { anchors.fill: parent; color: lm.containsMouse ? Theme.alpha(Theme.cyan, 0.08) : "transparent" }
            Icon { x: 2; size: 12; name: "arrow"; color: Theme.textTertiary; anchors.verticalCenter: parent.verticalCenter }
            Label { x: 20; width: parent.width - 24; text: modelData.key; mono: true; font.pixelSize: 11; elide: Text.ElideLeft; anchors.verticalCenter: parent.verticalCenter }
            MouseArea { id: lm; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: ni.go(modelData.key) }
        }
    }
}
