import QtQuick
import Nexus

// Change intelligence: working-tree changes attributed to agents, diff review and safe,
// confirmed actions. Nothing is ever discarded without a confirmation and a safety copy.
Glass {
    id: cv
    ticks: true
    readonly property var ch: nexus.changes
    readonly property var selectedFile: {
        for (const f of ch.files) if (f.path === ch.selected) return f
        return null
    }

    // ---------------------------------------------------------------- header
    Item {
        id: head
        x: 20; y: 16
        width: parent.width - 40
        height: 44
        Column {
            spacing: 3
            Label { text: "Change Intelligence"; font.pixelSize: Theme.sizeTitle; font.weight: Font.DemiBold; color: Theme.glacier }
            Label {
                text: cv.ch.isRepo
                      ? "⎇ " + cv.ch.branch + (cv.ch.upstream.length ? "  →  " + cv.ch.upstream : "") + (cv.ch.ahead || cv.ch.behind ? "   ↑" + cv.ch.ahead + " ↓" + cv.ch.behind : "")
                        + "   ·   " + cv.ch.files.length + " changed   ·   +" + cv.ch.totalAdded + " −" + cv.ch.totalRemoved
                      : "This project is not a git repository; NEXUS still records files written by agents."
                color: Theme.textTertiary
                font.pixelSize: 11
            }
        }
        Row {
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            spacing: 8
            Label { text: "updated " + nexus.formatAgo(cv.ch.refreshedAt); color: Theme.textFaint; font.pixelSize: 10; anchors.verticalCenter: parent.verticalCenter }
            NxButton { text: "Refresh"; icon: "refresh"; onClicked: cv.ch.refresh() }
        }
    }
    Rectangle { x: 20; y: head.y + head.height + 10; width: parent.width - 40; height: 1; color: Theme.hairline }

    // ---------------------------------------------------------------- file list
    Item {
        id: listPane
        x: 20
        y: head.y + head.height + 22
        width: Math.min(360, parent.width * 0.34)
        height: parent.height - y - 16

        Scroller {
            anchors.fill: parent
            Column {
                width: parent.width
                spacing: 14
                Section {
                    title: "Working tree"
                    trailing: cv.ch.files.length
                    Repeater {
                        model: cv.ch.files
                        delegate: Item {
                            width: parent.width
                            height: 40
                            readonly property bool sel: cv.ch.selected === modelData.path
                            Rectangle { anchors.fill: parent; color: parent.sel ? Theme.alpha(Theme.cyan, 0.10) : (fm.containsMouse ? Theme.alpha(Theme.ice, 0.045) : "transparent") }
                            Rectangle { width: 2; height: parent.height - 8; y: 4; color: Theme.changeColor(modelData.change) }
                            Column {
                                x: 10; width: parent.width - 96
                                anchors.verticalCenter: parent.verticalCenter
                                spacing: 1
                                Label { width: parent.width; text: modelData.name; mono: true; font.pixelSize: 12 }
                                Label { width: parent.width; text: modelData.dir.length ? modelData.dir : "/"; mono: true; font.pixelSize: 10; color: Theme.textTertiary; elide: Text.ElideLeft }
                            }
                            Row {
                                anchors.right: parent.right
                                anchors.rightMargin: 6
                                anchors.verticalCenter: parent.verticalCenter
                                spacing: 6
                                Repeater {
                                    model: modelData.agentColors
                                    Rectangle { width: 7; height: 7; radius: 3.5; color: modelData; anchors.verticalCenter: parent.verticalCenter }
                                }
                                Column {
                                    anchors.verticalCenter: parent.verticalCenter
                                    Label { anchors.right: parent.right; text: modelData.added >= 0 ? "+" + modelData.added + " −" + modelData.removed : "binary"; mono: true; font.pixelSize: 10; color: Theme.textSecondary }
                                    Label { anchors.right: parent.right; text: modelData.change + (modelData.staged ? " · staged" : ""); font.pixelSize: 9; color: Theme.changeColor(modelData.change) }
                                }
                            }
                            MouseArea { id: fm; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: cv.ch.select(modelData.path) }
                        }
                    }
                    Label { visible: cv.ch.files.length === 0; text: cv.ch.isRepo ? "Working tree clean." : "—"; color: Theme.textTertiary; font.pixelSize: 11 }
                }

                Section {
                    title: "Written by agents, no pending change"
                    trailing: cv.ch.agentOnly.length
                    visible: cv.ch.agentOnly.length > 0
                    Repeater {
                        model: cv.ch.agentOnly
                        Item {
                            width: parent.width; height: 22
                            Label { width: parent.width - 60; text: modelData.name; mono: true; font.pixelSize: 11; anchors.verticalCenter: parent.verticalCenter }
                            Label { anchors.right: parent.right; anchors.verticalCenter: parent.verticalCenter; text: (modelData.simulated ? "sim · " : "") + modelData.writes + "×"; font.pixelSize: 10; color: modelData.simulated ? Theme.amber : Theme.textTertiary }
                        }
                    }
                }

                Section {
                    title: "Recent commits"
                    visible: cv.ch.commits.length > 0
                    Repeater {
                        model: cv.ch.commits.slice(0, 12)
                        Item {
                            width: parent.width; height: 32
                            Label { width: parent.width - 8; text: modelData.subject; font.pixelSize: 11 }
                            Label { y: 15; text: modelData.short + "  ·  " + modelData.author + "  ·  " + nexus.formatAgo(modelData.time); mono: true; font.pixelSize: 10; color: Theme.textTertiary }
                        }
                    }
                }
            }
        }
    }

    Rectangle { x: listPane.x + listPane.width + 12; y: listPane.y; width: 1; height: listPane.height; color: Theme.hairline }

    // ---------------------------------------------------------------- diff review
    Item {
        id: diffPane
        x: listPane.x + listPane.width + 26
        y: listPane.y
        width: parent.width - x - 20
        height: listPane.height

        Column {
            id: diffHead
            width: parent.width
            spacing: 8
            visible: cv.selectedFile !== null
            Row {
                spacing: 8
                Label { text: cv.selectedFile ? cv.selectedFile.path : ""; mono: true; font.pixelSize: 13; font.weight: Font.Medium; color: Theme.glacier }
                Chip { visible: cv.selectedFile !== null; text: cv.selectedFile ? cv.selectedFile.change : ""; tone: Theme.changeColor(cv.selectedFile ? cv.selectedFile.change : "") }
                Chip { visible: cv.selectedFile !== null && cv.selectedFile.agentWrites > 0; text: cv.selectedFile ? cv.selectedFile.agentWrites + " agent writes" : ""; tone: Theme.cyan }
            }
            Flow {
                width: parent.width
                spacing: 6
                NxButton { text: "Open"; icon: "external"; implicitHeight: 26; onClicked: nexus.integration.openInEditor(cv.ch.absolutePath(cv.ch.selected)) }
                NxButton {
                    text: cv.selectedFile && cv.selectedFile.staged && !cv.selectedFile.unstaged ? "Unstage" : "Accept (stage)"
                    icon: "check"; implicitHeight: 26
                    onClicked: {
                        if (cv.selectedFile.staged && !cv.selectedFile.unstaged) cv.ch.unstage(cv.ch.selected)
                        else cv.ch.stage(cv.ch.selected)
                    }
                }
                NxButton {
                    text: cv.selectedFile && cv.selectedFile.change === "untracked" ? "Remove file…" : "Discard changes…"
                    icon: "trash"; variant: "danger"; implicitHeight: 26
                    onClicked: Ui.confirm({
                        title: cv.selectedFile.change === "untracked" ? "Remove this untracked file?" : "Discard working-tree changes?",
                        body: "The current content of " + cv.ch.selected + " is first copied to NEXUS's safety area, so this can be undone by copying it back. Staged changes are kept.",
                        detail: (cv.selectedFile.change === "untracked" ? "(move to safety area) " : "git restore --worktree -- ") + cv.ch.selected + "\nsafety copy: " + nexus.integration.dataDir + "/safety/",
                        danger: true,
                        confirmText: cv.selectedFile.change === "untracked" ? "Remove file" : "Discard changes"
                    }, function() { cv.ch.discard(cv.ch.selected) })
                }
                NxButton {
                    text: "Run tests…"; icon: "flask"; implicitHeight: 26
                    enabled_: cv.ch.testCommand.length > 0 && cv.ch.testState !== "running"
                    onClicked: Ui.confirm({
                        title: "Run the project's tests?",
                        body: "NEXUS runs this command in " + nexus.project.projectRoot + ". You can change it below.",
                        detail: cv.ch.testCommand,
                        confirmText: "Run tests"
                    }, function() { cv.ch.runTests() })
                }
            }
            Rectangle { width: parent.width; height: 1; color: Theme.hairline }
        }

        Scroller {
            anchors.top: diffHead.visible ? diffHead.bottom : parent.top
            anchors.topMargin: 8
            anchors.bottom: testBox.top
            anchors.bottomMargin: 10
            width: parent.width
            visible: cv.selectedFile !== null
            DiffLines { width: parent.width; lines: cv.ch.diff; numbers: true; maxLines: 3000 }
        }
        ScanLine { anchors.top: diffHead.bottom; width: parent.width; visible: cv.ch.diffLoading }

        Column {
            anchors.centerIn: parent
            visible: cv.selectedFile === null
            spacing: 8
            Icon { anchors.horizontalCenter: parent.horizontalCenter; name: "changes"; size: 32; color: Theme.textFaint }
            Label { anchors.horizontalCenter: parent.horizontalCenter; text: cv.ch.files.length ? "Select a changed file to review its diff" : "No pending changes"; color: Theme.textSecondary }
            Label { anchors.horizontalCenter: parent.horizontalCenter; text: "Files modified during a session also glow in the project universe."; color: Theme.textTertiary; font.pixelSize: 11 }
        }

        // tests
        Item {
            id: testBox
            anchors.bottom: parent.bottom
            width: parent.width
            height: cv.ch.testState === "idle" ? 34 : 140
            Behavior on height { NumberAnimation { duration: Theme.standard } }
            Row {
                spacing: 8
                Micro { text: "Test command"; anchors.verticalCenter: parent.verticalCenter }
                NxField { width: 340; height: 26; mono: true; text: cv.ch.testCommand; placeholder: "e.g. ctest --test-dir build"; onAccepted: cv.ch.testCommand = text; input.onEditingFinished: cv.ch.testCommand = text }
                Chip {
                    visible: cv.ch.testState !== "idle"
                    anchors.verticalCenter: parent.verticalCenter
                    text: cv.ch.testState
                    tone: cv.ch.testState === "passed" ? Theme.aurora : cv.ch.testState === "failed" ? Theme.alert : Theme.cyan
                }
                NxButton { visible: cv.ch.testState === "running"; text: "Stop"; icon: "stop"; implicitHeight: 26; onClicked: cv.ch.stopTests() }
            }
            ListView {
                y: 34
                width: parent.width
                height: parent.height - 34
                clip: true
                visible: cv.ch.testState !== "idle"
                model: cv.ch.testOutput
                onCountChanged: positionViewAtEnd()
                delegate: Label { width: ListView.view.width; text: modelData; mono: true; font.pixelSize: 10; color: Theme.textSecondary; elide: Text.ElideRight }
            }
        }
    }

    Connections {
        target: cv.ch
        function onActionResult(ok, message) { Ui.toast(ok ? "info" : "error", ok ? "Done" : "Action failed", message) }
    }
}
