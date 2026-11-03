import QtQuick
import Nexus

// Telemetry pipeline and renderer health. Every value is measured.
Item {
    Row {
        anchors.fill: parent
        spacing: 36
        Column {
            spacing: 10
            Micro { text: "Telemetry" }
            Grid {
                columns: 3
                columnSpacing: 22
                rowSpacing: 10
                Metric { label: "Socket"; value: nexus.integration.telemetryListening ? "listening" : "down"; tone: nexus.integration.telemetryListening ? Theme.aurora : Theme.alert }
                Metric { label: "Received"; value: String(nexus.integration.received) }
                Metric { label: "Rejected (token)"; value: String(nexus.integration.rejected); tone: nexus.integration.rejected > 0 ? Theme.amber : Theme.textPrimary }
                Metric { label: "Recovered from spool"; value: String(nexus.integration.recovered) }
                Metric { label: "Malformed"; value: String(nexus.integration.malformed) }
                Metric { label: "Rate"; value: nexus.sessions.eventRate.toFixed(2); unit: "/s" }
            }
            Label { text: nexus.integration.socketPath; mono: true; font.pixelSize: 10; color: Theme.textFaint }
        }
        Column {
            spacing: 10
            Micro { text: "Store" }
            Grid {
                columns: 2
                columnSpacing: 22
                rowSpacing: 10
                Metric { label: "Events stored"; value: String(nexus.integration.storedEvents) }
                Metric { label: "In memory"; value: String(nexus.sessions.eventCount) }
            }
            Label { width: 300; text: nexus.integration.storeStatus; mono: true; font.pixelSize: 10; color: Theme.textFaint; elide: Text.ElideLeft }
        }
        Column {
            spacing: 10
            Micro { text: "Renderer" }
            Grid {
                columns: 3
                columnSpacing: 22
                rowSpacing: 10
                Metric { label: "Backend"; value: Backdrop.viewport ? Backdrop.viewport.backend : "—" }
                Metric { label: "Frame"; value: Backdrop.viewport ? Backdrop.viewport.frameMs.toFixed(2) : "—"; unit: "ms" }
                Metric { label: "GPU"; value: Backdrop.viewport && Backdrop.viewport.gpuMs >= 0 ? Backdrop.viewport.gpuMs.toFixed(2) : "n/a"; unit: Backdrop.viewport && Backdrop.viewport.gpuMs >= 0 ? "ms" : "" }
                Metric { label: "Record (CPU)"; value: Backdrop.viewport ? Backdrop.viewport.renderMs.toFixed(2) : "—"; unit: "ms" }
                Metric { label: "Target"; value: Backdrop.viewport ? Backdrop.viewport.targetSize : "—" }
                Metric { label: "Particles"; value: Backdrop.viewport ? (Backdrop.viewport.computeParticles ? "GPU compute" : "CPU") : "—" }
            }
        }
    }
}
