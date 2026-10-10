#!/usr/bin/env python3
"""Durable, receive-only file collector. Python 3.9+, no third-party packages.

Input is an explicit room allowlist and JSON evidence envelopes, not UI automation.
No checkpoint is advanced until the server re-reads and hashes persisted evidence.
"""
import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import sys
import urllib.error
import urllib.request

KST = dt.timezone(dt.timedelta(hours=9))
DEFAULT_HOME = Path.home() / "Library/Application Support/GlovekKakaoCollector"


class CollectorError(Exception):
    pass


def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def timestamp(value):
    if not isinstance(value, str):
        raise CollectorError("timestamp_required")
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError()
        return parsed.astimezone(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    except ValueError:
        raise CollectorError("timestamp_with_timezone_required")


def fingerprint(room_name, message):
    return hashlib.sha256(encoded([timestamp(message["at"]), message["author"],
                                  "카카오톡 · " + room_name, message["text"]])).hexdigest()


def open_db(home):
    home.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(home, 0o700)
    db = sqlite3.connect(str(home / "state.sqlite3"))
    os.chmod(home / "state.sqlite3", 0o600)
    db.row_factory = sqlite3.Row
    db.executescript("""
      CREATE TABLE IF NOT EXISTS messages (
        room_key TEXT NOT NULL, external_id TEXT NOT NULL, room_name TEXT NOT NULL,
        at TEXT NOT NULL, author TEXT NOT NULL, text TEXT NOT NULL, hash TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
        next_try REAL NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT '',
        verified_at TEXT, PRIMARY KEY(room_key, external_id));
      CREATE TABLE IF NOT EXISTS snapshots (sha256 TEXT PRIMARY KEY, imported_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    """)
    return db


def load_config(home):
    try:
        config = json.loads((home / "config.json").read_text())
    except (OSError, ValueError):
        raise CollectorError("config_missing_or_invalid")
    if config.get("endpoint") != "https://admin.glovek.space/api/kakao/ingest":
        raise CollectorError("unexpected_destination")
    rooms = config.get("rooms")
    if not isinstance(rooms, list):
        raise CollectorError("room_allowlist_required")
    seen = set()
    for room in rooms:
        key = room.get("room_key", "")
        if not key or ":" in key or key in seen or not room.get("room_name"):
            raise CollectorError("invalid_room_allowlist")
        seen.add(key)
        if not Path(room.get("source", "")).is_absolute():
            raise CollectorError("absolute_source_path_required")
    return config


def import_snapshot(db, home, room):
    try:
        raw = Path(room["source"]).read_bytes()
    except OSError:
        raise CollectorError("source_unavailable")
    digest = hashlib.sha256(raw).hexdigest()
    # A snapshot digest is scoped to its room; an envelope cannot be assigned twice.
    snapshot_id = room["room_key"] + ":" + digest
    if db.execute("SELECT 1 FROM snapshots WHERE sha256=?", (snapshot_id,)).fetchone():
        return 0
    try:
        doc = json.loads(raw)
    except (ValueError, UnicodeError):
        raise CollectorError("unsupported_source_format")
    if not isinstance(doc, dict) or doc.get("room_key") != room["room_key"] or doc.get("room_name") != room["room_name"]:
        raise CollectorError("source_room_mismatch")
    messages = doc.get("messages")
    if not isinstance(messages, list):
        raise CollectorError("messages_required")
    validated = []
    ids = set()
    for m in messages:
        if not isinstance(m, dict) or any(not isinstance(m.get(k), str) for k in ["external_id", "at", "author", "text"]):
            raise CollectorError("invalid_message_fields")
        if not m["external_id"].strip() or m["external_id"] != m["external_id"].strip() or not m["text"].strip():
            raise CollectorError("empty_message_fields")
        if m["external_id"] in ids:
            raise CollectorError("duplicate_id_in_snapshot")
        ids.add(m["external_id"])
        normal = dict(m, at=timestamp(m["at"]))
        h = fingerprint(room["room_name"], normal)
        old = db.execute("SELECT hash FROM messages WHERE room_key=? AND external_id=?",
                         (room["room_key"], m["external_id"])).fetchone()
        if old and old["hash"] != h:
            raise CollectorError("source_id_content_conflict")
        validated.append((room["room_key"], m["external_id"], room["room_name"], normal["at"], m["author"], m["text"], h))
    archive = home / "archive"
    archive.mkdir(exist_ok=True, mode=0o700)
    target = archive / (digest + ".json")
    if not target.exists():
        with os.fdopen(os.open(str(target), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as f:
            f.write(raw)
            f.flush()
            os.fsync(f.fileno())
    before = db.total_changes
    with db:
        db.executemany("INSERT OR IGNORE INTO messages (room_key,external_id,room_name,at,author,text,hash) VALUES (?,?,?,?,?,?,?)", validated)
        added = db.total_changes - before
        db.execute("INSERT INTO snapshots VALUES (?,?)", (snapshot_id, dt.datetime.now(dt.timezone.utc).isoformat()))
    return added


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Client:
    def __init__(self, endpoint, secret):
        self.endpoint, self.secret = endpoint, secret
        self.opener = urllib.request.build_opener(NoRedirect)

    def call(self, payload):
        data = encoded(payload)
        if len(data) > 1_900_000:
            raise CollectorError("payload_too_large")
        req = urllib.request.Request(self.endpoint, data=data, headers={
            "Content-Type": "application/json", "x-kakao-secret": self.secret,
        })
        try:
            with self.opener.open(req, timeout=40) as response:
                result = json.load(response)
            if not isinstance(result, dict):
                raise CollectorError("invalid_server_response")
            return result
        except urllib.error.HTTPError as e:
            # Never log response bodies, headers, URLs with credentials, or exceptions.
            raise CollectorError("http_" + str(e.code))
        except (urllib.error.URLError, TimeoutError, OSError, ValueError):
            raise CollectorError("network_or_response_error")


def defer(db, rows, code, now):
    with db:
        for row in rows:
            delay = min(86400, 60 * (2 ** min(row["attempts"], 10)))
            db.execute("UPDATE messages SET state='pending', attempts=attempts+1, next_try=?, error=? WHERE room_key=? AND external_id=?",
                       (now + delay, code, row["room_key"], row["external_id"]))


def flush_room(db, room, client, now):
    rows = db.execute("SELECT * FROM messages WHERE room_key=? AND state!='verified' AND next_try<=? ORDER BY at,external_id LIMIT 100",
                      (room["room_key"], now)).fetchall()
    if not rows:
        return 0
    try:
        # Register an unknown room without disclosing messages; /kakao owns mapping.
        client.call({"room_key": room["room_key"], "room_name": room["room_name"],
                     "agent": "mac-file-collector-v1", "messages": []})
        state = client.call({"operation": "verify", "room_key": room["room_key"], "external_ids": []})
        if not room.get("expected_brand_id") or not state.get("ok") or state.get("brandId") != room["expected_brand_id"]:
            raise CollectorError("brand_mapping_unverified")
        # Bound bytes as well as count. Never truncate evidence to fit a request.
        batch = []
        for row in rows:
            candidate = batch + [row]
            payload = {"room_key": room["room_key"], "room_name": room["room_name"],
                       "agent": "mac-file-collector-v1", "messages": [
                           {k: x[k] for k in ["external_id", "at", "author", "text"]} for x in candidate]}
            if len(encoded(payload)) > 1_900_000:
                break
            batch = candidate
        if not batch:
            raise CollectorError("single_message_too_large")
        payload["messages"] = [{k: x[k] for k in ["external_id", "at", "author", "text"]} for x in batch]
        client.call(payload)
        result = client.call({"operation": "verify", "room_key": room["room_key"],
                              "external_ids": [x["external_id"] for x in batch]})
        if result.get("brandId") != room["expected_brand_id"]:
            raise CollectorError("brand_mapping_changed")
        receipts = {r["external_id"]: r["sha256"] for r in result.get("receipts", [])}
        good = [row for row in batch if receipts.get(row["external_id"]) == row["hash"]]
        bad = [row for row in batch if receipts.get(row["external_id"]) != row["hash"]]
        with db:
            db.executemany("UPDATE messages SET state='verified', verified_at=?, error='' WHERE room_key=? AND external_id=?",
                           [(dt.datetime.now(dt.timezone.utc).isoformat(), row["room_key"], row["external_id"]) for row in good])
        defer(db, bad, "persistence_verification_failed", now)
        return len(good)
    except CollectorError as e:
        defer(db, rows, str(e), now)
        return 0


def run(home, force=False):
    config = load_config(home)
    db = open_db(home)
    now = dt.datetime.now(KST)
    today = now.date().isoformat()
    last = db.execute("SELECT value FROM meta WHERE key='last_scan_day'").fetchone()
    # A periodic runner catches missed 08:00 runs after wake/login and retries backlog.
    if force or (now.hour >= 8 and (not last or last[0] != today)):
        errors = 0
        for room in config["rooms"]:
            try:
                import_snapshot(db, home, room)
            except CollectorError as e:
                errors += 1
                print(json.dumps({"stage": "source", "error": str(e)}))
        if not errors and config["rooms"]:
            with db:
                db.execute("INSERT OR REPLACE INTO meta VALUES ('last_scan_day',?)", (today,))
    try:
        secret_path = home / "ingest.secret"
        if secret_path.stat().st_mode & 0o077:
            raise CollectorError("secret_file_permissions_must_be_0600")
        secret = secret_path.read_text().strip()
        if not secret:
            raise CollectorError("secret_not_configured")
    except OSError:
        raise CollectorError("secret_not_configured")
    client = Client(config["endpoint"], secret)
    for room in config["rooms"]:
        # Keep runs bounded; remaining queued data is processed next tick.
        for _ in range(10):
            if not flush_room(db, room, client, now.timestamp()):
                break
    summary = {row[0]: row[1] for row in db.execute("SELECT state,count(*) FROM messages GROUP BY state")}
    print(json.dumps({"counts": summary, "queue_drained": not bool(summary.get("pending")),
                      "note": "File persistence receipts only; source extraction and Brand360 UI acceptance are separate."}))
    return 1 if summary.get("pending") or not summary.get("verified") else 0


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--home", type=Path, default=DEFAULT_HOME)
    parser.add_argument("--force", action="store_true", help="Scan source snapshots immediately")
    args = parser.parse_args()
    args.home.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (args.home / "collector.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print('{"state":"already_running"}')
            return 0
        try:
            return run(args.home, args.force)
        except CollectorError as e:
            print(json.dumps({"complete": False, "error": str(e)}))
            return 1
        except Exception:
            # Tracebacks can include credentials or source contents; keep diagnostics coded.
            print('{"complete":false,"error":"unexpected_local_error"}')
            return 1


if __name__ == "__main__":
    sys.exit(main())
