import QtQuick
import Nexus

// Output of sessions started by NEXUS (stream-json assistant text and process output).
Item {
    id: op
    property string selectedKey: nexus.integration.launches.length ? nexus.integration.launches[0].key : ""
    property var lines: []
    function reload() { lines = selectedKey.length ? nexus.integration.launchOutput(selectedKey) : [] }
    onSelectedKeyChanged: reload()
    Component.onCompleted: reload()
    Connections {
        target: nexus.integration
        function onLaunchOutputAppended(key, line) { if (key === op.selectedKey) { op.lines = op.lines.concat([line]); if (out.atYEnd || true) out.positionViewAtEnd() } }
        function onLaunchesChanged() { if (!op.selectedKey.length && nexus.integration.launches.length) op.selectedKey = nexus.integration.launches[0].key }
    }

    ListView {
        id: launches
        width: 240
        height: parent.height
        clip: true
        model: nexus.integration.launches
        delegate: Item {
            width: launches.width; height: 40
            Rectangle { anchors.fill: parent; color: modelData.key === op.selectedKey ? Theme.alpha(Theme.cyan, 0.1) : (lm.containsMouse ? Theme.alpha(Theme.ice, 0.04) : "transparent") }
            Column {
                x: 8; width: parent.width - 16
                anchors.verticalCenter: parent.verticalCenter
                Label { width: parent.width; text: modelData.prompt || modelData.mode; font.pixelSize: 11 }
                Label { text: modelData.mode + "  ·  " + modelData.state + "  ·  " + nexus.formatAgo(modelData.started); font.pixelSize: 10; color: Theme.textTertiary }
            }
            MouseArea { id: lm; anchors.fill: parent; hoverEnabled: true; onClicked: op.selectedKey = modelData.key }
        }
        Label {
            visible: launches.count === 0
            width: parent.width
            wrapMode: Text.WordWrap
            text: "Sessions started from the Command Centre stream their output here."
            color: Theme.textTertiary
            font.pixelSize: 11
        }
    }
    Rectangle { x: 248; width: 1; height: parent.height; color: Theme.hairline }
    ListView {
        id: out
        x: 258
        width: parent.width - 258
        height: parent.height
        clip: true
        model: op.lines
        delegate: Label {
            width: out.width
            text: modelData
            mono: true
            font.pixelSize: 11
            wrapMode: Text.WrapAnywhere
            elide: Text.ElideNone
            color: modelData.startsWith("stderr") ? Theme.amber : (modelData.startsWith("assistant") ? Theme.textPrimary : Theme.textSecondary)
        }
    }
}
