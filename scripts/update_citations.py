"""Refresh OpenAlex citation counts with validation and bounded retries."""

import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

API_URL = "https://api.openalex.org/works"
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
    """The upstream data cannot be safely used to update the website."""


def normalize_doi(value):
    if not isinstance(value, str):
        return None
    doi = value.strip().lower()
    for prefix in ("https://doi.org/", "http://doi.org/", "doi:"):
        if doi.startswith(prefix):
            doi = doi[len(prefix):]
            break
    return doi


def fetch_citations(sleep=time.sleep):
    """Fetch configured DOIs in one OpenAlex request with bounded retries."""
    params = urllib.parse.urlencode({
        "filter": "doi:" + "|".join(DOIS),
        "per_page": str(len(DOIS)),
        "select": "doi,cited_by_count",
    })
    headers = {"User-Agent": "citation-updater/2.0"}
    key = os.environ.get("OPENALEX_API_KEY", "").strip()
    if key:
        headers["Authorization"] = "Bearer " + key
    request = urllib.request.Request(f"{API_URL}?{params}", headers=headers, method="GET")

    for attempt in range(MAX_ATTEMPTS):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = json.loads(response.read().decode("utf-8"))
            if not isinstance(payload, dict) or not isinstance(payload.get("results"), list):
                raise CitationUpdateError("OpenAlex returned an invalid response; old counts preserved")
            return payload["results"]
        except urllib.error.HTTPError as err:
            if err.code not in RETRY_HTTP_CODES or attempt == MAX_ATTEMPTS - 1:
                raise CitationUpdateError(
                    f"OpenAlex request failed (HTTP {err.code}); old counts preserved"
                ) from None
            retry_after = err.headers.get("Retry-After") if err.headers else None
            try:
                wait = min(60, max(1, int(retry_after))) if retry_after else BACKOFF_SECONDS[attempt]
            except (ValueError, TypeError):
                wait = BACKOFF_SECONDS[attempt]
            print(f"OpenAlex temporary HTTP {err.code}; retry {attempt + 1}/{MAX_ATTEMPTS - 1}")
            sleep(wait)
        except (urllib.error.URLError, TimeoutError):
            if attempt == MAX_ATTEMPTS - 1:
                raise CitationUpdateError("OpenAlex network request failed; old counts preserved") from None
            print(f"OpenAlex connection error; retry {attempt + 1}/{MAX_ATTEMPTS - 1}")
            sleep(BACKOFF_SECONDS[attempt])

    raise CitationUpdateError("OpenAlex citation update exhausted retries")


def make_display_date(iso_date):
    d = date.fromisoformat(iso_date)
    months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
              "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    return f"{months[d.month - 1]} {d.day}, {d.year}"


def render_html(html, data):
    """Render in memory; reject a missing or duplicate citation element."""
    for doi, record in data.items():
        count, retrieved = record["count"], record["retrieved"]
        replacement = (
            f'<div class="citation-info" data-doi="{doi}">'
            f'Citations: {count} (OpenAlex, retrieved {make_display_date(retrieved)})'
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


def parse_counts(papers, today):
    """Require all configured DOIs, without duplicates, before changing data sources."""
    results = {}
    for paper in papers:
        if not isinstance(paper, dict):
            raise CitationUpdateError("Invalid OpenAlex work; old counts preserved")
        doi = normalize_doi(paper.get("doi"))
        if doi not in DOIS:
            raise CitationUpdateError("Unexpected OpenAlex DOI; old counts preserved")
        count = paper.get("cited_by_count")
        if type(count) is not int or count < 0 or doi in results:
            raise CitationUpdateError("Invalid or duplicate OpenAlex citation count; old counts preserved")
        results[doi] = {"count": count, "retrieved": today, "source": "OpenAlex"}
    if set(results) != set(DOIS):
        missing = sorted(set(DOIS) - set(results))
        raise CitationUpdateError(f"OpenAlex did not return all configured DOIs ({len(missing)} missing); old counts preserved")
    return {doi: results[doi] for doi in DOIS}


def main():
    papers = fetch_citations()
    new_data = parse_counts(papers, date.today().isoformat())
    old_html = HTML_FILE.read_text(encoding="utf-8")
    new_html = render_html(old_html, new_data)
    serialized = json.dumps(new_data, indent=2, ensure_ascii=False) + "\n"
    # Only write after both outputs are successfully validated.
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    DATA_FILE.write_text(serialized, encoding="utf-8")
    HTML_FILE.write_text(new_html, encoding="utf-8")
    print(f"OpenAlex citation update succeeded for {len(new_data)} configured DOIs")


if __name__ == "__main__":
    try:
        main()
    except (CitationUpdateError, urllib.error.URLError) as exc:
        raise SystemExit(str(exc)) from None
