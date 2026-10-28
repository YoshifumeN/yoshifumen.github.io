import io
import json
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import update_citations as c

class CitationSafetyTests(unittest.TestCase):
    def test_retry_429_then_success(self):
        err = urllib.error.HTTPError(c.API_URL,429,"rate limited",{"Retry-After":"1"},None)
        class Response:
            def __enter__(self): return self
            def __exit__(self,*args): pass
            def read(self): return json.dumps([{"externalIds":{"DOI":c.DOIS[0]},"citationCount":2}]).encode()
        with patch.object(c.urllib.request,"urlopen",side_effect=[err,Response()]) as req:
            result=c.fetch_citations(sleep=lambda _:None)
        self.assertEqual(req.call_count,2)
        self.assertEqual(result[0]["citationCount"],2)

    def test_rate_limit_does_not_change_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            original_html='<div class="citation-info" data-doi="%s">Old</div>'%c.DOIS[0]
            (root/"publications.html").write_text(original_html,encoding="utf-8")
            (root/"data").mkdir()
            old='{"last_good":"retained"}'
            (root/"data"/"citations.json").write_text(old,encoding="utf-8")
            err=urllib.error.HTTPError(c.API_URL,429,"rate limited",{},None)
            with patch.object(c,"HTML_FILE",root/"publications.html"),patch.object(c,"DATA_FILE",root/"data"/"citations.json"),patch.object(c.urllib.request,"urlopen",side_effect=err),patch.object(c.time,"sleep",lambda _:None):
                with self.assertRaises(c.CitationUpdateError):
                    c.main()
            self.assertEqual((root/"publications.html").read_text(),original_html)
            self.assertEqual((root/"data"/"citations.json").read_text(),old)

    def test_render_rejects_missing_target(self):
        with self.assertRaises(c.CitationUpdateError):
            c.render_html("<html></html>",{c.DOIS[0]:{"count":5,"retrieved":"2026-10-28"}})

    def test_render_updates_only_target(self):
        html='<div class="citation-info" data-doi="%s">OLD</div><p>UNCHANGED</p>'%c.DOIS[0]
        out=c.render_html(html,{c.DOIS[0]:{"count":5,"retrieved":"2026-10-28"}})
        self.assertIn("Citations: 5",out)
        self.assertIn("UNCHANGED",out)
        self.assertNotIn("OLD",out)

if __name__=="__main__":
    unittest.main()
