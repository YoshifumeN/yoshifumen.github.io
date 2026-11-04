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
        err = urllib.error.HTTPError(c.API_URL, 429, "rate limited", {"Retry-After": "1"}, None)
        class Response:
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self): return json.dumps({"results": [{"doi": "https://doi.org/" + c.DOIS[0], "cited_by_count": 2}]}).encode()
        with patch.object(c.urllib.request, "urlopen", side_effect=[err, Response()]) as req:
            result = c.fetch_citations(sleep=lambda _: None)
        self.assertEqual(req.call_count, 2)
        self.assertEqual(result[0]["cited_by_count"], 2)
        self.assertTrue(req.call_args.args[0].full_url.startswith(c.API_URL + "?"))

    def test_openalex_key_sent_as_header_not_url(self):
        class Response:
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self): return json.dumps({"results": []}).encode()
        with patch.dict(c.os.environ, {"OPENALEX_API_KEY": "test-key"}):
            with patch.object(c.urllib.request, "urlopen", return_value=Response()) as req:
                c.fetch_citations()
        request = req.call_args.args[0]
        self.assertEqual(request.get_header("Authorization"), "Bearer test-key")
        self.assertNotIn("test-key", request.full_url)

    def test_rate_limit_does_not_change_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            old_html = '<div class="citation-info" data-doi="%s">Old</div>' % c.DOIS[0]
            (root / "publications.html").write_text(old_html, encoding="utf-8")
            (root / "data").mkdir()
            old_json = '{"last_good":"retained"}'
            (root / "data" / "citations.json").write_text(old_json, encoding="utf-8")
            with patch.object(c, "HTML_FILE", root / "publications.html"), patch.object(c, "DATA_FILE", root / "data" / "citations.json"), patch.object(c, "fetch_citations", side_effect=c.CitationUpdateError("OpenAlex HTTP 429")):
                with self.assertRaises(c.CitationUpdateError):
                    c.main()
            self.assertEqual((root / "publications.html").read_text(), old_html)
            self.assertEqual((root / "data" / "citations.json").read_text(), old_json)

    def test_missing_doi_rejected(self):
        papers = [{"doi": f"https://doi.org/{c.DOIS[0]}", "cited_by_count": 5}]
        with self.assertRaises(c.CitationUpdateError):
            c.parse_counts(papers, "2026-11-04")

    def test_duplicate_and_invalid_count_rejected(self):
        with self.assertRaises(c.CitationUpdateError):
            c.parse_counts([{"doi": c.DOIS[0], "cited_by_count": -1}], "2026-11-04")
        with self.assertRaises(c.CitationUpdateError):
            c.parse_counts([{"doi": c.DOIS[0], "cited_by_count": True}], "2026-11-04")
        with self.assertRaises(c.CitationUpdateError):
            c.parse_counts([{"doi": c.DOIS[0], "cited_by_count": 1}, {"doi": c.DOIS[0], "cited_by_count": 2}], "2026-11-04")

    def test_render_rejects_missing_target(self):
        with self.assertRaises(c.CitationUpdateError):
            c.render_html("<html></html>", {c.DOIS[0]: {"count": 5, "retrieved": "2026-11-04"}})

    def test_render_updates_only_target(self):
        html = '<div class="citation-info" data-doi="%s">OLD</div><p>UNCHANGED</p>' % c.DOIS[0]
        out = c.render_html(html, {c.DOIS[0]: {"count": 5, "retrieved": "2026-11-04"}})
        self.assertIn("Citations: 5 (OpenAlex, retrieved Nov 4, 2026)", out)
        self.assertIn("UNCHANGED", out)
        self.assertNotIn("OLD", out)

    def test_all_dois_present(self):
        papers = [{"doi": "https://doi.org/" + doi, "cited_by_count": index} for index, doi in enumerate(c.DOIS)]
        data = c.parse_counts(papers, "2026-11-04")
        self.assertEqual(list(data), c.DOIS)
        self.assertTrue(all(x["source"] == "OpenAlex" for x in data.values()))


if __name__ == "__main__":
    unittest.main()
