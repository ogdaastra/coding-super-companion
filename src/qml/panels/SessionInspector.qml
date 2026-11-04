import QtQuick
import Nexus

// Session intelligence: observable state with provenance, task, metrics, context
// figures (reported values only), tools, files, commands, milestones.
Item {
    id: si
    property string sessionId: ""
    readonly property var info: { nexus.sessions.revision; tick.n; return sessionId.length ? nexus.sessions.sessionInfo(sessionId) : ({}) }
    readonly property var ctx: info.context || ({})
    readonly property var files: { nexus.sessions.revision; return sessionId.length ? nexus.sessions.sessionFiles(sessionId, 30) : [] }
    QtObject { id: tick; property int n: 0 }
    Timer { interval: 1000; running: true; repeat: true; onTriggered: tick.n++ }

    Scroller {
        anchors.fill: parent
        Column {
            width: parent.width
            spacing: 16

            // ---------------------------------------------------------------- state
            Column {
                width: parent.width - 26
                spacing: 6
                Row {
                    spacing: 8
                    Rectangle { width: 8; height: 8; radius: 4; color: si.info.color || Theme.cyan; anchors.verticalCenter: parent.verticalCenter }
                    Micro { text: "Session  ·  " + (si.info.id || "").substring(0, 13); anchors.verticalCenter: parent.verticalCenter }
                    Chip { visible: si.info.simulated === true; text: "Simulated"; tone: Theme.amber; striped: true }
                    Chip { visible: si.info.launched === true; text: "Started by NEXUS"; tone: Theme.ice }
                }
                Label {
                    width: parent.width
                    text: si.info.task || si.info.title || "Waiting for a prompt"
                    font.pixelSize: 15
                    font.weight: Font.DemiBold
                    wrapMode: Text.WordWrap
                    maximumLineCount: 3
                    elide: Text.ElideRight
                    color: Theme.glacier
                }
            }

            Item {
                width: parent.width
                height: 56
                Chamfer { anchors.fill: parent; cut: 7; fill: Theme.alpha(Theme.stateColor(si.info.state || "idle"), 0.06); stroke: Theme.alpha(Theme.stateColor(si.info.state || "idle"), 0.35) }
                StateGlyph { x: 12; anchors.verticalCenter: parent.verticalCenter; state_: si.info.state || "idle"; size: 26 }
                Column {
                    x: 50; width: parent.width - 60
                    anchors.verticalCenter: parent.verticalCenter
                    spacing: 2
                    Row {
                        spacing: 8
                        Label { text: si.info.stateLabel || "—"; font.weight: Font.DemiBold; color: Theme.stateColor(si.info.state || "idle") }
                        Chip { text: si.info.stateProvenance || "observed"; tone: si.info.stateProvenance === "inferred" ? Theme.amber : (si.info.stateProvenance === "derived" ? Theme.violet : Theme.aurora) }
                        Label { text: "for " + nexus.formatDuration(Date.now() - (si.info.stateSince || Date.now())); color: Theme.textTertiary; font.pixelSize: 11; anchors.verticalCenter: parent.verticalCenter }
                    }
                    Label { width: parent.width; text: si.info.runningTool || si.info.stateDetail || ""; color: Theme.textSecondary; font.pixelSize: 11 }
                }
            }
            Label {
                width: parent.width
                wrapMode: Text.WordWrap
                elide: Text.ElideNone
                font.pixelSize: 10
                color: Theme.textFaint
                text: "States come from hook events. “Running” between a prompt and the next tool call is derived; NEXUS cannot observe model reasoning."
            }

            // ---------------------------------------------------------------- metrics
            Grid {
                width: parent.width
                columns: 3
                columnSpacing: 14
                rowSpacing: 12
                Metric { label: "Elapsed"; value: nexus.formatDuration(si.info.elapsedMs || 0) }
                Metric { label: "Tool calls"; value: String(si.info.tools || 0) }
                Metric { label: "Files touched"; value: String(si.info.filesTouched || 0) }
                Metric { label: "Reads"; value: String(si.info.reads || 0); tone: Theme.ice }
                Metric { label: "Writes"; value: String(si.info.writes || 0); tone: Theme.cyan }
                Metric { label: "Commands"; value: String(si.info.execs || 0); tone: Theme.violet }
                Metric { label: "Errors"; value: String(si.info.errors || 0); tone: (si.info.errors || 0) > 0 ? Theme.alert : Theme.textPrimary }
                Metric { label: "Test runs"; value: (si.info.testRuns || 0) + ((si.info.testFailures || 0) > 0 ? " / " + si.info.testFailures + " failed" : ""); qualifier: "inferred from commands" }
                Metric { label: "Permissions"; value: String(si.info.permissionRequests || 0); tone: Theme.amber }
            }

            // ---------------------------------------------------------------- context (reported values only)
            Section {
                title: "Context window"
                trailing: si.ctx.available ? "reported · " + si.ctx.source : "unavailable"
                Column {
                    visible: si.ctx.available === true
                    width: parent.width
                    spacing: 8
                    Item {
                        visible: (si.ctx.usedPercentage || -1) >= 0
                        width: parent.width; height: 8
                        Rectangle { anchors.fill: parent; color: Theme.alpha(Theme.ice, 0.08) }
                        Rectangle {
                            height: parent.height
                            width: parent.width * Math.min(1, (si.ctx.usedPercentage || 0) / 100)
                            color: (si.ctx.usedPercentage || 0) > 80 ? Theme.amber : Theme.cyan
                            Behavior on width { NumberAnimation { duration: 400 } }
                        }
                    }
                    Grid {
                        columns: 3
                        columnSpacing: 14
                        rowSpacing: 10
                        width: parent.width
                        Metric { visible: (si.ctx.usedPercentage || -1) >= 0; label: "Used"; value: (si.ctx.usedPercentage || 0).toFixed(0); unit: "%" }
                        Metric { label: "Input tokens"; value: String(si.ctx.inputTokens || 0) }
                        Metric { label: "Output tokens"; value: String(si.ctx.outputTokens || 0) }
                        Metric { label: "Cache read"; value: String(si.ctx.cacheReadTokens || 0) }
                        Metric { visible: (si.ctx.costUsd || -1) >= 0; label: "Cost"; value: "$" + (si.ctx.costUsd || 0).toFixed(3); qualifier: "client estimate" }
                        Metric { visible: (si.ctx.rate5h || -1) >= 0; label: "5h limit"; value: (si.ctx.rate5h || 0).toFixed(0); unit: "%" }
                    }
                }
                Label {
                    visible: si.ctx.available !== true
                    width: parent.width
                    wrapMode: Text.WordWrap
                    elide: Text.ElideNone
                    color: Theme.textTertiary
                    font.pixelSize: 11
                    text: "Not reported for this session. Enable the NEXUS status-line relay in Setup, or start the session from the Command Centre, to receive real context and token figures."
                }
            }

            Section {
                title: "Model"
                Label { text: si.info.model || "not reported"; mono: true; font.pixelSize: 11; color: Theme.ice }
                Label { visible: (si.info.permissionMode || "").length > 0; text: "Permission mode: " + si.info.permissionMode; font.pixelSize: 11; color: Theme.textSecondary }
                Label { visible: (si.info.cwd || "").length > 0; width: parent.width; text: si.info.cwd || ""; mono: true; font.pixelSize: 10; color: Theme.textTertiary; elide: Text.ElideLeft }
                Label { visible: (si.info.pid || 0) > 0; text: "Claude Code pid " + si.info.pid + (si.info.alive ? "" : " (exited)"); mono: true; font.pixelSize: 10; color: Theme.textTertiary }
            }

            Section {
                title: "Tools used"
                visible: (si.info.toolsUsed || []).length > 0
                Repeater {
                    model: (si.info.toolsUsed || []).slice(0, 10)
                    Item {
                        width: parent.width; height: 16
                        readonly property real frac: modelData.count / Math.max(1, si.info.toolsUsed[0].count)
                        Label { width: 110; text: modelData.name; mono: true; font.pixelSize: 11; color: Theme.textSecondary; anchors.verticalCenter: parent.verticalCenter }
                        Rectangle { x: 114; width: (parent.width - 150) * parent.frac; height: 3; anchors.verticalCenter: parent.verticalCenter; color: Theme.alpha(Theme.cyan, 0.3 + 0.6 * parent.frac) }
                        Label { anchors.right: parent.right; text: modelData.count; mono: true; font.pixelSize: 11; color: Theme.textTertiary; anchors.verticalCenter: parent.verticalCenter }
                    }
                }
            }

            Section {
                title: "Files touched"
                trailing: si.files.length
                visible: si.files.length > 0
                Repeater {
                    model: si.files.slice(0, 16)
                    Item {
                        width: parent.width; height: 20
                        Label { width: parent.width - 70; text: modelData.name; mono: true; font.pixelSize: 11; anchors.verticalCenter: parent.verticalCenter }
                        Label { anchors.right: parent.right; anchors.verticalCenter: parent.verticalCenter; mono: true; font.pixelSize: 10
                                text: (modelData.writes > 0 ? "W" + modelData.writes + " " : "") + (modelData.reads > 0 ? "R" + modelData.reads : "")
                                color: modelData.writes > 0 ? Theme.cyan : Theme.ice }
                    }
                }
            }

            Section {
                title: "Recent commands"
                visible: (si.info.commands || []).length > 0
                Repeater {
                    model: si.info.commands || []
                    Label { width: parent.width; text: "$ " + modelData; mono: true; font.pixelSize: 11; color: Theme.violet }
                }
            }

            Section {
                title: "Milestones"
                visible: (si.info.milestones || []).length > 0
                Repeater {
                    model: si.info.milestones || []
                    Item {
                        width: parent.width; height: 22
                        Rectangle { width: 6; height: 6; rotation: 45; x: 2; anchors.verticalCenter: parent.verticalCenter
                                    color: modelData.kind === "failure" ? Theme.alert : modelData.kind === "prompt" ? Theme.glacier : modelData.kind === "turn" ? Theme.cyan : Theme.violet }
                        Label { x: 16; width: parent.width - 86; text: modelData.label || modelData.kind; font.pixelSize: 11; anchors.verticalCenter: parent.verticalCenter }
                        Label { anchors.right: parent.right; text: nexus.formatTime(modelData.ts); mono: true; font.pixelSize: 10; color: Theme.textTertiary; anchors.verticalCenter: parent.verticalCenter }
                        MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: if (modelData.event >= 0) Ui.select("event", "", modelData.event) }
                    }
                }
            }

            Section {
                title: "Last response"
                visible: (si.info.lastMessage || "").length > 0
                Label { width: parent.width; text: si.info.lastMessage || ""; wrapMode: Text.WordWrap; elide: Text.ElideNone; maximumLineCount: 12; color: Theme.textSecondary; font.pixelSize: 11 }
            }

            Row {
                spacing: 8
                NxButton { text: "Filter activity"; icon: "observatory"; onClicked: { nexus.sessions.events.sessionFilter = si.sessionId; Ui.dockTab = "stream"; Ui.dockOpen = true } }
                NxButton {
                    visible: (si.info.pid || 0) > 0 && si.info.alive && !si.info.simulated && si.info.state !== "ended"
                    text: "Interrupt"
                    icon: "stop"
                    variant: "danger"
                    onClicked: Ui.confirm({
                        title: "Interrupt this Claude Code session?",
                        body: "NEXUS will send SIGINT to the Claude Code process that reported these events. The effect is the same as pressing Ctrl+C in its terminal; it may cancel the current operation.",
                        detail: "kill -INT " + si.info.pid,
                        danger: true,
                        confirmText: "Send interrupt"
                    }, function() {
                        const r = nexus.integration.interruptSession(si.sessionId)
                        Ui.toast(r.ok ? "info" : "error", "Interrupt", r.message)
                    })
                }
            }
        }
    }
}
