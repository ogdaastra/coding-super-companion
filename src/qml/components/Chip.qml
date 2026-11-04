import QtQuick
import Nexus

// Small status chip: chamfered, tinted by `tone`.
Item {
    id: chip
    property string text: ""
    property color tone: Theme.textSecondary
    property bool filled: false
    property bool mono: false
    property bool striped: false   // simulated data
    implicitWidth: label.implicitWidth + 14
    implicitHeight: 18

    Chamfer {
        anchors.fill: parent
        cut: 3
        fill: Theme.alpha(chip.tone, chip.filled ? 0.22 : 0.08)
        stroke: Theme.alpha(chip.tone, 0.45)
    }
    Item {
        anchors.fill: parent
        anchors.margins: 1
        clip: true
        visible: chip.striped
        Repeater {
            model: Math.ceil(chip.width / 6) + 4
            Rectangle {
                x: index * 6 - chip.height
                y: -2
                width: 2.2
                height: chip.height * 1.8
                rotation: 45
                color: Theme.alpha(chip.tone, 0.16)
            }
        }
    }
    Label {
        id: label
        anchors.centerIn: parent
        text: chip.text
        mono: chip.mono
        color: Qt.lighter(chip.tone, 1.15)
        font.pixelSize: 10
        font.weight: Font.DemiBold
        font.letterSpacing: chip.mono ? 0 : 1.0
        font.capitalization: chip.mono ? Font.MixedCase : Font.AllUppercase
    }
}
