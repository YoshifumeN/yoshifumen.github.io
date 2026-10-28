"""Update Semantic Scholar citation counts with bounded retries and honest failures."""
import json
import os
import re
import time
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path

API_URL = (
    "https://api.semanticscholar.org/"
    "graph/v1/paper/batch?fields=title,citationCount,externalIds"
)
HTML_FILE = Path("publications.html")
DATA_FILE = Path("data/citations.json")
DOIS = [
    "10.2166/ws.2025.094",
    "10.1016/j.watres.2024.121396",
    "10.1016/j.watres.2023.120559",
    "10.1016/j.watres.2021.117550",
    "10.1016/j.watres.2020.116786",
    "10.1016/j.watres.2020.116093",
    "10.1016/j.watres.2018.10.008",
    "10.1016/j.watres.2018.03.046",
]

RETRY_HTTP_CODES = {429, 500, 502, 503, 504}
MAX_ATTEMPTS = 4
BACKOFF_SECONDS = (5, 10, 20)

class CitationUpdateError(RuntimeError):
    """The upstream citation update could not be completed safely."""


def load_old_data():
    if not DATA_FILE.exists():
        return {}
    return json.loads(DATA_FILE.read_text(encoding="utf-8"))


def fetch_citations(sleep=time.sleep):
    """One batch request, retrying temporary API errors; never log credentials."""
    body = json.dumps({"ids": [f"DOI:{doi}" for doi in DOIS]}).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "citation-updater/1.1",
    }
    key = os.environ.get("SEMANTIC_SCHOLAR_API_KEY", "").strip()
    if key:
        headers["x-api-key"] = key
    request = urllib.request.Request(API_URL, data=body, headers=headers, method="POST")

    for attempt in range(MAX_ATTEMPTS):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                papers = json.loads(response.read().decode("utf-8"))
            if not isinstance(papers, list) or not papers:
                raise CitationUpdateError("Semantic Scholar returned an empty or invalid batch")
            return papers
        except urllib.error.HTTPError as err:
            if err.code not in RETRY_HTTP_CODES or attempt == MAX_ATTEMPTS - 1:
                raise CitationUpdateError(
                    f"Semantic Scholar request failed (HTTP {err.code}); old counts preserved"
                ) from None
            retry_after = err.headers.get("Retry-After") if err.headers else None
            try:
                wait = min(60, max(1, int(retry_after))) if retry_after else BACKOFF_SECONDS[attempt]
            except (ValueError, TypeError):
                wait = BACKOFF_SECONDS[attempt]
            print(f"Semantic Scholar temporary HTTP {err.code}; retry {attempt + 1}/{MAX_ATTEMPTS - 1}")
            sleep(wait)
        except (urllib.error.URLError, TimeoutError) as err:
            if attempt == MAX_ATTEMPTS - 1:
                raise CitationUpdateError(
                    "Semantic Scholar network request failed; old counts preserved"
                ) from None
            print(f"Semantic Scholar temporary connection failure; retry {attempt + 1}/{MAX_ATTEMPTS - 1}")
            sleep(BACKOFF_SECONDS[attempt])

    raise CitationUpdateError("Citation update exhausted retries")


def make_display_date(iso_date):
    d = date.fromisoformat(iso_date)
    months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
              "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    return f"{months[d.month - 1]} {d.day}, {d.year}"


def render_html(html, data):
    """Render in memory; fail without touching files if expected elements are missing."""
    for doi, record in data.items():
        count, retrieved = record.get("count"), record.get("retrieved")
        if count is None or retrieved is None:
            continue
        replacement = (
            f'<div class="citation-info" data-doi="{doi}">'
            f'Citations: {count} '
            f'(Semantic Scholar, retrieved {make_display_date(retrieved)})'
            f'</div>'
        )
        pattern = (
            rf'<div class="citation-info" '
            rf'data-doi="{re.escape(doi)}">.*?</div>'
        )
        html, n = re.subn(pattern, lambda _: replacement, html, flags=re.DOTALL)
        if n != 1:
            raise CitationUpdateError(
                f"Expected one citation element for configured DOI {doi}, found {n}; old counts preserved"
            )
    return html


def main():
    old_data = load_old_data()
    papers = fetch_citations()
    today = date.today().isoformat()
    new_data = old_data.copy()
    updated_dois = set()

    for paper in papers:
        if not isinstance(paper, dict):
            continue
        external_ids = paper.get("externalIds") or {}
        doi = external_ids.get("DOI")
        count = paper.get("citationCount")
        if not isinstance(doi, str) or not isinstance(count, int) or count < 0:
            continue
        doi = doi.lower()
        if doi in DOIS:
            new_data[doi] = {"count": count, "retrieved": today}
            updated_dois.add(doi)
    if not updated_dois:
        raise CitationUpdateError("No citation counts returned for configured DOIs; old counts preserved")

    # Read and validate both outputs before writing either one.
    old_html = HTML_FILE.read_text(encoding="utf-8")
    new_html = render_html(old_html, new_data)
    serialized = json.dumps(new_data, indent=2, ensure_ascii=False)
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    DATA_FILE.write_text(serialized, encoding="utf-8")
    HTML_FILE.write_text(new_html, encoding="utf-8")
    print(f"Citation update succeeded for {len(updated_dois)} configured DOIs")


if __name__ == "__main__":
    try:
        main()
    except (CitationUpdateError, urllib.error.URLError) as exc:
        # A nonzero status makes GitHub Actions show failure, not a misleading success.
        raise SystemExit(str(exc)) from None
