import QtQuick
import QtQuick.Dialogs
import Nexus

// Top command layer: identity, project, active agent, telemetry status, global commands.
Item {
    id: bar
    property var viewport
    height: Theme.topBarHeight

    readonly property var engine: nexus.sessions
    readonly property var integ: nexus.integration
    readonly property bool simulating: integ.simulationRunning
    readonly property bool hooked: integ.userHooks.eventCount > 0 || (integ.projectHooks.eventCount || 0) > 0
    readonly property string telemetry: simulating ? "SIM" : (!integ.telemetryListening ? "OFFLINE" : (hooked ? "LIVE" : "STANDBY"))

    // background: dark band with a lit bottom hairline
    Rectangle {
        anchors.fill: parent
        gradient: Gradient {
            GradientStop { position: 0; color: Theme.alpha(Theme.void_, 0.92) }
            GradientStop { position: 1; color: Theme.alpha(Theme.abyss, 0.72) }
        }
    }
    Rectangle {
        anchors.bottom: parent.bottom
        width: parent.width; height: 1
        gradient: Gradient {
            orientation: Gradient.Horizontal
            GradientStop { position: 0.0; color: Theme.alpha(Theme.cyan, 0.0) }
            GradientStop { position: 0.18; color: Theme.alpha(Theme.cyan, 0.35) }
            GradientStop { position: 0.5; color: Theme.alpha(Theme.ice, 0.12) }
            GradientStop { position: 1.0; color: Theme.alpha(Theme.cyan, 0.0) }
        }
    }

    // ---------------------------------------------------------------- identity
    Row {
        id: brand
        x: 18
        anchors.verticalCenter: parent.verticalCenter
        spacing: 12
        Item {
            width: 26; height: 26
            anchors.verticalCenter: parent.verticalCenter
            Icon { anchors.centerIn: parent; name: "core"; size: 24; color: Theme.cyan; stroke: 1.4 }
            Rectangle {
                anchors.centerIn: parent
                width: 6; height: 6; radius: 3
                color: Theme.glacier
                opacity: 0.4 + 0.6 * nexus.sessions.activity
                Behavior on opacity { NumberAnimation { duration: 600 } }
            }
        }
        Column {
            anchors.verticalCenter: parent.verticalCenter
            spacing: 0
            Label {
                text: "NEXUS"
                font.family: Theme.fontDisplay
                font.weight: Font.Light
                font.pixelSize: 19
                font.letterSpacing: 6.5
                color: Theme.glacier
            }
            Micro { text: "Agent command environment  ·  " + nexus.version; font.pixelSize: 8; font.letterSpacing: 1.6 }
        }
    }

    Rectangle { x: brand.x + brand.width + 20; width: 1; height: 24; anchors.verticalCenter: parent.verticalCenter; color: Theme.hairline }

    // ---------------------------------------------------------------- project
    Item {
        id: projectBtn
        x: brand.x + brand.width + 40
        anchors.verticalCenter: parent.verticalCenter
        width: projRow.implicitWidth + 20
        height: 34
        Chamfer {
            anchors.fill: parent
            cut: 5
            fill: Theme.alpha(Theme.ice, pm.containsMouse ? 0.06 : 0.0)
            stroke: pm.containsMouse ? Theme.hairlineStrong : "transparent"
        }
        Row {
            id: projRow
            anchors.verticalCenter: parent.verticalCenter
            x: 10
            spacing: 9
            Icon { name: "folder"; size: 16; color: Theme.ice; anchors.verticalCenter: parent.verticalCenter }
            Column {
                anchors.verticalCenter: parent.verticalCenter
                Label {
                    text: nexus.project.hasProject ? nexus.project.projectName : "Open a project"
                    font.pixelSize: 13
                    font.weight: Font.DemiBold
                }
                Label {
                    text: nexus.project.hasProject
                          ? (nexus.project.branch.length ? "⎇ " + nexus.project.branch + "  ·  " : "") + nexus.project.fileCount + " files  ·  " + nexus.project.changedCount + " changed"
                          : "No project loaded"
                    font.pixelSize: 10
                    color: Theme.textTertiary
                }
            }
            Icon { name: "chevronDown"; size: 12; color: Theme.textTertiary; anchors.verticalCenter: parent.verticalCenter }
        }
        MouseArea {
            id: pm
            anchors.fill: parent
            hoverEnabled: true
            cursorShape: Qt.PointingHandCursor
            onClicked: projectMenu.toggle()
        }
        ScanLine {
            anchors.bottom: parent.bottom
            width: parent.width
            visible: nexus.project.indexing || nexus.project.layingOut
            progress: nexus.project.indexing && nexus.project.indexTotal > 0 ? nexus.project.indexDone / nexus.project.indexTotal : -1
        }
    }

    // ---------------------------------------------------------------- active agent
    Item {
        id: agentBox
        x: Math.max(projectBtn.x + projectBtn.width + 24, (parent.width - width) / 2)
        anchors.verticalCenter: parent.verticalCenter
        width: Math.max(260, Math.min(520, rightCluster.x - (projectBtn.x + projectBtn.width + 24) - 24))
        height: 36
        readonly property var info: {
            nexus.sessions.revision   // re-evaluate on any session state change
            nexus.sessions.activeSession
            const id = nexus.sessions.primarySession()
            return id.length ? nexus.sessions.sessionInfo(id) : ({})
        }
        Chamfer {
            anchors.fill: parent
            cut: 6
            fill: Theme.alpha(Theme.void_, 0.45)
            stroke: agentBox.info.state === "permission" ? Theme.alpha(Theme.amber, 0.6) : Theme.hairline
        }
        Row {
            anchors.verticalCenter: parent.verticalCenter
            x: 12
            spacing: 10
            visible: agentBox.info.id !== undefined
            StateGlyph { state_: agentBox.info.state || "idle"; size: 20; anchors.verticalCenter: parent.verticalCenter }
            Column {
                anchors.verticalCenter: parent.verticalCenter
                width: agentBox.width - 170
                Label {
                    width: parent.width
                    text: agentBox.info.task || agentBox.info.title || ("Session " + (agentBox.info.id || "").substring(0, 8))
                    font.pixelSize: 12
                    font.weight: Font.Medium
                }
                Label {
                    width: parent.width
                    text: (agentBox.info.stateLabel || "") + (agentBox.info.runningTool ? "  ·  " + agentBox.info.runningTool : (agentBox.info.stateDetail ? "  ·  " + agentBox.info.stateDetail : ""))
                    font.pixelSize: 10
                    color: Theme.stateColor(agentBox.info.state || "idle")
                }
            }
        }
        Row {
            anchors.right: parent.right
            anchors.rightMargin: 12
            anchors.verticalCenter: parent.verticalCenter
            spacing: 8
            visible: agentBox.info.id !== undefined
            Chip { visible: agentBox.info.simulated === true; text: "Simulated"; tone: Theme.amber; striped: true; anchors.verticalCenter: parent.verticalCenter }
            Label {
                mono: true
                text: nexus.formatDuration(agentBox.info.elapsedMs || 0)
                color: Theme.textSecondary
                font.pixelSize: 11
                anchors.verticalCenter: parent.verticalCenter
            }
        }
        Row {
            anchors.centerIn: parent
            spacing: 8
            visible: agentBox.info.id === undefined
            Icon { name: "hook"; size: 15; color: Theme.textTertiary; anchors.verticalCenter: parent.verticalCenter }
            Label {
                text: bar.hooked || nexus.sessions.sessionCount > 0 ? "No live Claude Code sessions" + (nexus.sessions.lastEventTs > 0 ? "  ·  last activity " + nexus.formatAgo(nexus.sessions.lastEventTs) : "") : "Claude Code not connected — open Setup"
                color: Theme.textTertiary
                font.pixelSize: 12
                anchors.verticalCenter: parent.verticalCenter
            }
        }
        MouseArea {
            anchors.fill: parent
            cursorShape: Qt.PointingHandCursor
            onClicked: {
                if (agentBox.info.id !== undefined) { Ui.select("session", agentBox.info.id); nexus.sessions.activeSession = agentBox.info.id }
                else Ui.module = "setup"
            }
        }
    }

    // ---------------------------------------------------------------- right cluster
    Row {
        id: rightCluster
        anchors.right: parent.right
        anchors.rightMargin: 14
        anchors.verticalCenter: parent.verticalCenter
        spacing: 8

        Item {
            width: telRow.implicitWidth + 18
            height: 26
            anchors.verticalCenter: parent.verticalCenter
            readonly property color tone: bar.telemetry === "LIVE" ? Theme.aurora : bar.telemetry === "SIM" ? Theme.amber : bar.telemetry === "STANDBY" ? Theme.ice : Theme.alert
            Chamfer { anchors.fill: parent; cut: 4; fill: Theme.alpha(parent.tone, 0.08); stroke: Theme.alpha(parent.tone, 0.4) }
            Row {
                id: telRow
                anchors.centerIn: parent
                spacing: 7
                Rectangle {
                    width: 6; height: 6; radius: 3
                    anchors.verticalCenter: parent.verticalCenter
                    color: parent.parent.tone
                    SequentialAnimation on opacity {
                        running: bar.telemetry === "LIVE" || bar.telemetry === "SIM"
                        loops: Animation.Infinite
                        NumberAnimation { to: 0.3; duration: 800 }
                        NumberAnimation { to: 1.0; duration: 800 }
                    }
                }
                Label { text: bar.telemetry; font.pixelSize: 10; font.weight: Font.DemiBold; font.letterSpacing: 1.4; color: parent.parent.tone }
                Label { text: nexus.sessions.eventRate.toFixed(1) + "/s"; mono: true; font.pixelSize: 10; color: Theme.textTertiary }
            }
            MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: Ui.module = "setup" }
        }

        Item {
            width: 168; height: 30
            anchors.verticalCenter: parent.verticalCenter
            Chamfer { anchors.fill: parent; cut: 5; fill: Theme.alpha(Theme.void_, 0.5); stroke: sm.containsMouse ? Theme.hairlineStrong : Theme.hairline }
            Icon { name: "search"; size: 14; x: 10; anchors.verticalCenter: parent.verticalCenter; color: Theme.textTertiary }
            Label { x: 31; anchors.verticalCenter: parent.verticalCenter; text: "Search"; color: Theme.textFaint; font.pixelSize: 11 }
            Label { anchors.right: parent.right; anchors.rightMargin: 9; anchors.verticalCenter: parent.verticalCenter; text: "Ctrl K"; mono: true; color: Theme.textFaint; font.pixelSize: 10 }
            MouseArea { id: sm; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: Ui.paletteHost.show() }
        }

        IconButton { icon: "cinema"; tooltip: "Cinematic mode (C)"; checked: Ui.cinematic; onClicked: Ui.cinematic = !Ui.cinematic; anchors.verticalCenter: parent.verticalCenter }
        IconButton { icon: "fit"; tooltip: "Fullscreen (F11)"; onClicked: bar.Window.window.visibility = bar.Window.window.visibility === Window.FullScreen ? Window.Windowed : Window.FullScreen; anchors.verticalCenter: parent.verticalCenter }
    }

    // ---------------------------------------------------------------- project menu
    Item {
        id: projectMenu
        property bool open: false
        function toggle() { open = !open }
        x: projectBtn.x
        y: bar.height + 6
        width: 380
        height: menuCol.implicitHeight + 24
        visible: open
        z: 100
        Glass {
            anchors.fill: parent
            fill: 0.97
            ticks: true
            Column {
                id: menuCol
                x: 12; y: 12
                width: parent.width - 24
                spacing: 6
                Micro { text: "Recent projects" }
                Repeater {
                    model: nexus.recentProjects
                    delegate: Item {
                        width: menuCol.width; height: 30
                        Rectangle { anchors.fill: parent; color: rm.containsMouse ? Theme.alpha(Theme.cyan, 0.08) : "transparent" }
                        Icon { name: "folder"; size: 14; x: 6; anchors.verticalCenter: parent.verticalCenter; color: Theme.textTertiary }
                        Label { x: 28; width: parent.width - 34; anchors.verticalCenter: parent.verticalCenter; text: modelData; mono: true; font.pixelSize: 11; elide: Text.ElideMiddle }
                        MouseArea { id: rm; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: { nexus.openProject(modelData); projectMenu.open = false } }
                    }
                }
                Label { visible: nexus.recentProjects.length === 0; text: "No recent projects"; color: Theme.textTertiary; font.pixelSize: 11 }
                Rectangle { width: parent.width; height: 1; color: Theme.hairline }
                NxButton { text: "Open folder…"; icon: "folder"; onClicked: { folderDialog.open(); projectMenu.open = false } }
            }
        }
    }

    FolderDialog {
        id: folderDialog
        title: "Choose a project folder"
        onAccepted: nexus.openProject(selectedFolder.toString())
    }
}
