import QtQuick
import Nexus

// Technical readout of the rendering and graph state. Every number here is measured.
Item {
    id: hud
    property var viewport
    width: row.implicitWidth
    height: 30

    Row {
        id: row
        spacing: 18
        anchors.bottom: parent.bottom

        Column {
            spacing: 2
            Micro { text: "Layout" }
            Label { text: nexus.project.layoutName + (nexus.project.layingOut ? "  …" : ""); font.pixelSize: 11; color: Theme.ice }
        }
        Column {
            spacing: 2
            Micro { text: "Graph" }
            Label {
                mono: true
                font.pixelSize: 11
                color: Theme.textSecondary
                text: nexus.project.fileCount + " files · " + nexus.project.dependencyCount + " deps · " + hud.viewport.nodeCount + " nodes · " + hud.viewport.edgeCount + " edges"
            }
        }
        Column {
            spacing: 2
            Micro { text: "Renderer" }
            Label {
                mono: true
                font.pixelSize: 11
                color: Theme.textSecondary
                text: hud.viewport.backend + " · " + hud.viewport.targetSize + " · " + hud.viewport.msaa + "× MSAA · "
                      + Math.round(hud.viewport.particleCapacity / 1000) + "k particles " + (hud.viewport.computeParticles ? "(compute)" : "(CPU)")
            }
        }
        Column {
            spacing: 2
            Micro { text: "Frame" }
            Label {
                mono: true
                font.pixelSize: 11
                color: hud.viewport.fps >= 55 ? Theme.aurora : (hud.viewport.fps >= 30 ? Theme.ice : Theme.amber)
                text: hud.viewport.fps.toFixed(1) + " fps · " + hud.viewport.frameMs.toFixed(1) + " ms"
                      + (hud.viewport.gpuMs >= 0 ? " · gpu " + hud.viewport.gpuMs.toFixed(1) + " ms" : "")
            }
        }
    }
}
