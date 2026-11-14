#!/usr/bin/env python3
"""Fixed Mac export workflow, then durable ingestion. Never types in chat inputs.

Only explicitly configured, already-open rooms are supported. Missing/changed UI
fails closed. The first daily run after 08:00 KST exports; later runs retry the queue.
"""
import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import unicodedata

import collector as c
from convert_export import convert


def all_nodes(node):
    yield node
    for child in node.get("children", []):
        yield from all_nodes(child)


def native(binary, command, title, snapshot, *extra):
    try:
        r = subprocess.run([str(binary), command, title, str(snapshot), *extra],
                           capture_output=True, timeout=90)
    except (OSError, subprocess.TimeoutExpired):
        raise c.CollectorError("native_export_timeout_or_unavailable")
    if r.returncode:
        raise c.CollectorError("native_export_step_" + command + "_failed")
    return json.loads(snapshot.read_text())


def export_room(home, binary, room):
    if not str(Path("/etc/localtime").resolve()).endswith("/Asia/Seoul"):
        raise c.CollectorError("mac_timezone_not_verified_as_seoul")
    evidence = home / "evidence" / room["room_key"]
    evidence.mkdir(parents=True, exist_ok=True, mode=0o700)
    title = room["room_name"]
    native(binary, "export-menu", title, evidence / "menu.json")
    native(binary, "settings", title, evidence / "settings-open.json")
    settings = native(binary, "snapshot", "Window", evidence / "settings.json")
    if not any(n.get("AXValue") == title for n in all_nodes(settings)):
        raise c.CollectorError("settings_room_identity_mismatch")
    native(binary, "storage", "Window", evidence / "storage.json")
    dialog = native(binary, "save-text", "Window", evidence / "save-dialog.json")
    fields = [n for n in all_nodes(dialog) if n.get("AXIdentifier") == "saveAsNameTextField"]
    locations = [n for n in all_nodes(dialog) if n.get("AXIdentifier") == "where popup"]
    if len(fields) != 1 or len(locations) != 1 or locations[0].get("AXValue") != "다운로드":
        raise c.CollectorError("save_destination_unverified")
    name = fields[0]["AXValue"]
    if not name.startswith("KakaoTalk_Chat_" + title + "_"):
        raise c.CollectorError("export_filename_mismatch")
    expected = unicodedata.normalize("NFC", name + ".csv")
    # Never overwrite a pre-existing export or accept a stale one as new evidence.
    downloads = Path.home() / "Downloads"
    if any(unicodedata.normalize("NFC", p.name) == expected for p in downloads.iterdir()):
        raise c.CollectorError("export_filename_already_exists")
    native(binary, "confirm-save", "Window", evidence / "save-started.json", title)
    finished = False
    for _ in range(30):
        state = native(binary, "snapshot", "Window", evidence / "save-status.json")
        if any(n.get("AXValue") == "대화내용 내보내기가 완료되었습니다." for n in all_nodes(state)):
            finished = True
            break
        time.sleep(1)
    if not finished:
        raise c.CollectorError("export_did_not_complete")
    matches = [p for p in downloads.iterdir() if unicodedata.normalize("NFC", p.name) == expected]
    if len(matches) != 1:
        raise c.CollectorError("export_file_not_unique")
    raw = matches[0].read_bytes()
    archived = evidence / (hashlib.sha256(raw).hexdigest() + ".csv")
    archived.write_bytes(raw)
    archived.chmod(0o600)
    doc = convert(raw, room["room_key"], title, "Asia/Seoul")
    output = Path(room["source"])
    output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temp = output.with_suffix(".tmp")
    temp.write_bytes(c.encoded(doc))
    temp.chmod(0o600)
    temp.replace(output)
    native(binary, "finish-export", "Window", evidence / "finished.json")
    return len(doc["messages"]), len(doc["provenance"]["undated_events_held"])


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--home", type=Path, default=c.DEFAULT_HOME)
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--force-export", action="store_true")
    parser.add_argument("--stage-only", action="store_true", help="Export and queue locally; do not upload")
    args = parser.parse_args()
    args.home.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (args.home / "collector.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print('{"state":"already_running"}')
            return 0
        config = c.load_config(args.home)
        db = c.open_db(args.home)
        now = dt.datetime.now(c.KST)
        last = db.execute("SELECT value FROM meta WHERE key='last_export_day'").fetchone()
        due = args.force_export or (now.hour >= 8 and (not last or last[0] != now.date().isoformat()))
        failed = 0
        if due:
            for room in config["rooms"]:
                try:
                    count, held = export_room(args.home, args.binary, room)
                    c.import_snapshot(db, args.home, room)
                    print(json.dumps({"room_key": room["room_key"], "exported": count, "undated_held": held, "uploaded": False}))
                except c.CollectorError as e:
                    failed += 1
                    print(json.dumps({"room_key": room["room_key"], "error": str(e)}))
            if not failed and config["rooms"]:
                with db:
                    db.execute("INSERT OR REPLACE INTO meta VALUES ('last_export_day',?)", (now.date().isoformat(),))
        db.close()
        if args.stage_only:
            return 1 if failed else 0
        result = c.run(args.home)
        return 1 if failed else result


if __name__ == "__main__":
    try:
        sys.exit(main())
    except c.CollectorError as e:
        print(json.dumps({"complete": False, "error": str(e)}))
        sys.exit(1)
    except Exception:
        print('{"complete":false,"error":"unexpected_local_error"}')
        sys.exit(1)
