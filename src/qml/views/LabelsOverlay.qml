import QtQuick
import Nexus

// Screen-space labels for projected 3D nodes. The pool size is fixed; delegates are
// created once and only their roles change (positions update ~30 Hz).
Item {
    id: overlay
    property var viewport
    clip: true

    Repeater {
        model: overlay.viewport ? overlay.viewport.labels : null
        delegate: Item {
            visible: shown
            x: lx - overlay.x
            y: ly - overlay.y
            opacity: labelOpacity
            Behavior on opacity { NumberAnimation { duration: 180 } }
            readonly property bool emphasized: kind === 3 || sub.length > 0

            // leader tick from the node to the label
            Rectangle {
                x: -6; y: 7
                width: 5; height: 1
                color: Theme.alpha(accent, 0.75)
            }
            Rectangle {
                visible: parent.emphasized
                x: -2; y: -2
                width: textItem.implicitWidth + (subItem.visible ? subItem.implicitWidth + 12 : 0) + 12
                height: 19
                color: Theme.alpha(Theme.void_, 0.62)
                border.color: Theme.alpha(accent, 0.35)
                border.width: 1
            }
            Text {
                id: textItem
                x: 4
                text: model.text
                color: kind === 2 ? accent : (kind === 3 ? Theme.glacier : (kind === 1 ? Theme.textPrimary : Theme.textSecondary))
                font.family: kind === 0 || kind === 3 ? Theme.fontMono : Theme.fontUi
                font.pixelSize: kind === 1 ? 11 : 10.5
                font.weight: kind === 1 || kind === 2 ? Font.DemiBold : Font.Normal
                font.letterSpacing: kind === 1 ? 0.6 : 0
                style: Text.Outline
                styleColor: Theme.alpha(Theme.void_, 0.75)
                renderType: Text.NativeRendering
            }
            Text {
                id: subItem
                visible: sub.length > 0
                x: textItem.x + textItem.implicitWidth + 8
                y: 2
                text: sub
                color: accent
                font.family: Theme.fontUi
                font.pixelSize: 9
                font.weight: Font.Bold
                font.letterSpacing: 1.2
                renderType: Text.NativeRendering
            }
        }
    }
}
