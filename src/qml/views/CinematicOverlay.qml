import QtQuick
import Nexus

// Cinematic mode: chrome removed, a refined title card and a single live readout.
Item {
    id: cin
    opacity: visible ? 1 : 0
    Behavior on opacity { NumberAnimation { duration: 800 } }

    Column {
        x: 48
        anchors.bottom: parent.bottom
        anchors.bottomMargin: 54
        spacing: 6
        Micro { text: "NEXUS  ·  " + (nexus.sessions.liveSessionCount > 0 ? nexus.sessions.liveSessionCount + " live agent" + (nexus.sessions.liveSessionCount > 1 ? "s" : "") : "standing by"); color: Theme.ice; font.pixelSize: 10 }
        Label {
            text: nexus.project.hasProject ? nexus.project.projectName : "NEXUS"
            font.family: Theme.fontDisplay
            font.weight: Font.Light
            font.pixelSize: 44
            font.letterSpacing: 2
            color: Theme.glacier
        }
        Label {
            text: nexus.project.fileCount + " files  ·  " + nexus.project.dependencyCount + " dependencies  ·  " + nexus.sessions.eventCount + " events observed"
            color: Theme.textSecondary
            font.pixelSize: 12
        }
    }
    Label {
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        anchors.margins: 48
        text: "Press C or Esc to return"
        color: Theme.textFaint
        font.pixelSize: 11
    }
}
