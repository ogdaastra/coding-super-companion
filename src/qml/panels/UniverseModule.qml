import QtQuick
import Nexus

Item {
    id: uni
    property var viewport

    function selectKey(key) {
        const g = nexus.project.globalForKey(key)
        if (g < 0) return
        uni.viewport.select(g)
        uni.viewport.flyToNode(g)
        nexus.project.focus(key)
        Ui.select("node", key)
    }

    Scroller {
        anchors.fill: parent
        Column {
            width: parent.width
            spacing: 18

            NxField {
                id: search
                width: parent.width
                icon: "search"
                placeholder: "Find a file, directory or symbol"
                onAccepted: if (results.count > 0) uni.selectKey(results.itemAt(0).keyValue)
            }
            Column {
                width: parent.width
                spacing: 1
                visible: search.text.length > 0
                Repeater {
                    id: results
                    model: search.text.length > 0 ? nexus.project.search(search.text, 14) : []
                    delegate: Item {
                        readonly property string keyValue: modelData.key
                        width: parent.width; height: 34
                        Rectangle { anchors.fill: parent; color: rm.containsMouse ? Theme.alpha(Theme.cyan, 0.08) : "transparent" }
                        Icon { x: 4; anchors.verticalCenter: parent.verticalCenter; size: 14; name: modelData.type === "directory" ? "folder" : (modelData.type === "symbol" ? "link" : "file"); color: modelData.type === "symbol" ? Theme.violet : Theme.ice }
                        Column {
                            x: 26; width: parent.width - 30
                            anchors.verticalCenter: parent.verticalCenter
                            Label { width: parent.width; text: modelData.title; font.pixelSize: 12; mono: modelData.type === "symbol" }
                            Label { width: parent.width; text: modelData.detail; font.pixelSize: 10; color: Theme.textTertiary; elide: Text.ElideMiddle }
                        }
                        MouseArea { id: rm; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: uni.selectKey(modelData.key) }
                    }
                }
                Label { visible: results.count === 0; text: "No matches"; color: Theme.textTertiary; font.pixelSize: 11 }
            }

            Section {
                title: "Layout"
                trailing: nexus.project.layingOut ? "computing…" : ""
                Repeater {
                    model: [
                        { name: "Hierarchical galaxy", desc: "Directories bloom outward from the core; files cluster around them." },
                        { name: "Dependency constellation", desc: "Force layout driven by import edges: coupled files gather." },
                        { name: "Force-directed", desc: "Containment and imports balanced (Barnes–Hut)." },
                        { name: "Layered architecture", desc: "Import depth as stacked planes: foundations at the bottom." },
                        { name: "Directory tree", desc: "Cone tree of the filesystem hierarchy." },
                        { name: "Activity heatmap", desc: "Spiral disc; brightness follows agent activity." }
                    ]
                    delegate: Item {
                        width: parent.width
                        height: 40
                        readonly property bool active: nexus.project.layout === index
                        Rectangle { anchors.fill: parent; color: parent.active ? Theme.alpha(Theme.cyan, 0.09) : (lm.containsMouse ? Theme.alpha(Theme.ice, 0.04) : "transparent") }
                        Rectangle { visible: parent.active; width: 2; height: parent.height - 10; y: 5; color: Theme.cyan }
                        Column {
                            x: 12; width: parent.width - 16
                            anchors.verticalCenter: parent.verticalCenter
                            spacing: 1
                            Label { text: modelData.name; font.weight: parent.parent.active ? Font.DemiBold : Font.Normal; color: parent.parent.active ? Theme.glacier : Theme.textPrimary }
                            Label { width: parent.width; text: modelData.desc; color: Theme.textTertiary; font.pixelSize: 10 }
                        }
                        MouseArea { id: lm; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: nexus.project.layout = index }
                    }
                }
            }

            Section {
                title: "Structure"
                trailing: nexus.project.dirCount + " directories"
                Repeater {
                    model: { nexus.project.fileCount; return nexus.project.topLevel() }
                    delegate: Item {
                        width: parent.width; height: 26
                        Rectangle { anchors.fill: parent; color: tm.containsMouse ? Theme.alpha(Theme.cyan, 0.07) : "transparent" }
                        Icon { x: 2; anchors.verticalCenter: parent.verticalCenter; size: 14; name: modelData.type === "directory" ? "folder" : "file"; color: modelData.type === "directory" ? Theme.ice : Theme.textTertiary }
                        Label { x: 24; width: parent.width - 70; anchors.verticalCenter: parent.verticalCenter; text: modelData.name + (modelData.type === "directory" ? "/" : ""); mono: true; font.pixelSize: 11 }
                        Label { anchors.right: parent.right; anchors.verticalCenter: parent.verticalCenter; visible: modelData.type === "directory"; text: modelData.files; mono: true; color: Theme.textTertiary; font.pixelSize: 10 }
                        MouseArea { id: tm; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: uni.selectKey(modelData.key) }
                    }
                }
            }

            Section {
                title: "Legend"
                Grid {
                    columns: 2
                    columnSpacing: 14
                    rowSpacing: 7
                    width: parent.width
                    Repeater {
                        model: [
                            { c: "#40b8ff", t: "Source" }, { c: "#75dbff", t: "Header" }, { c: "#4fe3c1", t: "Test" },
                            { c: "#9a86ff", t: "Documentation" }, { c: "#6b7afa", t: "Configuration" }, { c: "#8c9ffa", t: "Shader / build" },
                            { c: "#384d70", t: "Asset" }, { c: "#8cd0ff", t: "Directory hub" }
                        ]
                        Row {
                            spacing: 7
                            Rectangle { width: 8; height: 8; radius: 4; color: modelData.c; anchors.verticalCenter: parent.verticalCenter }
                            Label { text: modelData.t; font.pixelSize: 11; color: Theme.textSecondary }
                        }
                    }
                }
                Label {
                    width: parent.width
                    wrapMode: Text.WordWrap
                    elide: Text.ElideNone
                    font.pixelSize: 10
                    color: Theme.textTertiary
                    text: "Rings: cyan modified · aurora added · red deleted · ice untracked. Light: ice read, cyan/white write, red failure, amber waiting."
                }
            }
        }
    }
}
