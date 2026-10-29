import json
from pathlib import Path
import tempfile
import unittest

import collector as c


class FakeServer:
    def __init__(self, brand="brand-a", fail=False):
        self.brand, self.fail = brand, fail
        self.saved = {}

    def call(self, p):
        if self.fail:
            raise c.CollectorError("http_503")
        if p.get("operation") == "verify":
            return {"ok": bool(self.brand), "brandId": self.brand, "receipts": [
                {"external_id": id_, "sha256": self.saved[id_]} for id_ in p["external_ids"] if id_ in self.saved]}
        for m in p["messages"]:
            self.saved.setdefault(m["external_id"], c.fingerprint(p["room_name"], m))
        return {"ok": True}


class CollectorTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.home = Path(self.temp.name)
        self.db = c.open_db(self.home)
        self.room = {"room_key": "test-room", "room_name": "합성 테스트방",
                     "source": str(self.home / "input.json"), "expected_brand_id": "brand-a"}
        self.message = {"external_id": "m1", "at": "2026-10-02T08:00:00+09:00", "author": "합성 발언자",
                        "text": "  합성 원문\n" + "본문" * 12000 + "  "}

    def tearDown(self):
        self.db.close()
        self.temp.cleanup()

    def write(self, messages):
        raw = c.encoded({"room_key": self.room["room_key"], "room_name": self.room["room_name"], "messages": messages})
        Path(self.room["source"]).write_bytes(raw)
        return raw

    def test_raw_archive_and_multiline_long_body_are_exact(self):
        raw = self.write([self.message])
        self.assertEqual(c.import_snapshot(self.db, self.home, self.room), 1)
        row = self.db.execute("SELECT * FROM messages").fetchone()
        self.assertEqual(row["text"], self.message["text"])
        self.assertEqual(row["at"], "2026-10-01T23:00:00.000Z")
        self.assertEqual(next((self.home / "archive").iterdir()).read_bytes(), raw)

    def test_overlapping_snapshots_do_not_duplicate(self):
        self.write([self.message])
        c.import_snapshot(self.db, self.home, self.room)
        self.assertEqual(c.import_snapshot(self.db, self.home, self.room), 0)
        self.write([self.message, dict(self.message, external_id="m2")])
        self.assertEqual(c.import_snapshot(self.db, self.home, self.room), 1)

    def test_conflicting_id_is_held_without_overwriting_original(self):
        self.write([self.message])
        c.import_snapshot(self.db, self.home, self.room)
        self.write([dict(self.message, text="changed")])
        with self.assertRaisesRegex(c.CollectorError, "conflict"):
            c.import_snapshot(self.db, self.home, self.room)
        self.assertEqual(self.db.execute("SELECT text FROM messages").fetchone()[0], self.message["text"])

    def test_timezone_and_room_must_be_explicit(self):
        self.write([dict(self.message, at="2026-10-02T08:00:00")])
        with self.assertRaisesRegex(c.CollectorError, "timezone"):
            c.import_snapshot(self.db, self.home, self.room)
        self.assertEqual(self.db.execute("SELECT count(*) FROM messages").fetchone()[0], 0)

    def test_network_failure_survives_restart_and_retries(self):
        self.write([self.message])
        c.import_snapshot(self.db, self.home, self.room)
        self.assertEqual(c.flush_room(self.db, self.room, FakeServer(fail=True), 1000), 0)
        self.db.close()
        self.db = c.open_db(self.home)
        self.assertEqual(self.db.execute("SELECT attempts FROM messages").fetchone()[0], 1)
        server = FakeServer()
        self.assertEqual(c.flush_room(self.db, self.room, server, 1001), 0)
        self.assertEqual(c.flush_room(self.db, self.room, server, 1061), 1)
        self.assertEqual(c.flush_room(self.db, self.room, server, 9999), 0)
        self.assertEqual(len(server.saved), 1)

    def test_wrong_mapping_never_sends_messages(self):
        self.write([self.message])
        c.import_snapshot(self.db, self.home, self.room)
        server = FakeServer(brand="other-brand")
        self.assertEqual(c.flush_room(self.db, self.room, server, 1000), 0)
        self.assertEqual(server.saved, {})
        self.assertEqual(self.db.execute("SELECT error FROM messages").fetchone()[0], "brand_mapping_unverified")

    def test_http_success_without_persisted_content_is_not_checkpointed(self):
        self.write([self.message])
        c.import_snapshot(self.db, self.home, self.room)
        server = FakeServer()
        server.saved["m1"] = "wrong-hash"
        self.assertEqual(c.flush_room(self.db, self.room, server, 1000), 0)
        self.assertIsNone(self.db.execute("SELECT verified_at FROM messages").fetchone()[0])


if __name__ == "__main__":
    unittest.main()
