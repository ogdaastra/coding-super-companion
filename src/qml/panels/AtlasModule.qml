import QtQuick
import Nexus

// Knowledge Atlas: externally available project knowledge and recorded session history.
// It does not (and cannot) show model-internal memory.
Item {
    id: atlas
    property var viewport

    function selectKey(key) {
        const g = nexus.project.globalForKey(key)
        if (g < 0) return
        atlas.viewport.select(g)
        atlas.viewport.flyToNode(g)
        nexus.project.focus(key)
        Ui.select("node", key)
    }

    readonly property var instructionFiles: { nexus.sessions.revision; return nexus.sessions.instructionFiles() }

    Scroller {
        anchors.fill: parent
        Column {
            width: parent.width
            spacing: 18

            Section {
                title: "Instructions loaded by agents"
                trailing: atlas.instructionFiles.length
                Label {
                    visible: atlas.instructionFiles.length === 0
                    width: parent.width; wrapMode: Text.WordWrap; elide: Text.ElideNone
                    font.pixelSize: 11; color: Theme.textTertiary
                    text: "Reported by the InstructionsLoaded hook when Claude Code reads CLAUDE.md or rules files."
                }
                Repeater {
                    model: atlas.instructionFiles
                    Label { width: parent.width; text: modelData; mono: true; font.pixelSize: 11; color: Theme.violet; elide: Text.ElideLeft }
                }
            }

            Section {
                title: "Bookmarks & notes"
                trailing: nexus.bookmarks.length
                Repeater {
                    model: nexus.bookmarks
                    delegate: Item {
                        width: parent.width; height: noteCol.implicitHeight + 12
                        Rectangle { anchors.fill: parent; color: bm.containsMouse ? Theme.alpha(Theme.cyan, 0.07) : Theme.alpha(Theme.ice, 0.025) }
                        Column {
                            id: noteCol
                            x: 8; y: 6; width: parent.width - 44
                            spacing: 2
                            Label { width: parent.width; text: modelData.path; mono: true; font.pixelSize: 11; color: Theme.ice }
                            Label { width: parent.width; visible: (modelData.note || "").length > 0; text: modelData.note; wrapMode: Text.WordWrap; elide: Text.ElideNone; font.pixelSize: 11; color: Theme.textSecondary }
                        }
                        MouseArea { id: bm; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: atlas.selectKey(modelData.path) }
                        IconButton {
                            anchors.right: parent.right; anchors.verticalCenter: parent.verticalCenter
                            icon: "trash"; iconSize: 14; tooltip: "Remove bookmark"
                            onClicked: nexus.removeBookmark(modelData.id)
                        }
                    }
                }
                Label {
                    visible: nexus.bookmarks.length === 0
                    width: parent.width; wrapMode: Text.WordWrap; elide: Text.ElideNone
                    font.pixelSize: 11; color: Theme.textTertiary
                    text: "Select a node in the universe and use “Bookmark” in the inspector to attach a note."
                }
            }

            Repeater {
                model: [ { cat: "documentation", title: "Documentation" }, { cat: "configuration", title: "Configuration" }, { cat: "build", title: "Build" } ]
                delegate: Section {
                    title: modelData.title
                    readonly property var files: { nexus.project.fileCount; return nexus.project.filesByCategory(modelData.cat, 40) }
                    trailing: files.length
                    Repeater {
                        model: parent.files
                        delegate: Item {
                            width: parent.width; height: 24
                            Rectangle { anchors.fill: parent; color: dm.containsMouse ? Theme.alpha(Theme.violet, 0.08) : "transparent" }
                            Icon { x: 2; anchors.verticalCenter: parent.verticalCenter; size: 13; name: "atlas"; color: Theme.violet }
                            Label { x: 22; width: parent.width - 70; anchors.verticalCenter: parent.verticalCenter; text: modelData.key; mono: true; font.pixelSize: 11; elide: Text.ElideLeft }
                            Label { anchors.right: parent.right; anchors.verticalCenter: parent.verticalCenter; text: modelData.lines + " l"; mono: true; color: Theme.textTertiary; font.pixelSize: 10 }
                            MouseArea { id: dm; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: atlas.selectKey(modelData.key) }
                        }
                    }
                }
            }
        }
    }
}
