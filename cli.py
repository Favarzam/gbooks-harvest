"""Command-line entry point: gbooks-harvest."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from .core import HarvestConfig, harvest


def _none_or(value: str) -> str | None:
    return None if value.lower() in ("none", "any", "") else value


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="gbooks-harvest",
        description="Harvest bibliographic records from the Google Books API with a "
                    "transparent, PRISMA-style record of every step.",
    )
    p.add_argument("query", help='Search text, e.g. "the scientific method"')
    p.add_argument("--start", type=int, help="Earliest publication year to keep")
    p.add_argument("--end", type=int, help="Latest publication year to keep")
    p.add_argument("--out", default="harvest_output", help="Output folder")
    p.add_argument("--no-exact", action="store_true",
                   help="Do not wrap the query in quotes (keyword search instead of exact phrase)")
    p.add_argument("--lang", default="en", help='Language code, or "none" for all languages')
    p.add_argument("--filters", nargs="+", default=["none", "full", "partial"],
                   help="Viewability filters to combine: none full partial free-ebooks ebooks")
    p.add_argument("--print-types", nargs="+", default=["all", "books", "magazines"],
                   help="Print types to combine: all books magazines")
    p.add_argument("--order-by", nargs="+", default=["relevance"],
                   help="Sort orders to combine: relevance newest")
    p.add_argument("--max-pages", type=int, default=100,
                   help="Safety cap on pages (40 results each) per query variant")
    p.add_argument("--sleep", type=float, default=0.5, help="Seconds between requests")
    p.add_argument("--no-raw", action="store_true", help="Do not save raw API responses")
    p.add_argument("--api-key", help="API key (default: GOOGLE_BOOKS_API_KEY env variable)")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    api_key = args.api_key or os.environ.get("GOOGLE_BOOKS_API_KEY")
    if not api_key:
        print("Note: no API key found. Requests may hit low anonymous limits.\n"
              "Set GOOGLE_BOOKS_API_KEY or pass --api-key.", file=sys.stderr)

    cfg = HarvestConfig(
        query=args.query,
        exact_phrase=not args.no_exact,
        start_year=args.start,
        end_year=args.end,
        lang=_none_or(args.lang),
        filters=[_none_or(f) for f in args.filters],
        print_types=args.print_types,
        order_by=args.order_by,
        max_pages=args.max_pages,
        sleep=args.sleep,
        save_raw=not args.no_raw,
        api_key=api_key,
    )
    result = harvest(cfg, Path(args.out))
    print(json.dumps(result["counts"], indent=2))
    if result["metadata"]["stopped_early"]:
        print("\nStopped early because of the API quota. Results so far were saved.",
              file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
