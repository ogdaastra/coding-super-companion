#!/usr/bin/env python3
"""NEXUS MCP server (stdio, standard library only).

Gives a Claude Code agent two capabilities that genuinely add value when NEXUS is
observing several sessions:

  nexus_milestone      Declare a milestone or plan step. It appears on the agent's own
                       timeline lane in NEXUS, labelled "declared" (self-reported) so it
                       is never confused with observed telemetry.
  nexus_shared_files   Ask which files *other* live sessions have recently written, so
                       the agent can avoid editing the same file concurrently.
  nexus_recent_activity  Read the most recent recorded tool activity in this project.

Milestones are forwarded through nexus-relay (spooled if NEXUS is not running). Queries
read NEXUS's local SQLite store read-only. Nothing leaves the machine.

Register with Claude Code, for example:
  claude mcp add nexus -- python3 /path/to/nexus_mcp.py --relay /path/to/nexus-relay
"""

import argparse
import json
import os
import sqlite3
import subprocess
import sys
import time

PROTOCOL_VERSION = "2025-06-18"
SERVER_INFO = {"name": "nexus", "version": "0.1.0"}


def default_data_dir():
    if sys.platform == "darwin":
        return os.path.expanduser("~/Library/Application Support/Nexus/NEXUS")
    if os.name == "nt":
        return os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "Nexus", "NEXUS")
    base = os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share")
    return os.path.join(base, "Nexus", "NEXUS")


TOOLS = [
    {
        "name": "nexus_milestone",
        "description": "Declare a milestone or plan step so the user can follow your progress on the NEXUS timeline. "
                       "Use for meaningful steps (e.g. 'Reproduced the failing test', 'Refactor complete').",
        "inputSchema": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Short milestone title (max 120 chars)."},
                "detail": {"type": "string", "description": "Optional one or two sentences of detail."},
            },
            "required": ["title"],
        },
    },
    {
        "name": "nexus_shared_files",
        "description": "List files that OTHER Claude Code sessions observed by NEXUS wrote recently, so you can avoid "
                       "conflicting edits. Returns path, session and time of the last write.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "minutes": {"type": "integer", "description": "Look-back window in minutes (default 120)."},
            },
        },
    },
    {
        "name": "nexus_recent_activity",
        "description": "Summarise the most recent tool activity NEXUS recorded for the current project.",
        "inputSchema": {
            "type": "object",
            "properties": {"limit": {"type": "integer", "description": "Number of events (default 20, max 100)."}},
        },
    },
]


class Server:
    def __init__(self, relay, data_dir):
        self.relay = relay
        self.data_dir = data_dir
        self.cwd = os.getcwd()

    # --------------------------------------------------------------- helpers
    def _db(self):
        path = os.path.join(self.data_dir, "events.db")
        if not os.path.exists(path):
            raise RuntimeError("NEXUS has not recorded any events yet (no store at %s)." % path)
        return sqlite3.connect("file:%s?mode=ro" % path, uri=True, timeout=2.0)

    def _send_to_relay(self, payload):
        if not self.relay or not os.path.exists(self.relay):
            raise RuntimeError("nexus-relay not found; pass --relay or set NEXUS_RELAY.")
        proc = subprocess.run([self.relay, "hook"], input=json.dumps(payload).encode("utf-8"),
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
        return proc.returncode == 0

    # --------------------------------------------------------------- tools
    def milestone(self, args):
        title = str(args.get("title", "")).strip()[:120]
        if not title:
            raise ValueError("title is required")
        detail = str(args.get("detail", "")).strip()[:600]
        # The session id is not exposed to MCP servers; NEXUS attributes the event to
        # the session whose Claude Code process is this server's parent (pid).
        payload = {"hook_event_name": "NexusMilestone", "title": title, "detail": detail,
                   "cwd": self.cwd, "claude_pid": os.getppid()}
        self._send_to_relay(payload)
        return "Milestone recorded in NEXUS: " + title

    def shared_files(self, args):
        minutes = max(1, min(int(args.get("minutes", 120) or 120), 24 * 60))
        since = int((time.time() - minutes * 60) * 1000)
        my_pid = os.getppid()
        with self._db() as db:
            rows = db.execute(
                "SELECT session_id, files, ts, payload FROM events WHERE kind = 'tool.post' AND category = 'write' "
                "AND simulated = 0 AND ts >= ? ORDER BY ts DESC LIMIT 2000", (since,)).fetchall()
        mine = set()
        latest = {}
        for session_id, files, ts, payload in rows:
            try:
                pid = json.loads(payload).get("claude_pid", 0)
            except (ValueError, TypeError):
                pid = 0
            for f in json.loads(files or "[]"):
                if not f.startswith(self.cwd):
                    continue
                if pid == my_pid:
                    mine.add(session_id)
                    continue
                if f not in latest:
                    latest[f] = (session_id, ts)
        others = {f: v for f, v in latest.items() if v[0] not in mine}
        if not others:
            return "No other observed session wrote files in this project in the last %d minutes." % minutes
        lines = ["Files written by other sessions in the last %d minutes:" % minutes]
        for f, (sid, ts) in sorted(others.items(), key=lambda kv: -kv[1][1])[:50]:
            ago = int((time.time() * 1000 - ts) / 60000)
            lines.append("- %s  (session %s, %d min ago)" % (os.path.relpath(f, self.cwd), (sid or "?")[:8], ago))
        return "\n".join(lines)

    def recent_activity(self, args):
        limit = max(1, min(int(args.get("limit", 20) or 20), 100))
        with self._db() as db:
            rows = db.execute("SELECT ts, session_id, kind, summary FROM events WHERE simulated = 0 "
                              "ORDER BY ts DESC LIMIT ?", (limit,)).fetchall()
        if not rows:
            return "No activity recorded yet."
        out = []
        for ts, sid, kind, summary in rows:
            out.append("%s  %s  %-14s %s" % (time.strftime("%H:%M:%S", time.localtime(ts / 1000)), (sid or "-")[:8], kind, summary))
        return "\n".join(out)

    # --------------------------------------------------------------- protocol
    def handle(self, msg):
        method = msg.get("method")
        mid = msg.get("id")
        if method == "initialize":
            return {"jsonrpc": "2.0", "id": mid, "result": {
                "protocolVersion": msg.get("params", {}).get("protocolVersion", PROTOCOL_VERSION),
                "capabilities": {"tools": {}}, "serverInfo": SERVER_INFO}}
        if method in ("notifications/initialized", "notifications/cancelled"):
            return None
        if method == "ping":
            return {"jsonrpc": "2.0", "id": mid, "result": {}}
        if method == "tools/list":
            return {"jsonrpc": "2.0", "id": mid, "result": {"tools": TOOLS}}
        if method == "tools/call":
            params = msg.get("params", {})
            name = params.get("name")
            args = params.get("arguments") or {}
            fn = {"nexus_milestone": self.milestone, "nexus_shared_files": self.shared_files,
                  "nexus_recent_activity": self.recent_activity}.get(name)
            if fn is None:
                return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32602, "message": "unknown tool: %s" % name}}
            try:
                text = fn(args)
                return {"jsonrpc": "2.0", "id": mid, "result": {"content": [{"type": "text", "text": text}]}}
            except Exception as exc:  # reported to the agent as a tool error, never a crash
                return {"jsonrpc": "2.0", "id": mid, "result": {"isError": True, "content": [{"type": "text", "text": str(exc)}]}}
        if mid is not None:
            return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": "method not found: %s" % method}}
        return None


def main():
    ap = argparse.ArgumentParser(description="NEXUS MCP server")
    ap.add_argument("--relay", default=os.environ.get("NEXUS_RELAY", os.path.join(os.path.dirname(os.path.abspath(__file__)), "nexus-relay")))
    ap.add_argument("--data-dir", default=os.environ.get("NEXUS_DATA_DIR", default_data_dir()))
    opts = ap.parse_args()
    server = Server(opts.relay, opts.data_dir)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            continue
        reply = server.handle(msg)
        if reply is not None:
            sys.stdout.write(json.dumps(reply) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
