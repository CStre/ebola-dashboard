# CLAUDE.md — ebola-dashboard

Operational context for working on this repo. Read first; saves a lot of re-exploration.

## What this is

A static, single-page dashboard tracking the 2026 Ebola Bundibugyo outbreak in DRC and Uganda.

- **Live site**: https://cstre.github.io/ebola-dashboard/
- **Repo**: https://github.com/CStre/ebola-dashboard
- **Hosting**: GitHub Pages, deploys from `main` branch root
- **Refresh cadence**: twice daily via GitHub Actions cron — 12:00 UTC (~8 AM ET) and 22:00 UTC (~6 PM ET). Times float 1h across DST since cron has no TZ support. Also `workflow_dispatch`-able.

## Stack

| Layer | Tool |
|---|---|
| Frontend | Vanilla HTML/CSS/JS (no framework, no build step) |
| Map | Leaflet 1.9.4 + CartoCDN dark tiles |
| Charts | Chart.js 4.4.1 (umd via jsDelivr) |
| Fonts | Inter + JetBrains Mono (Google Fonts) |
| Fetcher | Python 3.12 + `anthropic` SDK with web search tool |
| CI | GitHub Actions, single `update-data.yml` workflow |

No bundler, no package.json, no node_modules. Edit files and push.

## File layout

```
ebola-dashboard/
├── index.html                     # markup + section anchors (#overview, #map, #trends, #news, #timeline, #context, #sources)
├── assets/
│   ├── css/main.css               # dark theme; CSS custom properties at :root
│   └── js/app.js                  # one IIFE — fetches data, renders everything
├── data/
│   ├── outbreak.json              # auto-refreshed by the cron job (do not hand-edit unless seeding)
│   └── history.json               # static background context (virus facts, past outbreaks)
├── scripts/
│   ├── fetch_data.py              # the worker; calls Anthropic API with web_search_20250305 tool
│   └── requirements.txt           # anthropic>=0.40.0
├── .github/workflows/update-data.yml
└── README.md                      # user-facing setup instructions
```

## Data flow

```
GHA cron (0 */4 * * *)
  → scripts/fetch_data.py
      → anthropic.Messages.create(model=claude-sonnet-4-6, tools=[web_search_20250305])
      → parses JSON from model output (handles ```json fences)
      → merges with existing data/outbreak.json (preserves timeline + snapshots)
  → git commit data/outbreak.json → push to main
  → Pages rebuilds
  → frontend fetches data/outbreak.json on load + every 30 min
```

## outbreak.json schema (the contract)

The frontend reads this. The fetcher writes this. Keys the model produces fresh each run:

```jsonc
{
  "meta": {
    "last_updated": "ISO 8601 UTC",
    "next_update": "ISO 8601 UTC (fetcher sets to the next 12:00/22:00 UTC firing)",
    "disease": "Ebola disease (Bundibugyo virus)",
    "phase": "PHEIC label",
    "declared_at": "ISO 8601",
    "data_sources": ["Label (domain, YYYY-MM-DD) URL", ...],
    "top_publications": ["WHO", "Africa CDC", "CDC", "Reuters", "The Lancet"],  // 3-5; drives hero & news subtitles
    "cross_references": {
      "confirmations_for_totals": <int>,
      "primary_count": <int>,
      "wire_count": <int>,
      "scholarly_count": <int>,
      "notes": "<analyst note on agreement/divergence>"
    }
  },
  "totals": { "confirmed", "suspected", "deaths", "health_zones_affected", "countries_with_cases", "healthcare_worker_deaths" },
  "totals_previous": { same shape + "as_of" — set by fetcher BEFORE writing new totals (as_of = previous run's last_updated) },
  "locations": [
    { "id", "name", "region", "country", "lat", "lon",
      "status": "active|retracted|resolved",
      "tier": "epicenter|high|new|international|retracted",
      "first_reported": "YYYY-MM-DD",
      "confirmed_cases": <int — optional, per-location>,
      "suspected_cases": <int — optional, per-location>,
      "deaths": <int — optional, per-location>,
      "notes": "<one sentence>" }
  ],
  "timeline": [ { "date": "YYYY-MM-DD", "event": "<≤240 chars>" } ],  // merged across runs, deduped
  "history_snapshots": [ { "date", "confirmed", "suspected", "deaths", "health_zones" } ],  // one per day, last write wins
  "alerts": [ { "level": "critical|warning|info", "title", "body", "source", "url" } ],
  "news": [ { "title", "summary", "source", "url", "date", "tags": [] } ],  // 8–12 items, last 7 days
  "historical_context": {
    "background": { "virus", "family", "genus", "discovery", "case_fatality_rate_historical", "transmission", "incubation_days", "symptoms", "vaccines_therapeutics" },
    "past_outbreaks": [ {"year", "location", "cases", "deaths", "cfr", "notes"} ],
    "why_this_matters": ["<bullet>"]
  }
}
```

The model returns `timeline_additions` (not `timeline`); the fetcher merges those into the existing timeline.

`tier` semantics (drive marker color and chart legend):
- `epicenter` — primary outbreak origin
- `high` — active hotspot, established
- `new` — first reported within last 24h (gets pulsing marker)
- `international` — outside the index country
- `retracted` — case disconfirmed on lab follow-up

## history.json schema

Static fallback only — used on first load if `outbreak.json` doesn't yet have a `historical_context` block. After the first refresh the model maintains `outbreak.json#historical_context` on every run.

```jsonc
{
  "background": { "virus", "family", "genus", "discovery", "case_fatality_rate_historical", "transmission", "incubation_days", "symptoms" },
  "past_outbreaks": [ { "year", "location", "cases", "deaths", "cfr", "notes" } ],
  "why_this_matters": ["<bullet>"]
}
```

## What is dynamic vs static

**Auto-refreshed twice daily (outbreak.json):** status pill, hero eyebrow, hero sub (injects active countries + top publications), news section subtitle (top publications), timestamps in `America/New_York`, all 4 stat cards (values + delta badges + footers), alerts, map markers + popups, all 4 charts, news grid, timeline, source summary cards, source list, historical context (background facts + past outbreaks + why-this-matters), footer timestamp.

**Static fallback (history.json):** Only used before the first refresh writes a `historical_context` block into outbreak.json.

**Hardcoded in HTML:** page title, brand (`BDBV Tracker`), nav labels, hero headline ("Ebola Bundibugyo outbreak, live."), section H2s + subtitles, stat card labels ("Confirmed cases" etc.), chart titles, map legend, footer disclaimer.

## Common commands

```bash
# Trigger a refresh manually
gh workflow run "Update outbreak data" --repo CStre/ebola-dashboard

# Watch latest run
RUN=$(gh run list --repo CStre/ebola-dashboard -L 1 --json databaseId -q '.[0].databaseId')
gh run watch "$RUN" --repo CStre/ebola-dashboard

# Inspect a failed run
gh run view "$RUN" --repo CStre/ebola-dashboard --log-failed

# Run the fetcher locally (needs API key)
export ANTHROPIC_API_KEY=sk-ant-...
pip install -r scripts/requirements.txt
python scripts/fetch_data.py

# Serve frontend locally
python3 -m http.server 8000   # then open http://localhost:8000
```

## Conventions and gotchas

- **Charts MUST stay inside `.chart-canvas`** (`position: relative; height: 300px;`). Removing that wrapper causes Chart.js to feedback-loop and grow the page infinitely. Already-fixed bug — don't reintroduce it.
- **Anthropic API ≠ Claude.ai subscription.** Workflow uses pay-as-you-go API credits at console.anthropic.com. Set a budget alert.
- **Model**: `claude-sonnet-4-6` by default. Override via `CLAUDE_MODEL` env. `MAX_TOKENS=16000`, `MAX_SEARCH_USES=12`.
- **Secret name**: `ANTHROPIC_API_KEY` as a repo secret. Never commit it; `.env*` is in `.gitignore`.
- **The fetcher merges, doesn't replace.** Timeline events stay (deduped by date+text), snapshots accumulate (one per day, last write wins), totals_previous is set to the prior `totals` before writing fresh ones. If you need a clean slate, hand-edit `data/outbreak.json`.
- **Tile attribution must stay** (Leaflet + CartoCDN ToS). Don't remove `.leaflet-control-attribution`.
- **gh CLI lives on PATH** (`/opt/homebrew/bin/gh`), already authenticated as `CStre` with `repo + workflow + admin` scopes.
- **`claude` CLI is NOT on PATH** here — Claude Code is bundled inside the Claude Desktop app at `/Users/collin/Library/Application Support/Claude/claude-code/<version>/claude.app/Contents/MacOS/claude`. For ops on this repo, prefer `gh` directly.

## Design system (in CSS custom properties)

```
--bg-0..3        dark backgrounds, deepest first
--text/-dim/-faint  three text tiers
--accent #ff5252    primary red
--accent-2 #ff8a3d  orange (gradient pair with accent)
--info #5aa9ff      blue (international tier)
--warn #ffb547      amber (warnings)
--ok #4ade80        green (status ok)
```

Inter for body, JetBrains Mono for numbers/timestamps. Reveal animations driven by IntersectionObserver. All animations respect `prefers-reduced-motion`.

## Mobile breakpoints

`900px` (tablet), `520px` (phone), `380px` (very small). Tested in viewports, not on real devices. If something overflows, tighten in `assets/css/main.css` at the appropriate `@media` block.

## Deployment

- Pages source: `main` branch, `/` path
- Build is automatic on each push
- HTTPS enforced
- No custom domain configured (could add by pointing CNAME to `cstre.github.io` + repo settings)
