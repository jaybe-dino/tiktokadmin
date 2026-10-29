#!/usr/bin/env python3
"""Convert an actual Kakao Mac CSV (Date,User,Message) without summarization.

The room key/name are explicit operator inputs because CSV omits both. The raw CSV
must be kept as evidence. Local timestamps require an explicitly verified timezone.
"""
import argparse
import csv
import datetime as dt
import hashlib
import io
import json
import os
from pathlib import Path
from zoneinfo import ZoneInfo

from collector import CollectorError, encoded


def convert(raw, room_key, room_name, timezone):
    if not room_key or not room_name:
        raise CollectorError("explicit_room_identity_required")
    reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig"), newline=""), strict=True)
    if reader.fieldnames != ["Date", "User", "Message"]:
        raise CollectorError("unsupported_csv_columns")
    messages, occurrences, undated = [], {}, []
    for row_number, row in enumerate(reader, start=2):
        if set(row) != {"Date", "User", "Message"} or any(v is None for v in row.values()):
            raise CollectorError("invalid_csv_row")
        if not row["Date"]:
            undated.append({"csv_row": row_number, "author": row["User"], "text": row["Message"],
                            "reason": "source_has_no_timestamp"})
            continue
        naive = dt.datetime.strptime(row["Date"], "%Y-%m-%d %H:%M:%S")
        at = naive.replace(tzinfo=ZoneInfo(timezone)).isoformat()
        # The exported file has no native message ID. Include an occurrence index
        # so identical real messages in the same second are not collapsed.
        identity = hashlib.sha256(encoded([room_key, at, row["User"], row["Message"]])).hexdigest()
        occurrence = occurrences.get(identity, 0) + 1
        occurrences[identity] = occurrence
        messages.append({"external_id": "csv1-" + identity + "-" + str(occurrence),
                         "at": at, "author": row["User"], "text": row["Message"]})
    if not messages:
        raise CollectorError("empty_export")
    return {"room_key": room_key, "room_name": room_name, "messages": messages,
            "provenance": {"kind": "kakao_mac_csv", "raw_sha256": hashlib.sha256(raw).hexdigest(),
                           "source_timezone": timezone, "scope": "messages_available_on_this_mac",
                           "native_message_ids_available": False,
                           "undated_events_held": undated}}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("source", type=Path)
    p.add_argument("output", type=Path)
    p.add_argument("--room-key", required=True)
    p.add_argument("--room-name", required=True)
    p.add_argument("--timezone", required=True)
    args = p.parse_args()
    os.umask(0o077)
    doc = convert(args.source.read_bytes(), args.room_key, args.room_name, args.timezone)
    args.output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temp = args.output.with_suffix(".tmp")
    temp.write_bytes(encoded(doc))
    temp.chmod(0o600)
    temp.replace(args.output)
    print(json.dumps({"messages": len(doc["messages"]), "first_at": doc["messages"][0]["at"],
                      "last_at": doc["messages"][-1]["at"], "uploaded": False}))


if __name__ == "__main__":
    main()
