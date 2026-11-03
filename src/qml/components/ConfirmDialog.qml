import QtQuick
import Nexus

// Modal confirmation for consequential actions. Shows exactly what will happen.
Item {
    id: dlg
    anchors.fill: parent
    visible: opacity > 0
    opacity: open ? 1 : 0
    z: 900
    property bool open: false
    property var opts: ({})
    property var callback: null
    Behavior on opacity { NumberAnimation { duration: Theme.standard; easing.type: Easing.OutCubic } }

    function ask(o, cb) {
        opts = o
        callback = cb
        open = true
        confirmBtn.forceActiveFocus()
    }
    function close() { open = false; callback = null }

    Rectangle { anchors.fill: parent; color: Theme.alpha(Theme.void_, 0.62) }
    MouseArea { anchors.fill: parent; onClicked: dlg.close() }

    Glass {
        id: pane
        width: Math.min(560, parent.width - 80)
        height: body.implicitHeight + 40
        anchors.centerIn: parent
        anchors.verticalCenterOffset: dlg.open ? 0 : 14
        Behavior on anchors.verticalCenterOffset { NumberAnimation { duration: Theme.emphasis; easing.type: Easing.OutCubic } }
        fill: 0.97
        ticks: true
        accent: dlg.opts.danger ? Theme.alert : Theme.cyan
        accentMix: 0.5
        MouseArea { anchors.fill: parent }

        Column {
            id: body
            anchors.fill: parent
            anchors.margins: 20
            spacing: 12
            Row {
                spacing: 10
                Icon { name: dlg.opts.danger ? "alert" : "shield"; color: dlg.opts.danger ? Theme.alert : Theme.cyan; size: 20 }
                Label {
                    text: dlg.opts.title || ""
                    font.pixelSize: Theme.sizeTitle
                    font.weight: Font.DemiBold
                    anchors.verticalCenter: parent.verticalCenter
                }
            }
            Label {
                width: parent.width
                text: dlg.opts.body || ""
                wrapMode: Text.WordWrap
                elide: Text.ElideNone
                color: Theme.textSecondary
                lineHeight: 1.25
            }
            Rectangle {
                visible: (dlg.opts.detail || "").length > 0
                width: parent.width
                height: detail.implicitHeight + 16
                color: Theme.alpha(Theme.void_, 0.6)
                border.color: Theme.hairline
                Label {
                    id: detail
                    x: 8; y: 8
                    width: parent.width - 16
                    mono: true
                    text: dlg.opts.detail || ""
                    wrapMode: Text.WrapAnywhere
                    elide: Text.ElideNone
                    color: Theme.ice
                    font.pixelSize: 11
                }
            }
            Item { width: 1; height: 4 }
            Row {
                anchors.right: parent.right
                spacing: 10
                NxButton { text: "Cancel"; onClicked: dlg.close() }
                NxButton {
                    id: confirmBtn
                    text: dlg.opts.confirmText || "Confirm"
                    variant: dlg.opts.danger ? "danger" : "primary"
                    onClicked: {
                        const cb = dlg.callback
                        dlg.close()
                        if (cb) cb()
                    }
                }
            }
        }
    }
    Keys.onEscapePressed: close()
}
