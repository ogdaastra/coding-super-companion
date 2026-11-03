import QtQuick
import Nexus

// Chamfered button. Variants: "ghost" (default), "primary", "danger", "quiet".
Item {
    id: btn
    property string text: ""
    property string icon: ""
    property string variant: "ghost"
    property bool enabled_: true
    property bool checked: false
    property string tooltip: ""
    signal clicked()
    implicitHeight: 30
    implicitWidth: row.implicitWidth + (text.length ? 26 : 16)
    opacity: enabled_ ? 1 : 0.38

    readonly property color accent: variant === "danger" ? Theme.alert : (variant === "primary" ? Theme.cyan : Theme.ice)

    Chamfer {
        anchors.fill: parent
        cut: 5
        fill: btn.variant === "primary" ? Theme.alpha(Theme.cyan, mouse.pressed ? 0.30 : (mouse.containsMouse ? 0.22 : 0.15))
            : btn.variant === "danger" ? Theme.alpha(Theme.alert, mouse.containsMouse ? 0.20 : 0.10)
            : btn.checked ? Theme.alpha(Theme.cyan, 0.14)
            : Theme.alpha(Theme.ice, mouse.pressed ? 0.12 : (mouse.containsMouse ? 0.07 : (btn.variant === "quiet" ? 0.0 : 0.03)))
        stroke: btn.variant === "quiet" && !mouse.containsMouse ? "transparent"
              : Theme.alpha(btn.accent, mouse.containsMouse || btn.checked ? 0.55 : 0.22)
        Behavior on fill { ColorAnimation { duration: Theme.micro } }
    }

    Row {
        id: row
        anchors.centerIn: parent
        spacing: 7
        Icon {
            visible: btn.icon.length > 0
            name: btn.icon
            size: 16
            anchors.verticalCenter: parent.verticalCenter
            color: btn.variant === "primary" ? Theme.glacier : (btn.variant === "danger" ? Theme.alert : (btn.checked ? Theme.cyan : Theme.textSecondary))
        }
        Label {
            visible: btn.text.length > 0
            text: btn.text
            anchors.verticalCenter: parent.verticalCenter
            font.pixelSize: Theme.sizeCaption
            font.weight: Font.Medium
            font.letterSpacing: 0.3
            color: btn.variant === "primary" ? Theme.glacier : (btn.variant === "danger" ? "#ffc6cc" : (btn.checked ? Theme.cyan : Theme.textPrimary))
        }
    }

    MouseArea {
        id: mouse
        anchors.fill: parent
        hoverEnabled: true
        enabled: btn.enabled_
        cursorShape: Qt.PointingHandCursor
        onClicked: btn.clicked()
    }

    ToolTipNx { target: mouse; text: btn.tooltip }
}
