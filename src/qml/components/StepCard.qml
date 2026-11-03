import QtQuick
import Nexus

// Numbered step for the setup wizard.
Item {
    id: step
    property string number: "1"
    property string title: ""
    property bool done: false
    default property alias content: body.data
    implicitHeight: body.implicitHeight + 46

    Chamfer {
        anchors.fill: parent
        cut: 8
        fill: Theme.alpha(step.done ? Theme.aurora : Theme.ice, 0.025)
        stroke: step.done ? Theme.alpha(Theme.aurora, 0.35) : Theme.hairline
    }
    Item {
        x: 14; y: 14
        width: 22; height: 22
        Chamfer { anchors.fill: parent; cut: 4; fill: step.done ? Theme.alpha(Theme.aurora, 0.25) : Theme.alpha(Theme.cyan, 0.10); stroke: step.done ? Theme.aurora : Theme.alpha(Theme.cyan, 0.5) }
        Label { anchors.centerIn: parent; visible: !step.done; text: step.number; font.pixelSize: 11; font.weight: Font.Bold; color: Theme.cyan }
        Icon { anchors.centerIn: parent; visible: step.done; name: "check"; size: 14; color: Theme.aurora }
    }
    Label { x: 46; y: 16; text: step.title; font.pixelSize: 14; font.weight: Font.DemiBold }
    Column {
        id: body
        x: 46; y: 40
        width: step.width - 62
        spacing: 8
    }
}
