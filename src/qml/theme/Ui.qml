pragma Singleton
import QtQuick

// Global UI state: active module, current selection, and access to shared hosts
// (confirmation dialog, toasts, palette). Kept deliberately small.
QtObject {
    id: ui
    // modules: core | universe | observatory | changes | command | agents | atlas | setup
    property string module: "core"
    // selection: { type: "node"|"session"|"event"|"change", key: string, index: int }
    property var selection: ({ type: "", key: "", index: -1 })
    property bool inspectorPinned: false
    property bool dockOpen: true
    property string dockTab: "timeline"
    property bool cinematic: false
    property bool compact: false
    property var confirmHost: null
    property var toastHost: null
    property var paletteHost: null

    function select(type, key, index) {
        selection = { type: type, key: key || "", index: index === undefined ? -1 : index }
    }
    function clearSelection() { selection = { type: "", key: "", index: -1 } }

    // opts: { title, body, detail, confirmText, danger }
    function confirm(opts, onConfirm) {
        if (confirmHost) confirmHost.ask(opts, onConfirm)
    }
    function toast(level, title, body) {
        if (toastHost) toastHost.push(level, title, body || "")
    }
}
