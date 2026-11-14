import csv
import io
import unittest
from convert_export import convert


class ConvertTest(unittest.TestCase):
    def test_real_format_multiline_quotes_and_repeated_messages(self):
        out = io.StringIO(newline="")
        writer = csv.writer(out)
        writer.writerow(["Date", "User", "Message"])
        text = '  줄 1,"따옴표"\r\n줄 2\n끝  '
        for _ in range(2):
            writer.writerow(["2026-10-02 08:00:01", "합성 작성자", text])
        doc = convert(out.getvalue().encode(), "test-room", "합성 테스트방", "Asia/Seoul")
        self.assertEqual(doc["messages"][0]["text"], text)
        self.assertEqual(doc["messages"][0]["at"], "2026-10-02T08:00:01+09:00")
        self.assertNotEqual(doc["messages"][0]["external_id"], doc["messages"][1]["external_id"])
        self.assertEqual(doc, convert(out.getvalue().encode(), "test-room", "합성 테스트방", "Asia/Seoul"))

    def test_other_format_is_not_guessed(self):
        with self.assertRaises(Exception):
            convert(b"at,speaker,text\nx,y,z\n", "test-room", "room", "Asia/Seoul")
