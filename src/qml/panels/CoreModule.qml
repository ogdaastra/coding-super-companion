import QtQuick
import QtQuick.Dialogs
import Nexus

Item {
    id: core
    property var viewport

    Column {
        id: top
        width: parent.width
        spacing: 14

        // ------------------------------------------------------------ agents
        Item {
            width: parent.width
            height: 16
            Micro { text: "Agents"; anchors.verticalCenter: parent.verticalCenter }
            Micro {
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
                text: nexus.sessions.liveSessionCount + " live  ·  " + nexus.sessions.sessionCount + " total"
                color: Theme.textFaint
            }
        }
    }

    ListView {
        id: sessionList
        anchors.top: top.bottom
        anchors.topMargin: 6
        width: parent.width
        height: Math.min(contentHeight, Math.max(120, (parent.height - top.height) * 0.42))
        clip: true
        model: nexus.sessions.sessions
        spacing: 2
        boundsBehavior: Flickable.StopAtBounds
        delegate: SessionRow {}
    }

    // empty state: explain what is missing and the one action that fixes it
    Column {
        visible: nexus.sessions.sessionCount === 0
        anchors.top: top.bottom
        anchors.topMargin: 10
        width: parent.width
        spacing: 10
        Label {
            width: parent.width
            wrapMode: Text.WordWrap
            elide: Text.ElideNone
            color: Theme.textSecondary
            text: nexus.integration.userHooks.eventCount > 0
                  ? "Hooks are installed. Start Claude Code in any project and its sessions will appear here."
                  : "No agent telemetry yet. Connect Claude Code so NEXUS can observe sessions through hooks."
            lineHeight: 1.25
        }
        Flow {
            width: parent.width
            spacing: 8
            NxButton { text: nexus.integration.userHooks.eventCount > 0 ? "Setup" : "Connect Claude Code"; icon: "hook"; variant: "primary"; onClicked: Ui.module = "setup" }
            NxButton { text: "Run simulation"; icon: "sim"; enabled_: nexus.project.hasProject; tooltip: "Clearly-labelled synthetic events for exploring NEXUS"; onClicked: nexus.integration.startSimulation(2) }
        }
    }

    // ------------------------------------------------------------ project overview
    Column {
        id: proj
        anchors.top: nexus.sessions.sessionCount === 0 ? undefined : sessionList.bottom
        anchors.bottom: nexus.sessions.sessionCount === 0 ? parent.bottom : undefined
        anchors.topMargin: 18
        width: parent.width
        spacing: 12

        Section {
            title: "Project"
            trailing: nexus.project.isGitRepo ? "git" : (nexus.project.hasProject ? "no git" : "")
            Label {
                width: parent.width
                visible: nexus.project.hasProject
                text: nexus.project.projectRoot
                mono: true
                font.pixelSize: 10
                color: Theme.textTertiary
                elide: Text.ElideLeft
            }
            Grid {
                visible: nexus.project.hasProject
                columns: 3
                columnSpacing: 18
                rowSpacing: 10
                width: parent.width
                Metric { label: "Files"; value: String(nexus.project.fileCount) }
                Metric { label: "Dependencies"; value: String(nexus.project.dependencyCount) }
                Metric { label: "Symbols"; value: String(nexus.project.symbolCount) }
                Metric { label: "Directories"; value: String(nexus.project.dirCount) }
                Metric { label: "Changed"; value: String(nexus.project.changedCount); tone: nexus.project.changedCount > 0 ? Theme.cyan : Theme.textPrimary }
                Metric { label: "Indexed in"; value: String(nexus.project.indexMs); unit: "ms" }
            }
            Label {
                visible: !nexus.project.hasProject
                text: "Open a project to map its structure into the universe around the core. NEXUS indexes it locally; nothing leaves this machine."
                color: Theme.textTertiary
                wrapMode: Text.WordWrap
                elide: Text.ElideNone
                width: parent.width
            }
            NxButton {
                visible: !nexus.project.hasProject
                text: "Open project…"
                icon: "folder"
                variant: "primary"
                onClicked: openDialog.open()
            }
        }

        Section {
            title: "Languages"
            visible: nexus.project.languages.length > 0
            Repeater {
                model: nexus.project.languages.slice(0, 6)
                Item {
                    width: parent.width
                    height: 18
                    readonly property real frac: modelData.count / Math.max(1, nexus.project.languages[0].count)
                    Label { width: 90; text: modelData.name; font.pixelSize: 11; color: Theme.textSecondary; anchors.verticalCenter: parent.verticalCenter }
                    Rectangle {
                        x: 96; anchors.verticalCenter: parent.verticalCenter
                        width: (parent.width - 140) * parent.frac
                        height: 3
                        color: Theme.alpha(Theme.cyan, 0.25 + 0.6 * parent.frac)
                    }
                    Label { anchors.right: parent.right; text: modelData.count; mono: true; font.pixelSize: 11; color: Theme.textTertiary; anchors.verticalCenter: parent.verticalCenter }
                }
            }
        }

        Row {
            spacing: 8
            visible: nexus.sessions.sessionCount > 0
            NxButton {
                text: nexus.integration.simulationRunning ? "Stop simulation" : "Simulate"
                icon: "sim"
                enabled_: nexus.project.hasProject
                onClicked: nexus.integration.simulationRunning ? nexus.integration.stopSimulation() : nexus.integration.startSimulation(2)
            }
            NxButton {
                visible: nexus.sessions.hasSimulated && !nexus.integration.simulationRunning
                text: "Clear simulated"
                icon: "trash"
                onClicked: nexus.integration.clearSimulated()
            }
        }
    }

    FolderDialog {
        id: openDialog
        title: "Choose a project folder"
        onAccepted: nexus.openProject(selectedFolder.toString())
    }
}
