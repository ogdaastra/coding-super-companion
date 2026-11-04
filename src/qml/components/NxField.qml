import QtQuick
import Nexus

// Single-line text input with chamfered frame.
Item {
    id: f
    property alias text: input.text
    property string placeholder: ""
    property string icon: ""
    property bool mono: false
    property alias input: input
    signal accepted()
    implicitHeight: 32
    implicitWidth: 200

    Chamfer {
        anchors.fill: parent
        cut: 5
        fill: Theme.alpha(Theme.void_, 0.55)
        stroke: input.activeFocus ? Theme.alpha(Theme.cyan, 0.6) : Theme.hairlineStrong
    }
    Icon {
        id: ico
        visible: f.icon.length > 0
        name: f.icon
        size: 15
        anchors.left: parent.left
        anchors.leftMargin: 9
        anchors.verticalCenter: parent.verticalCenter
        color: input.activeFocus ? Theme.cyan : Theme.textTertiary
    }
    TextInput {
        id: input
        anchors.fill: parent
        anchors.leftMargin: f.icon.length ? 31 : 10
        anchors.rightMargin: 10
        verticalAlignment: TextInput.AlignVCenter
        color: Theme.textPrimary
        selectionColor: Theme.alpha(Theme.cyan, 0.4)
        selectedTextColor: Theme.glacier
        font.family: f.mono ? Theme.fontMono : Theme.fontUi
        font.pixelSize: Theme.sizeBody
        clip: true
        selectByMouse: true
        onAccepted: f.accepted()
        Label {
            anchors.verticalCenter: parent.verticalCenter
            visible: !input.text.length && !input.activeFocus
            text: f.placeholder
            color: Theme.textFaint
            font.pixelSize: Theme.sizeBody
        }
    }
}
