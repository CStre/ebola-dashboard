# BDBV Tracker — Ebola Bundibugyo Outbreak Dashboard

Live dashboard tracking the 2026 Ebola disease (Bundibugyo virus) outbreak in the
Democratic Republic of the Congo and Uganda. Data is refreshed every four hours by a
GitHub Actions cron job that calls the Claude API with web search to pull figures
from WHO, CDC, Africa CDC, Reuters, AP, and government health ministry releases.

> **Disclaimer:** This is an open-source aggregation dashboard, not an official
> health authority. For authoritative information always consult the
> [WHO](https://www.who.int/) and your national public health agency.

## How it works

```
┌────────────────────┐    ┌──────────────────────┐    ┌──────────────────┐
│ GitHub Actions     │───▶│ scripts/fetch_data.py│───▶│ Claude API       │
│ (cron, every 4h)   │    │                      │    │ + web search     │
└────────────────────┘    └──────────────────────┘    └──────────────────┘
          │                          │                         │
          │              ┌───────────▼──────────────┐          │
          │              │ data/outbreak.json       │◀─────────┘
          │              │ (merged + committed)     │
          │              └──────────────────────────┘
          │                          │
          ▼                          ▼
┌────────────────────┐    ┌──────────────────────────┐
│ git push origin    │───▶│ GitHub Pages → live site │
└────────────────────┘    └──────────────────────────┘
```

The frontend is a single static page (`index.html` + `assets/`) that reads
`data/outbreak.json` and renders:
- An interactive Leaflet map with pulsing markers for the newest cases
- Animated stat cards with delta indicators vs. the previous reporting period
- Trend charts (Chart.js) for cumulative cases, locations, zones, and CFR
- An auto-populated event timeline and historical context

## Setup

### 1. Add your Anthropic API key as a repo secret

The data-refresh workflow needs an API key. Add it via the GitHub UI or `gh`:

```bash
gh secret set ANTHROPIC_API_KEY --repo CStre/ebola-dashboard
# (paste your key when prompted)
```

The key is never committed to the repo and is only exposed to the workflow.

### 2. Enable GitHub Pages

```bash
gh api -X POST repos/CStre/ebola-dashboard/pages \
  -f source[branch]=main -f source[path]=/
```

The site will be available at `https://cstre.github.io/ebola-dashboard/` once the
first Pages build completes (~1-2 minutes).

### 3. Trigger the first data refresh

```bash
gh workflow run "Update outbreak data" --repo CStre/ebola-dashboard
```

Or just wait — the cron will fire automatically on the next 4-hour boundary.

## Local development

```bash
# Serve the static site locally
python3 -m http.server 8000
# → open http://localhost:8000

# Run the data fetcher locally (requires ANTHROPIC_API_KEY)
export ANTHROPIC_API_KEY=sk-ant-...
pip install -r scripts/requirements.txt
python scripts/fetch_data.py
```

## File layout

```
ebola-dashboard/
├── index.html
├── assets/
│   ├── css/main.css
│   └── js/app.js
├── data/
│   ├── outbreak.json       # auto-updated by Actions
│   └── history.json        # static background context
├── scripts/
│   ├── fetch_data.py
│   └── requirements.txt
├── .github/workflows/
│   └── update-data.yml
└── README.md
```

## Cost & rate-limit notes

The cron runs every 4 hours = 6 calls/day. Each call uses up to 8 web searches and
under 4K output tokens. Set a budget alert in your
[Anthropic console](https://console.anthropic.com/) if you want to cap spend.

## License

MIT.
