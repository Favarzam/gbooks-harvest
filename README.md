# Google Books Harvest

A tool for collecting bibliographic records from the Google Books API in a way that is transparent and reproducible. It was built for historical content analysis and systematic reviews, where researchers need to report exactly how a corpus was found, what was removed, and why.

For any search, it

- runs several query variants and merges the results, which improves coverage
- filters records by publication year, since the API itself cannot
- records whether each volume is full view, partial view, or snippet only
- writes PRISMA-style counts for identification and screening
- saves every raw API response with timestamps as an audit trail

There is a browser app for the project group and a command-line tool with the same harvest logic.

## Web app

Use this if you want to search from a browser. No Python install is required.

**Live site:** [https://gbooks-harvest.vercel.app](https://gbooks-harvest.vercel.app)

1. Type a word or phrase, then click **Run harvest**.
2. When the table appears, click **Show full paragraph** on a row to open that book page.
3. In the preview **Search** box, type the phrase in quotation marks to find the exact phrase.
4. Click **Download table** to save the results as a spreadsheet.

The table is the main result. **More files** still offers the same zip and harvest CSV that the command-line tool writes.

A shared API key is already configured on the live site. If the daily quota runs out, the form can accept another Books API key.

### Local web app (developers)

The site files are in `public/`. Vercel also uses `api/` and `lib/` so the shared key can be supplied to the browser.

```bash
cp .env.example .env.local   # add GOOGLE_BOOKS_API_KEY
npm run local                # http://127.0.0.1:4173
npm test
```

To publish: create a Vercel project from this repository (root directory is the repo root, not `web/`), set `GOOGLE_BOOKS_API_KEY` in the project environment, and share the production URL. Restrict the key to the Books API. For the live site, you may also restrict HTTP referrers to the Vercel URL. Do not commit `.env.local`.

## Command-line tool

Requires Python 3.9 or later.

```bash
git clone https://github.com/Favarzam/gbooks-harvest.git
cd gbooks-harvest
python3 -m pip install -e .
```

If there is no install metadata in the clone, run the module from the repository folder after setting `PYTHONPATH` to that folder.

### Getting an API key

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

The command-line tool sends the key in a request header, so it does not appear in URLs, logs, or output files. You can check your daily quota on the Books API page in the console.

### Usage

Exact phrase, limited to a range of years:

```bash
gbooks-harvest "your phrase" --start 1900 --end 1930 --out runs/example_1900_1930
```

Keyword search across all years and languages, books only:

```bash
gbooks-harvest "your keywords" --no-exact --lang none --print-types books --out runs/example
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

The web app’s **Download table** file is a simpler spreadsheet of the on-screen table (year, title, authors, page, text, source, and category).

If the daily quota runs out partway through, the tool stops, saves everything collected so far, and notes this in `run_metadata.json`.

## Limitations worth reporting

These come from the Google Books API itself, and the tool works around them rather than removing them. I think they are worth stating plainly in any methods section.

- **No date filter in the API.** The tool searches all years and filters afterward, so older material can be crowded out by recent books.
- **Incomplete result sets.** The `totalItems` figure the API reports is an estimate, and searches often stop returning items before reaching it. Running several variants helps, but the tool cannot guarantee full recall. Comparing the retained count with a count from the Google Books web interface, or from a second database such as HathiTrust, gives a useful recall estimate.
- **Imperfect publication dates.** Google's metadata can misdate bound periodicals and reprints. Year screening should be treated as a first pass, followed by manual checking.
- **Results change over time.** Google keeps digitizing and re-indexing, so the same search can return different results on different days. This is why each run saves its raw responses and timestamps.
- **Snippets are truncated.** The official API returns one short snippet per volume. The web app opens the Google Books page so readers can see the full paragraph and search inside the book.

## Responsible use

Users are responsible for following the [Google APIs Terms of Service](https://developers.google.com/terms). Raw responses are saved locally for audit purposes, and `.gitignore` keeps output folders and environment files out of the repository by default. Please check the terms before publishing raw API data.

## Running the tests

Command-line tests use a simulated API, so they need no key or internet connection.

```bash
python3 -m pip install -e ".[dev]"
pytest
```

Web app tests:

```bash
npm test
```

## Origin

Developed by Farnaz Avarzamani Ph.D. for a follow-up to the following study.

Rillero, P., Avarzamani, F., Librea-Carden, M. R., & Golshani, S. (2026). Unraveling the fictionalized ideal: The rise of "the" scientific method in the 19th century. *Science & Education, 35*, 1483–1505. https://doi.org/10.1007/s11191-025-00690-9

## License

MIT. See `LICENSE`.
