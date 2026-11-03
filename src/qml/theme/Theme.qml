pragma Singleton
import QtQuick

// NEXUS design tokens. See docs/DESIGN_SYSTEM.md.
QtObject {
    // ---------------------------------------------------------------- colour
    readonly property color void_: "#02040a"
    readonly property color abyss: "#050912"
    readonly property color midnight: "#0a1328"
    readonly property color graphite: "#0e141d"
    readonly property color graphiteRaised: "#141b26"
    readonly property color graphiteHigh: "#1b2431"
    readonly property color steel: "#263142"
    readonly property color hairline: Qt.rgba(0.55, 0.75, 1.0, 0.10)
    readonly property color hairlineStrong: Qt.rgba(0.55, 0.75, 1.0, 0.18)

    readonly property color cyan: "#3fd4ff"
    readonly property color ice: "#9be7ff"
    readonly property color glacier: "#ddf6ff"
    readonly property color violet: "#9a86ff"
    readonly property color indigo: "#5664d9"
    readonly property color amber: "#ffb547"
    readonly property color alert: "#ff4d5e"
    readonly property color aurora: "#4fe3c1"
    readonly property color webBlue: "#6fb7ff"
    readonly property color teal: "#5ee1e6"

    readonly property color textPrimary: "#e6f1ff"
    readonly property color textSecondary: "#9db0c8"
    readonly property color textTertiary: "#62738b"
    readonly property color textFaint: "#3a4659"

    function alpha(c, a) { return Qt.rgba(c.r, c.g, c.b, a) }

    function categoryColor(cat) {
        switch (cat) {
        case "read": return ice
        case "write": return cyan
        case "search": return "#6e7cff"
        case "exec": return violet
        case "web": return webBlue
        case "agent": return "#cf8cff"
        case "mcp": return teal
        case "task": return "#8ca0be"
        default: return textTertiary
        }
    }

    function stateColor(state) {
        switch (state) {
        case "running": return cyan
        case "executing": return ice
        case "permission": return amber
        case "awaiting": return amber
        case "completed": return glacier
        case "failed": return alert
        case "ended": return textTertiary
        case "stale": return textFaint
        default: return textSecondary
        }
    }

    function changeColor(change) {
        switch (change) {
        case "modified": return cyan
        case "renamed": return cyan
        case "added": return aurora
        case "deleted": return alert
        case "untracked": return ice
        case "conflict": return amber
        default: return textTertiary
        }
    }

    // ---------------------------------------------------------------- type
    readonly property string fontUi: "Inter"
    readonly property string fontDisplay: "Inter Display"
    readonly property string fontMono: "JetBrains Mono"

    readonly property int sizeDisplay: 34
    readonly property int sizeTitle: 17
    readonly property int sizeHeading: 13
    readonly property int sizeBody: 12
    readonly property int sizeCaption: 11
    readonly property int sizeMicro: 9
    readonly property int sizeData: 11
    readonly property int sizeMetric: 20

    // ---------------------------------------------------------------- space & shape
    readonly property int s1: 4
    readonly property int s2: 8
    readonly property int s3: 12
    readonly property int s4: 16
    readonly property int s5: 20
    readonly property int s6: 24
    readonly property int s8: 32
    readonly property int chamferPanel: 10
    readonly property int chamferControl: 4
    readonly property int topBarHeight: 52
    readonly property int railWidth: 60

    // ---------------------------------------------------------------- motion
    readonly property int micro: 120
    readonly property int standard: 240
    readonly property int emphasis: 420
    readonly property var curveOut: [0.16, 1.0, 0.3, 1.0, 1, 1]
    readonly property var curveInOut: [0.65, 0.0, 0.35, 1.0, 1, 1]
}
