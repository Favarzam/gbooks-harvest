"""Core logic: query the Google Books Volumes API, merge, filter, and report."""

from __future__ import annotations

import html
import itertools
import json
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import requests

API_URL = "https://www.googleapis.com/books/v1/volumes"
PAGE_SIZE = 40  # maximum allowed by the API


class QuotaExceeded(Exception):
    """Raised when the API reports that the daily or per-minute quota is used up."""


@dataclass
class HarvestConfig:
    query: str
    exact_phrase: bool = True
    start_year: int | None = None
    end_year: int | None = None
    lang: str | None = "en"
    filters: list[str | None] = field(default_factory=lambda: [None, "full", "partial"])
    print_types: list[str] = field(default_factory=lambda: ["all", "books", "magazines"])
    order_by: list[str] = field(default_factory=lambda: ["relevance"])
    max_pages: int = 100
    sleep: float = 0.5
    save_raw: bool = True
    api_key: str | None = None

    @property
    def q(self) -> str:
        if self.exact_phrase and not self.query.startswith('"'):
            return f'"{self.query}"'
        return self.query

    def variants(self) -> list[dict]:
        combos = itertools.product(self.filters, self.print_types, self.order_by)
        return [{"filter": f, "printType": p, "orderBy": o} for f, p, o in combos]

    def in_range(self, year: int | None) -> bool:
        if year is None:
            return False
        if self.start_year is not None and year < self.start_year:
            return False
        if self.end_year is not None and year > self.end_year:
            return False
        return True

    @property
    def has_range(self) -> bool:
        return self.start_year is not None or self.end_year is not None


# ---------- parsing helpers ----------

def parse_year(published_date: str | None) -> int | None:
    """Return the leading 4-digit year of a publishedDate string, or None."""
    if not published_date:
        return None
    m = re.match(r"(\d{4})", published_date)
    return int(m.group(1)) if m else None


def clean_snippet(text: str | None) -> str:
    """Strip HTML tags and entities from searchInfo.textSnippet."""
    if not text:
        return ""
    return html.unescape(re.sub(r"<[^>]+>", "", text)).strip()


def flatten(item: dict) -> dict:
    """Turn one API volume resource into a flat row for CSV export."""
    v = item.get("volumeInfo", {})
    a = item.get("accessInfo", {})
    ids = {i.get("type"): i.get("identifier") for i in v.get("industryIdentifiers", [])}
    return {
        "volume_id": item.get("id", ""),
        "title": v.get("title", ""),
        "subtitle": v.get("subtitle", ""),
        "authors": "; ".join(v.get("authors", [])),
        "publisher": v.get("publisher", ""),
        "published_date_raw": v.get("publishedDate", ""),
        "year": parse_year(v.get("publishedDate")),
        "print_type": v.get("printType", ""),
        "language": v.get("language", ""),
        "page_count": v.get("pageCount", ""),
        "categories": "; ".join(v.get("categories", [])),
        "identifiers": "; ".join(f"{k}:{val}" for k, val in ids.items()),
        "viewability": a.get("viewability", ""),
        "public_domain": a.get("publicDomain", ""),
        "pdf_available": a.get("pdf", {}).get("isAvailable", ""),
        "epub_available": a.get("epub", {}).get("isAvailable", ""),
        "text_snippet": clean_snippet(item.get("searchInfo", {}).get("textSnippet")),
        "preview_link": v.get("previewLink", ""),
        "info_link": v.get("infoLink", ""),
    }


# ---------- API access ----------

def get_page(session: requests.Session, params: dict, retries: int = 5) -> dict:
    """One API call with exponential backoff. Raises QuotaExceeded on daily limits."""
    for attempt in range(retries):
        r = session.get(API_URL, params=params, timeout=30)
        if r.status_code == 200:
            return r.json()
        if r.status_code == 403 and ("limit" in r.text.lower() or "quota" in r.text.lower()):
            raise QuotaExceeded(r.text[:300])
        if r.status_code in (429, 500, 502, 503):
            time.sleep(2 ** attempt)
            continue
        r.raise_for_status()
    if r.status_code == 429:
        raise QuotaExceeded("Rate limit still exceeded after retries.")
    raise RuntimeError(f"Request failed after {retries} retries (last status {r.status_code}).")


def variant_label(variant: dict) -> str:
    return "_".join(f"{k}-{v}" for k, v in variant.items() if v) or "default"


def run_variant(session, cfg: HarvestConfig, variant: dict, raw_dir: Path | None):
    params = {"q": cfg.q, "maxResults": PAGE_SIZE}
    if cfg.lang:
        params["langRestrict"] = cfg.lang
    params.update({k: v for k, v in variant.items() if v})

    label = variant_label(variant)
    items, reported_total, requests_made = [], None, 0
    for page in range(cfg.max_pages):
        params["startIndex"] = page * PAGE_SIZE
        data = get_page(session, params)
        requests_made += 1
        if raw_dir is not None:
            (raw_dir / f"{label}_p{page:03d}.json").write_text(json.dumps(data), encoding="utf-8")
        if reported_total is None:
            reported_total = data.get("totalItems")
        batch = data.get("items", [])
        if not batch:
            break
        items.extend(batch)
        time.sleep(cfg.sleep)
    return label, items, reported_total, requests_made


# ---------- main harvest ----------

def harvest(cfg: HarvestConfig, out_dir: Path, session: requests.Session | None = None,
            log=print) -> dict:
    """Run every query variant, merge by volume ID, filter by year, write outputs."""
    out_dir.mkdir(parents=True, exist_ok=True)
    raw_dir = out_dir / "raw_responses" if cfg.save_raw else None
    if raw_dir is not None:
        raw_dir.mkdir(exist_ok=True)
    session = session or requests.Session()
    if cfg.api_key:
        # Sent as a header so the key never appears in URLs, logs, or error messages.
        session.headers["X-goog-api-key"] = cfg.api_key
    started = datetime.now(timezone.utc).isoformat()

    merged, found_by, variant_log = {}, {}, []
    total_hits, total_requests, stopped_early = 0, 0, None

    for variant in cfg.variants():
        try:
            label, items, reported, n_req = run_variant(session, cfg, variant, raw_dir)
        except QuotaExceeded as e:
            stopped_early = f"Quota exceeded during variant {variant_label(variant)}: {e}"
            log(stopped_early)
            break
        total_hits += len(items)
        total_requests += n_req
        variant_log.append({"variant": label, "retrieved": len(items),
                            "api_totalItems": reported, "requests": n_req})
        log(f"{label}: {len(items)} items (API reported totalItems={reported})")
        for item in items:
            vid = item.get("id")
            if not vid:
                continue
            merged.setdefault(vid, item)
            found_by.setdefault(vid, []).append(label)

    rows = []
    for vid, item in merged.items():
        row = flatten(item)
        row["found_by"] = "; ".join(found_by[vid])
        rows.append(row)

    if cfg.has_range:
        no_date = [r for r in rows if r["year"] is None]
        out_range = [r for r in rows if r["year"] is not None and not cfg.in_range(r["year"])]
        included = [r for r in rows if cfg.in_range(r["year"])]
    else:
        no_date, out_range, included = [], [], rows
    included.sort(key=lambda r: (r["year"] or 0, r["title"]))

    _write_csv(out_dir / "records.csv", included)
    _write_csv(out_dir / "all_merged.csv", rows)
    if cfg.has_range:
        _write_csv(out_dir / "excluded_out_of_range.csv", out_range)
        _write_csv(out_dir / "excluded_no_date.csv", no_date)

    view_counts = {}
    for r in included:
        key = r["viewability"] or "MISSING"
        view_counts[key] = view_counts.get(key, 0) + 1

    counts = {
        "identification": {
            "records_retrieved_all_variants": total_hits,
            "duplicates_removed": total_hits - len(rows),
            "unique_records": len(rows),
        },
        "screening_by_year": {
            "excluded_outside_range": len(out_range),
            "excluded_no_date": len(no_date),
            "retained": len(included),
        } if cfg.has_range else "not applied (no year range given)",
        "retained_by_viewability": view_counts,
    }
    metadata = {
        "tool": "gbooks-harvest",
        "run_started_utc": started,
        "run_finished_utc": datetime.now(timezone.utc).isoformat(),
        "api_endpoint": API_URL,
        "query_sent": cfg.q,
        "language_restriction": cfg.lang,
        "year_range": [cfg.start_year, cfg.end_year],
        "max_pages_per_variant": cfg.max_pages,
        "total_api_requests": total_requests,
        "stopped_early": stopped_early,
        "variants": variant_log,
    }
    (out_dir / "prisma_counts.json").write_text(json.dumps(counts, indent=2), encoding="utf-8")
    (out_dir / "run_metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    return {"counts": counts, "metadata": metadata}


def _write_csv(path: Path, rows: list[dict]) -> None:
    import csv

    fields = list(flatten({}).keys()) + ["found_by"]
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)
