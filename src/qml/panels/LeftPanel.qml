import QtQuick
import Nexus

// Left navigation layer: content follows the active module.
Glass {
    id: lp
    property var viewport
    ticks: false

    readonly property var titles: ({
        core: ["NEXUS Core", "Agents and project overview"],
        universe: ["Project Universe", "Structure, layouts and search"],
        observatory: ["Agent Observatory", "Sessions, state and intelligence"],
        command: ["Command Centre", "Start and manage Claude Code sessions"],
        agents: ["Multi-Agent Network", "Concurrent sessions, shared files, conflicts"],
        atlas: ["Knowledge Atlas", "Instructions, documentation, bookmarks"]
    })

    Column {
        id: header
        x: 18; y: 16
        width: parent.width - 36
        spacing: 3
        Label {
            text: (lp.titles[Ui.module] || ["", ""])[0]
            font.pixelSize: Theme.sizeTitle
            font.weight: Font.DemiBold
            color: Theme.glacier
        }
        Label {
            text: (lp.titles[Ui.module] || ["", ""])[1]
            color: Theme.textTertiary
            font.pixelSize: Theme.sizeCaption
        }
    }
    Rectangle { x: 18; y: header.y + header.height + 12; width: parent.width - 36; height: 1; color: Theme.hairline }

    Loader {
        id: body
        x: 18
        y: header.y + header.height + 25
        width: parent.width - 36
        height: parent.height - y - 14
        sourceComponent: {
            switch (Ui.module) {
            case "universe": return universeC
            case "observatory": return observatoryC
            case "command": return commandC
            case "agents": return agentsC
            case "atlas": return atlasC
            default: return coreC
            }
        }
        opacity: status === Loader.Ready ? 1 : 0
        Behavior on opacity { NumberAnimation { duration: Theme.standard } }
    }

    Component { id: coreC; CoreModule { viewport: lp.viewport } }
    Component { id: universeC; UniverseModule { viewport: lp.viewport } }
    Component { id: observatoryC; ObservatoryModule {} }
    Component { id: commandC; CommandModule {} }
    Component { id: agentsC; AgentsModule { viewport: lp.viewport } }
    Component { id: atlasC; AtlasModule { viewport: lp.viewport } }
}
