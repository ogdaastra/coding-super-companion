import QtQuick
import Nexus

// Uppercase micro label with wide tracking.
Text {
    color: Theme.textTertiary
    font.family: Theme.fontUi
    font.pixelSize: Theme.sizeMicro
    font.weight: Font.DemiBold
    font.letterSpacing: 1.3
    font.capitalization: Font.AllUppercase
    renderType: Text.NativeRendering
    elide: Text.ElideRight
}
