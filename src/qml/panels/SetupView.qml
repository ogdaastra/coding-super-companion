import QtQuick
import Nexus

// Setup wizard: detect Claude Code → locate relay → preview hook installation → apply
// with backup → send a test event → confirm telemetry. Plus graphics and data settings.
Glass {
    id: sv
    property var viewport
    property var settings
    ticks: true
    property string scope: "user"
    property bool statusline: true
    property var plan: ({})
    property var result: ({})
    readonly property var integ: nexus.integration
    readonly property var hooks: scope === "user" ? integ.userHooks : integ.projectHooks

    function preview() { result = ({}); plan = scope === "uninstall-user" ? ({}) : integ.previewInstall(scope, statusline) }

    Scroller {
        anchors.fill: parent
        anchors.margins: 26
        Row {
            width: parent.width
            spacing: 34

            // ============================================================ integration
            Column {
                width: (parent.width - 34) * 0.58
                spacing: 20

                Column {
                    spacing: 4
                    Label { text: "Connect Claude Code"; font.pixelSize: 22; font.family: Theme.fontDisplay; font.weight: Font.Light; color: Theme.glacier }
                    Label {
                        width: parent.parent.width
                        wrapMode: Text.WordWrap
                        elide: Text.ElideNone
                        color: Theme.textSecondary
                        text: "NEXUS observes Claude Code through its documented hooks. A small native relay forwards each hook event to NEXUS over a private local socket. Nothing is modified until you review the exact change and apply it."
                    }
                }

                // step 1
                StepCard {
                    width: parent.width
                    number: "1"
                    title: "Detect Claude Code"
                    done: integ.claudeDetected
                    Label { text: integ.claudeDetected ? integ.claudeVersion : (integ.detecting ? "Detecting…" : (integ.claudeError || "Not detected")); color: integ.claudeDetected ? Theme.textPrimary : Theme.amber }
                    Label { width: parent.width; text: integ.claudePath; mono: true; font.pixelSize: 11; color: Theme.textTertiary; elide: Text.ElideLeft }
                    NxButton { text: "Detect again"; icon: "refresh"; implicitHeight: 26; onClicked: integ.detect() }
                }

                // step 2
                StepCard {
                    width: parent.width
                    number: "2"
                    title: "Telemetry relay"
                    done: integ.relayExists && integ.telemetryListening
                    Label { width: parent.width; text: integ.relayPath; mono: true; font.pixelSize: 11; color: integ.relayExists ? Theme.ice : Theme.alert; elide: Text.ElideLeft }
                    Label {
                        text: (integ.telemetryListening ? "Listening on a user-only socket · token-authenticated" : "Socket not listening") + "  ·  " + integ.received + " events received"
                        color: Theme.textSecondary; font.pixelSize: 11
                    }
                }

                // step 3
                StepCard {
                    width: parent.width
                    number: "3"
                    title: "Install hooks"
                    done: (sv.hooks.complete || false)
                    Row {
                        spacing: 10
                        Segmented {
                            model: ["User · all projects", "This project only"]
                            currentIndex: sv.scope === "user" ? 0 : 1
                            onActivated: (i) => { sv.scope = i === 0 ? "user" : "project"; sv.plan = ({}); sv.result = ({}) }
                        }
                        Item {
                            width: slRow.implicitWidth; height: 26
                            Row {
                                id: slRow
                                spacing: 6
                                anchors.verticalCenter: parent.verticalCenter
                                Rectangle {
                                    width: 14; height: 14
                                    anchors.verticalCenter: parent.verticalCenter
                                    color: sv.statusline ? Theme.alpha(Theme.cyan, 0.3) : "transparent"
                                    border.color: sv.statusline ? Theme.cyan : Theme.hairlineStrong
                                    Icon { anchors.centerIn: parent; visible: sv.statusline; name: "check"; size: 12; color: Theme.glacier }
                                }
                                Label { text: "Status-line relay (context & cost)"; font.pixelSize: 11; color: Theme.textSecondary; anchors.verticalCenter: parent.verticalCenter }
                            }
                            MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: { sv.statusline = !sv.statusline; sv.plan = ({}) } }
                        }
                    }
                    Label {
                        width: parent.width
                        wrapMode: Text.WordWrap; elide: Text.ElideNone
                        font.pixelSize: 11; color: Theme.textTertiary
                        text: (sv.scope === "user" ? "Target: " : "Target (not committed): ") + (sv.hooks.path || "—")
                              + (sv.hooks.eventCount > 0 ? "\nCurrently installed for " + sv.hooks.eventCount + " events" + (sv.hooks.statusline ? " + status line" : "") + "." : "")
                              + "\nAn existing status line is preserved: NEXUS chains to it."
                    }
                    Row {
                        spacing: 8
                        NxButton { text: "Preview change"; icon: "eye"; variant: "primary"; onClicked: sv.plan = integ.previewInstall(sv.scope, sv.statusline) }
                        NxButton {
                            visible: sv.hooks.eventCount > 0
                            text: "Preview removal"; icon: "trash"
                            onClicked: { sv.plan = integ.previewUninstall(sv.scope); sv.result = ({}) }
                        }
                    }

                    Column {
                        visible: sv.plan.path !== undefined
                        width: parent.width
                        spacing: 8
                        Label {
                            visible: (sv.plan.error || "").length > 0
                            width: parent.width; wrapMode: Text.WordWrap; elide: Text.ElideNone
                            text: sv.plan.error || ""; color: Theme.alert
                        }
                        Label {
                            visible: !(sv.plan.error || "").length
                            text: sv.plan.changed ? (sv.plan.uninstall ? "This removes only NEXUS handlers:" : (sv.plan.exists ? "Changes to the existing file:" : "A new file will be created:")) : "Already up to date — nothing to change."
                            color: Theme.textSecondary; font.pixelSize: 11
                        }
                        Rectangle {
                            visible: sv.plan.changed === true
                            width: parent.width
                            height: Math.min(300, diffView.implicitHeight + 12)
                            color: Theme.alpha(Theme.void_, 0.6)
                            border.color: Theme.hairline
                            clip: true
                            Scroller {
                                anchors.fill: parent
                                anchors.margins: 6
                                DiffLines { id: diffView; width: parent.width; lines: (sv.plan.diff || []).filter(l => l.t !== " " || true); maxLines: 600 }
                            }
                        }
                        Row {
                            visible: sv.plan.changed === true
                            spacing: 8
                            NxButton {
                                text: sv.plan.uninstall ? "Apply removal" : "Apply"
                                icon: "check"
                                variant: sv.plan.uninstall ? "danger" : "primary"
                                onClicked: Ui.confirm({
                                    title: sv.plan.uninstall ? "Remove NEXUS hooks?" : "Install NEXUS hooks?",
                                    body: "NEXUS will write " + sv.plan.path + ". A timestamped backup of the current file is created first, and the file is replaced atomically. If the file changes in the meantime, nothing is written.",
                                    confirmText: sv.plan.uninstall ? "Remove" : "Install",
                                    danger: sv.plan.uninstall === true
                                }, function() {
                                    sv.result = sv.plan.uninstall ? integ.applyUninstall(sv.scope) : integ.applyInstall(sv.scope, sv.statusline)
                                    sv.plan = ({})
                                })
                            }
                            NxButton { text: "Cancel"; onClicked: sv.plan = ({}) }
                        }
                    }
                    Label {
                        visible: sv.result.message !== undefined
                        width: parent.width; wrapMode: Text.WordWrap; elide: Text.ElideNone
                        text: sv.result.message || ""
                        color: sv.result.ok ? Theme.aurora : Theme.alert
                        font.pixelSize: 11
                    }
                }

                // step 4
                StepCard {
                    width: parent.width
                    number: "4"
                    title: "Verify telemetry"
                    done: integ.probeState === "confirmed"
                    Label {
                        width: parent.width; wrapMode: Text.WordWrap; elide: Text.ElideNone
                        text: integ.probeMessage.length ? integ.probeMessage : "Sends a test event through the relay exactly as a hook would."
                        color: integ.probeState === "confirmed" ? Theme.aurora : (integ.probeState === "failed" ? Theme.alert : Theme.textSecondary)
                        font.pixelSize: 11
                    }
                    Row {
                        spacing: 8
                        NxButton { text: "Send test event"; icon: "pulse"; enabled_: integ.probeState !== "waiting"; onClicked: integ.runProbe() }
                        ScanLine { width: 120; visible: integ.probeState === "waiting"; anchors.verticalCenter: parent.verticalCenter }
                    }
                    Label {
                        width: parent.width; wrapMode: Text.WordWrap; elide: Text.ElideNone
                        font.pixelSize: 11; color: Theme.textTertiary
                        text: "Then start Claude Code in any project. New sessions pick up the hooks automatically; restart sessions that were already running."
                    }
                }
            }

            // ============================================================ settings
            Column {
                width: (parent.width - 34) * 0.42 - 10
                spacing: 20

                Section {
                    title: "Graphics quality"
                    Segmented {
                        model: ["Low", "Medium", "High", "Ultra"]
                        currentIndex: sv.settings.quality
                        onActivated: (i) => sv.settings.quality = i
                    }
                    Label {
                        width: parent.width; wrapMode: Text.WordWrap; elide: Text.ElideNone
                        font.pixelSize: 11; color: Theme.textTertiary
                        text: ["Render scale 0.75, no MSAA, 4 bloom levels, 8k particles, no glass blur.",
                               "Full resolution, no MSAA, 5 bloom levels, 32k particles.",
                               "Full resolution, 4× MSAA, 6 bloom levels, 64k particles.",
                               "1.25× supersampling, 4× MSAA, 6 bloom levels, 192k particles."][sv.settings.quality]
                    }
                    Grid {
                        columns: 3
                        columnSpacing: 18
                        rowSpacing: 10
                        Metric { label: "Backend"; value: sv.viewport.backend }
                        Metric { label: "Frame"; value: sv.viewport.frameMs.toFixed(1); unit: "ms" }
                        Metric { label: "GPU"; value: sv.viewport.gpuMs >= 0 ? sv.viewport.gpuMs.toFixed(1) : "n/a"; unit: sv.viewport.gpuMs >= 0 ? "ms" : "" }
                    }
                    Label {
                        width: parent.width; wrapMode: Text.WordWrap; elide: Text.ElideNone
                        font.pixelSize: 11; color: Theme.textTertiary
                        text: "Graphics API (requested: " + nexus.graphicsRequest + "). Choose another with --backend=vulkan|opengl|metal|d3d11|d3d12 at launch."
                    }
                }

                Section {
                    title: "Simulation"
                    Label {
                        width: parent.width; wrapMode: Text.WordWrap; elide: Text.ElideNone
                        font.pixelSize: 11; color: Theme.textSecondary
                        text: "Generates synthetic, clearly-labelled events using this project's real file list. Nothing is executed or written. Simulated events are marked everywhere and excluded from restored history."
                    }
                    Row {
                        spacing: 8
                        NxButton { text: integ.simulationRunning ? "Stop" : "Start simulation"; icon: integ.simulationRunning ? "stop" : "sim"; enabled_: nexus.project.hasProject; onClicked: integ.simulationRunning ? integ.stopSimulation() : integ.startSimulation(2) }
                        NxButton { text: "Clear simulated data"; icon: "trash"; enabled_: nexus.sessions.hasSimulated; onClicked: integ.clearSimulated() }
                    }
                }

                Section {
                    title: "Data & privacy"
                    Label { width: parent.width; text: integ.dataDir; mono: true; font.pixelSize: 11; color: Theme.ice; elide: Text.ElideLeft }
                    Label {
                        width: parent.width; wrapMode: Text.WordWrap; elide: Text.ElideNone
                        font.pixelSize: 11; color: Theme.textSecondary
                        text: integ.storedEvents + " events stored locally (30-day retention). Credentials are redacted before storage, large file contents are truncated, and NEXUS makes no network connections."
                    }
                    Label { width: parent.width; text: integ.storeStatus; mono: true; font.pixelSize: 10; color: Theme.textFaint; elide: Text.ElideLeft }
                }

                Section {
                    title: "Keyboard"
                    Grid {
                        columns: 2
                        columnSpacing: 16
                        rowSpacing: 5
                        Repeater {
                            model: ["Ctrl K", "Search & commands", "Ctrl 1–8", "Modules", "C", "Cinematic mode", "F11", "Fullscreen", "R", "Reset camera",
                                    "Space", "Replay / pause history", "L", "Return to live", "Ctrl J", "Toggle activity dock", "Ctrl B", "Compact layout", "Esc", "Clear selection"]
                            Label { text: modelData; mono: index % 2 === 0; font.pixelSize: 11; color: index % 2 === 0 ? Theme.ice : Theme.textSecondary }
                        }
                    }
                }
            }
        }
    }
}
