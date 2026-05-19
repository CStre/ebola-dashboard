"""Fetch latest outbreak data using Claude's web search and write data/outbreak.json.

Designed to run from GitHub Actions on a 4-hour cron. Requires the
ANTHROPIC_API_KEY environment variable.

The script:
  1. Loads the existing data file to use as "previous totals" context.
  2. Asks Claude (with web search) to find the latest WHO/CDC/credible figures.
  3. Parses the model's structured JSON response.
  4. Writes the merged result back to data/outbreak.json.
"""

from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import anthropic


ROOT = Path(__file__).resolve().parent.parent
DATA_PATH = ROOT / "data" / "outbreak.json"
MODEL = os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-5")
MAX_SEARCH_USES = int(os.environ.get("MAX_SEARCH_USES", "8"))


SYSTEM_PROMPT = """You are a public health data analyst. You produce ONLY valid JSON \
matching the requested schema. You never invent numbers — if a figure is not in your \
search results, omit the field rather than guessing. Always prefer the most recent \
WHO Disease Outbreak News, CDC briefings, Africa CDC, Reuters, and AP reports."""


USER_TEMPLATE = """Search the web right now for the latest official figures on the \
2026 Ebola disease outbreak (Bundibugyo virus) affecting the Democratic Republic of \
the Congo (DRC) and Uganda.

Required sources (search at least 3):
  - WHO Disease Outbreak News (who.int)
  - US CDC (cdc.gov) Ebola situation summaries
  - Africa CDC briefings
  - Reuters or Associated Press wire reports
  - Government health ministry releases (DRC INRB, Uganda MoH)

Return a single JSON object with this exact shape, and nothing else:

{{
  "meta": {{
    "last_updated": "<ISO 8601 UTC timestamp of now>",
    "data_sources": ["<short labels of the sources you actually used>"]
  }},
  "totals": {{
    "confirmed": <int>,
    "suspected": <int>,
    "deaths": <int>,
    "health_zones_affected": <int>,
    "countries_with_cases": <int>,
    "healthcare_worker_deaths": <int>
  }},
  "locations": [
    {{
      "id": "<slug>",
      "name": "<city or health zone>",
      "region": "<province or region>",
      "country": "<DRC or Uganda or ...>",
      "lat": <float>,
      "lon": <float>,
      "status": "active" | "retracted" | "resolved",
      "tier": "epicenter" | "high" | "new" | "international" | "retracted",
      "first_reported": "YYYY-MM-DD",
      "notes": "<one-sentence description grounded in your sources>"
    }}
  ],
  "timeline_additions": [
    {{ "date": "YYYY-MM-DD", "event": "<concise event description, max 240 chars>" }}
  ],
  "alerts": [
    {{
      "level": "critical" | "warning" | "info",
      "title": "<short>",
      "body": "<one or two sentences>",
      "source": "<source label>",
      "url": "<canonical source URL>"
    }}
  ]
}}

Use "tier": "new" for any location first reported in the last 24 hours. Use \
"international" for locations outside DRC. Use "retracted" if a previously \
reported case has been disconfirmed.

For context, the previously reported totals (as of {prev_updated}) were:
{prev_totals}

Today's date is {today}. Do not include any commentary, markdown fences, or text \
outside the JSON. Output JSON only.
"""


def load_existing() -> dict:
    if DATA_PATH.exists():
        with DATA_PATH.open() as f:
            return json.load(f)
    return {}


def extract_json(text: str) -> dict:
    """Find the first JSON object in the model output and parse it."""
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    start = text.find("{")
    if start == -1:
        raise ValueError("No JSON object found in model output")
    depth = 0
    in_str = False
    esc = False
    end = -1
    for i, ch in enumerate(text[start:], start):
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    if end == -1:
        raise ValueError("Unterminated JSON object in model output")
    return json.loads(text[start:end])


def call_claude(existing: dict) -> dict:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise SystemExit("ANTHROPIC_API_KEY is not set")

    client = anthropic.Anthropic(api_key=api_key)

    prev_totals_dict = existing.get("totals", {})
    prev_totals = json.dumps(prev_totals_dict, indent=2) if prev_totals_dict else "(no prior data)"
    prev_updated = existing.get("meta", {}).get("last_updated", "(unknown)")
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    user_message = USER_TEMPLATE.format(
        prev_totals=prev_totals,
        prev_updated=prev_updated,
        today=today,
    )

    print(f"Calling {MODEL} with web search (max {MAX_SEARCH_USES} uses)…", flush=True)
    response = client.messages.create(
        model=MODEL,
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        tools=[
            {
                "type": "web_search_20250305",
                "name": "web_search",
                "max_uses": MAX_SEARCH_USES,
            }
        ],
        messages=[{"role": "user", "content": user_message}],
    )

    text_chunks = [block.text for block in response.content if getattr(block, "type", None) == "text"]
    raw = "\n".join(text_chunks).strip()
    if not raw:
        raise SystemExit("Model returned no text content")

    print("Received response. Parsing JSON…", flush=True)
    return extract_json(raw)


def merge(existing: dict, fresh: dict) -> dict:
    """Merge the fresh model output with the existing data file structure."""
    out = dict(existing) if existing else {}

    meta = out.get("meta", {})
    fresh_meta = fresh.get("meta", {})
    now = datetime.now(timezone.utc)
    next_update = now + timedelta(hours=4)
    meta.update({
        "last_updated": fresh_meta.get("last_updated") or now.isoformat(timespec="seconds"),
        "next_update": next_update.isoformat(timespec="seconds"),
        "data_sources": fresh_meta.get("data_sources") or meta.get("data_sources", []),
        "disease": meta.get("disease", "Ebola disease (Bundibugyo virus)"),
        "phase": meta.get("phase", "Public Health Emergency of International Concern (PHEIC)"),
        "declared_at": meta.get("declared_at", "2026-05-17T00:00:00Z"),
    })
    out["meta"] = meta

    out["totals_previous"] = {
        **(out.get("totals") or {}),
        "as_of": (out.get("meta", {}) or {}).get("last_updated"),
    }
    if "totals" in fresh:
        out["totals"] = fresh["totals"]

    if fresh.get("locations"):
        out["locations"] = fresh["locations"]

    if fresh.get("alerts"):
        out["alerts"] = fresh["alerts"]

    timeline = list(out.get("timeline") or [])
    existing_events = {(t.get("date"), t.get("event")) for t in timeline}
    for new_event in fresh.get("timeline_additions") or []:
        key = (new_event.get("date"), new_event.get("event"))
        if key not in existing_events and new_event.get("event"):
            timeline.append({"date": new_event["date"], "event": new_event["event"]})
    timeline.sort(key=lambda e: e.get("date") or "")
    out["timeline"] = timeline

    snapshots = list(out.get("history_snapshots") or [])
    today_iso = now.strftime("%Y-%m-%d")
    snapshots = [s for s in snapshots if s.get("date") != today_iso]
    t = out.get("totals") or {}
    snapshots.append({
        "date": today_iso,
        "confirmed": t.get("confirmed", 0),
        "suspected": t.get("suspected", 0),
        "deaths": t.get("deaths", 0),
        "health_zones": t.get("health_zones_affected", 0),
    })
    snapshots.sort(key=lambda s: s.get("date") or "")
    out["history_snapshots"] = snapshots

    return out


def main() -> int:
    existing = load_existing()
    try:
        fresh = call_claude(existing)
    except Exception as e:
        print(f"ERROR calling Claude: {e}", file=sys.stderr)
        return 1

    merged = merge(existing, fresh)

    DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    with DATA_PATH.open("w") as f:
        json.dump(merged, f, indent=2)
        f.write("\n")
    print(f"Wrote {DATA_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
