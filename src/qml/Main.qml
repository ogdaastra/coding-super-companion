import QtQuick
import QtQuick.Window
import Nexus

Window {
    id: root
    width: 1600
    height: 960
    visible: false
    color: "#02040a"
    title: "NEXUS"

    NexusViewport {
        id: viewport
        anchors.fill: parent
    }

    Text {
        anchors.left: parent.left
        anchors.bottom: parent.bottom
        anchors.margins: 16
        color: "#9db0c8"
        font.family: "JetBrains Mono"
        font.pixelSize: 11
        text: viewport.backend + "  " + viewport.fps.toFixed(1) + " fps  " + viewport.frameMs.toFixed(2)
              + " ms  gpu " + (viewport.gpuMs >= 0 ? viewport.gpuMs.toFixed(2) + " ms" : "n/a")
              + "  nodes " + viewport.nodeCount + "  edges " + viewport.edgeCount
              + "  particles " + viewport.particleCapacity + (viewport.computeParticles ? " (compute)" : " (cpu)")
              + "  msaa " + viewport.msaa + "x  " + viewport.targetSize
    }
}
