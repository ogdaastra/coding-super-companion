import QtQuick
import Nexus

Text {
    property bool mono: false
    property bool tabular: true
    color: Theme.textPrimary
    font.family: mono ? Theme.fontMono : Theme.fontUi
    font.pixelSize: mono ? Theme.sizeData : Theme.sizeBody
    font.features: tabular ? { "tnum": 1 } : {}
    renderType: Text.NativeRendering
    elide: Text.ElideRight
    textFormat: Text.PlainText
}
