import QtQuick
import Nexus

// Start and manage Claude Code sessions. Every launch is explicit and shows the exact
// command; nothing is started automatically.
Item {
    id: cmd
    property int modeIndex: 0
    readonly property var modes: ["default", "plan", "acceptEdits"]

    Scroller {
        anchors.fill: parent
        Column {
            width: parent.width
            spacing: 16

            Section {
                title: "Claude Code"
                Row {
                    spacing: 8
                    Icon { name: nexus.integration.claudeDetected ? "check" : "alert"; size: 15; color: nexus.integration.claudeDetected ? Theme.aurora : Theme.amber }
                    Label {
                        width: cmd.width - 30
                        text: nexus.integration.claudeDetected ? (nexus.integration.claudeVersion || "detected") : (nexus.integration.detecting ? "Detecting…" : "Not detected")
                        color: Theme.textSecondary
                    }
                }
                Label { width: parent.width; text: nexus.integration.claudePath; mono: true; font.pixelSize: 10; color: Theme.textTertiary; elide: Text.ElideLeft }
            }

            Section {
                title: "New headless session"
                trailing: "claude -p · stream-json"
                Label { text: "Project"; color: Theme.textTertiary; font.pixelSize: 11 }
                Label { width: parent.width; text: nexus.project.projectRoot || "Open a project first"; mono: true; font.pixelSize: 11; elide: Text.ElideLeft; color: Theme.ice }
                Label { text: "Task"; color: Theme.textTertiary; font.pixelSize: 11 }
                Item {
                    width: parent.width
                    height: 96
                    Chamfer { anchors.fill: parent; cut: 6; fill: Theme.alpha(Theme.void_, 0.55); stroke: prompt.activeFocus ? Theme.alpha(Theme.cyan, 0.6) : Theme.hairlineStrong }
                    Flickable {
                        anchors.fill: parent
                        anchors.margins: 9
                        contentHeight: prompt.paintedHeight
                        clip: true
                        TextEdit {
                            id: prompt
                            width: parent.width
                            wrapMode: TextEdit.Wrap
                            color: Theme.textPrimary
                            font.family: Theme.fontUi
                            font.pixelSize: Theme.sizeBody
                            selectByMouse: true
                            selectionColor: Theme.alpha(Theme.cyan, 0.4)
                            Label {
                                visible: !prompt.text.length && !prompt.activeFocus
                                text: "Describe the task for Claude Code…"
                                color: Theme.textFaint
                            }
                        }
                    }
                }
                Label { text: "Permission mode"; color: Theme.textTertiary; font.pixelSize: 11 }
                Segmented { model: ["default", "plan", "acceptEdits"]; currentIndex: cmd.modeIndex; onActivated: (i) => cmd.modeIndex = i }
                Label {
                    width: parent.width
                    wrapMode: Text.WordWrap
                    elide: Text.ElideNone
                    font.pixelSize: 10
                    color: Theme.textTertiary
                    text: cmd.modeIndex === 0 ? "Headless sessions cannot answer permission prompts; tools that need approval are denied."
                        : cmd.modeIndex === 1 ? "Plan mode: Claude analyses and proposes, without editing files."
                        : "Edits are applied without prompting. Commands still require permission."
                }
                Row {
                    spacing: 8
                    NxButton {
                        text: "Launch session"
                        icon: "play"
                        variant: "primary"
                        enabled_: nexus.integration.claudeDetected && nexus.project.hasProject && prompt.text.trim().length > 0
                        onClicked: Ui.confirm({
                            title: "Start a headless Claude Code session?",
                            body: "Claude Code will run in " + nexus.project.projectRoot + " with the task below. It can read and modify files according to the selected permission mode. NEXUS receives telemetry through a session-only --settings file; your configuration is not changed.",
                            detail: "claude -p --output-format stream-json --verbose --permission-mode " + cmd.modes[cmd.modeIndex] + " --settings <nexus session settings>\n\nstdin: " + prompt.text.trim(),
                            confirmText: "Start session"
                        }, function() {
                            const key = nexus.integration.launchHeadless(nexus.project.projectRoot, prompt.text.trim(), cmd.modes[cmd.modeIndex], "")
                            if (key.length) { Ui.dockTab = "output"; Ui.dockOpen = true; prompt.text = "" }
                        })
                    }
                    NxButton {
                        text: "Open in terminal"
                        icon: "terminal"
                        enabled_: nexus.integration.claudeDetected && nexus.project.hasProject
                        onClicked: Ui.confirm({
                            title: "Open an interactive Claude Code session?",
                            body: "A terminal window opens in the project directory running Claude Code with NEXUS telemetry enabled for that session only.",
                            detail: "claude --settings <nexus session settings>",
                            confirmText: "Open terminal"
                        }, function() {
                            const r = nexus.integration.launchTerminal(nexus.project.projectRoot)
                            Ui.toast(r.ok ? "info" : "error", r.ok ? "Terminal session" : "Could not open terminal", r.message)
                        })
                    }
                }
            }

            Section {
                title: "Sessions started by NEXUS"
                trailing: nexus.integration.launches.length
                Repeater {
                    model: nexus.integration.launches
                    delegate: Item {
                        width: parent.width
                        height: 54
                        Rectangle { anchors.fill: parent; color: Theme.alpha(Theme.ice, 0.03) }
                        Column {
                            x: 10; width: parent.width - 60
                            anchors.verticalCenter: parent.verticalCenter
                            spacing: 2
                            Row {
                                spacing: 6
                                Chip { text: modelData.mode; tone: Theme.ice }
                                Chip {
                                    text: modelData.state
                                    tone: modelData.state === "running" ? Theme.cyan : modelData.state === "finished" ? Theme.aurora : modelData.state === "starting" ? Theme.ice : Theme.alert
                                }
                                Label { text: nexus.formatAgo(modelData.started); color: Theme.textTertiary; font.pixelSize: 10; anchors.verticalCenter: parent.verticalCenter }
                            }
                            Label { width: parent.width; text: modelData.prompt || modelData.lastLine; font.pixelSize: 11 }
                        }
                        IconButton {
                            anchors.right: parent.right
                            anchors.verticalCenter: parent.verticalCenter
                            visible: modelData.mode === "headless" && (modelData.state === "running" || modelData.state === "starting")
                            icon: "stop"
                            tint: Theme.alert
                            tooltip: "Stop this session"
                            onClicked: Ui.confirm({
                                title: "Stop this Claude Code session?",
                                body: "NEXUS sends an interrupt, then terminates the process if it does not exit within a few seconds. Work already written to disk is kept.",
                                danger: true,
                                confirmText: "Stop session"
                            }, function() { nexus.integration.stopLaunch(modelData.key) })
                        }
                        MouseArea { anchors.fill: parent; z: -1; onClicked: { Ui.dockTab = "output"; Ui.dockOpen = true; outputSelection.key = modelData.key } }
                    }
                }
                Label { visible: nexus.integration.launches.length === 0; text: "None yet."; color: Theme.textTertiary; font.pixelSize: 11 }
            }
        }
    }
    QtObject { id: outputSelection; property string key: "" }
}
