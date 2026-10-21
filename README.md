# gbooks-harvest

A small command-line tool for collecting bibliographic records from the Google Books API in a way that is transparent and reproducible. It was built for historical content analysis and systematic reviews, where researchers need to report exactly how a corpus was found, what was removed, and why.

For any search, it

- runs several query variants and merges the results, which improves coverage
- filters records by publication year, since the API itself cannot
- records whether each volume is full view, partial view, or snippet only
- writes PRISMA-style counts for identification and screening
- saves every raw API response with timestamps as an audit trail

## Installation

Requires Python 3.9 or later.

```bash
git clone https://github.com/<your-username>/gbooks-harvest.git
cd gbooks-harvest
pip install -e .
```

## Getting an API key

The Google Books API is free to use for searching. Without a key, requests fall under very low anonymous limits, so a key is recommended.

1. Sign in at [Google Cloud Console](https://console.cloud.google.com) and create a project.
2. Go to APIs & Services, then Library, and enable the **Books API**.
3. Go to APIs & Services, then Credentials, and create an **API key**.
4. Restrict the key to the Books API.
5. Make the key available to the tool without putting it in any file you commit.

```bash
# macOS / Linux
export GOOGLE_BOOKS_API_KEY="your-key"

# Windows PowerShell
$env:GOOGLE_BOOKS_API_KEY="your-key"
```

The tool sends the key in a request header, so it does not appear in URLs, logs, or output files. You can check your daily quota on the Books API page in the console.

## Usage

Exact phrase, limited to a range of years:

```bash
gbooks-harvest "the scientific method" --start 1900 --end 1930 --out runs/tsm_1900_1930
```

Keyword search across all years and languages, books only:

```bash
gbooks-harvest "nature study pedagogy" --no-exact --lang none --print-types books --out runs/nature_study
```

Run `gbooks-harvest --help` to see every option.

| Option | Default | What it does |
|---|---|---|
| `--start`, `--end` | none | Keep only records published within these years |
| `--no-exact` | off | Search as keywords instead of an exact phrase |
| `--lang` | `en` | Language restriction, or `none` |
| `--filters` | `none full partial` | Viewability filters to combine into query variants |
| `--print-types` | `all books magazines` | Print types to combine into query variants |
| `--order-by` | `relevance` | Sort orders to combine (`relevance`, `newest`) |
| `--max-pages` | `100` | Safety cap on pages of 40 results per variant |
| `--no-raw` | off | Skip saving raw API responses |

Each combination of filter, print type, and sort order is one query variant. The defaults give 9 variants.

## Output

| File | Contents |
|---|---|
| `records.csv` | Records kept after year screening, sorted by year |
| `all_merged.csv` | Every unique record retrieved, before screening |
| `excluded_out_of_range.csv` | Records removed because their year falls outside the range |
| `excluded_no_date.csv` | Records removed because they have no usable date |
| `prisma_counts.json` | Counts for identification, deduplication, screening, and viewability |
| `run_metadata.json` | Query, settings, timestamps, and per-variant request counts |
| `raw_responses/` | Every API response exactly as received |

Each record includes title, authors, publisher, raw and parsed publication date, print type, language, identifiers, viewability (`ALL_PAGES`, `PARTIAL`, `NO_PAGES`), public domain status, a cleaned text snippet showing the match in context, links, and the query variants that found it.

If the daily quota runs out partway through, the tool stops, saves everything collected so far, and notes this in `run_metadata.json`.

## Limitations worth reporting

These come from the Google Books API itself, and the tool works around them rather than removing them. I think they are worth stating plainly in any methods section.

- **No date filter in the API.** The tool searches all years and filters afterward, so older material can be crowded out by recent books.
- **Incomplete result sets.** The `totalItems` figure the API reports is an estimate, and searches often stop returning items before reaching it. Running several variants helps, but the tool cannot guarantee full recall. Comparing the retained count with a count from the Google Books web interface, or from a second database such as HathiTrust, gives a useful recall estimate.
- **Imperfect publication dates.** Google's metadata can misdate bound periodicals and reprints. Year screening should be treated as a first pass, followed by manual checking.
- **Results change over time.** Google keeps digitizing and re-indexing, so the same search can return different results on different days. This is why each run saves its raw responses and timestamps.

## Responsible use

Users are responsible for following the [Google APIs Terms of Service](https://developers.google.com/terms). Raw responses are saved locally for audit purposes, and `.gitignore` keeps output folders out of the repository by default. Please check the terms before publishing raw API data.

## Running the tests

The tests use a simulated API, so they need no key or internet connection.

```bash
pip install -e ".[dev]"
pytest
```

## Origin

This tool was developed for a follow-up to the following study, extending its analysis of "the scientific method" into 1900 to 1930.

Rillero, P., Avarzamani, F., Librea-Carden, M. R., & Golshani, S. (2026). Unraveling the fictionalized ideal: The rise of "the" scientific method in the 19th century. *Science & Education, 35*, 1483–1505. https://doi.org/10.1007/s11191-025-00690-9

## Citing

If this tool supports your research, please cite it using `CITATION.cff`, or use the "Cite this repository" button on GitHub.

## License

MIT. See `LICENSE`.
