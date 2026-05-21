"""Fetch latest outbreak data using Claude's web search and write data/outbreak.json.

Designed to run from GitHub Actions twice daily (12:17 / 22:17 UTC).
Requires the ANTHROPIC_API_KEY environment variable.

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
MODEL = os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-6")
MAX_SEARCH_USES = int(os.environ.get("MAX_SEARCH_USES", "12"))
MAX_TOKENS = int(os.environ.get("MAX_TOKENS", "16000"))


SYSTEM_PROMPT = """You are a public health data analyst producing structured JSON \
for a live outbreak dashboard. You produce ONLY valid JSON matching the requested \
schema — no commentary, no markdown fences. You never invent numbers; if a figure is \
not in your search results, omit the field rather than guessing. You always \
cross-reference headline totals across multiple independent sources before committing \
them, preferring the most recent WHO Disease Outbreak News, CDC briefings, Africa \
CDC, government health ministry releases, and major wire services."""


USER_TEMPLATE = """Search the web for the latest official figures on the 2026 \
Ebola disease outbreak (Bundibugyo virus) in the Democratic Republic of the Congo \
(DRC) and Uganda — including any spread to additional countries.

CROSS-REFERENCE REQUIREMENT
You MUST consult at least 6 distinct sources, including AT LEAST 3 primary sources \
(WHO, CDC, Africa CDC, DRC MoH/INRB, Uganda MoH, or peer-reviewed publications). \
Only include a headline figure if it is confirmed by two or more independent \
sources, or by one authoritative primary source (WHO DON or Africa CDC briefing). \
Prefer the most recent authoritative figure.

Search across these source families (use whichever are most current and relevant):
  - Primary public health: who.int, cdc.gov, africacdc.org, ecdc.europa.eu, inrb.cd, health.go.ug, and the health ministry of any newly affected country
  - Scholarly & scientific: nejm.org, thelancet.com, nature.com, science.org, bmj.com, jamanetwork.com, plos.org, elifesciences.org, medrxiv.org, biorxiv.org, statnews.com, pubmed.ncbi.nlm.nih.gov
  - Wire services: reuters.com, apnews.com, afp.com, bloomberg.com
  - Major news: bbc.com, nytimes.com, washingtonpost.com, ft.com, cnn.com, nbcnews.com, aljazeera.com
  - UN system & humanitarian: news.un.org, reliefweb.int, ocha.org, unicef.org, msf.org

If the outbreak has spread beyond DRC and Uganda, search additionally for the most \
authoritative health agency in each newly affected country.

Return a SINGLE JSON object with this exact shape:

{{
  "meta": {{
    "last_updated": "<ISO 8601 UTC timestamp of now>",
    "data_sources": [
      "<source label> (<domain>, <YYYY-MM-DD>) <canonical URL>"
    ],
    "top_publications": ["<3-5 short publication names, e.g. WHO, CDC, Africa CDC, Reuters, The Lancet>"],
    "cross_references": {{
      "confirmations_for_totals": <int — how many independent sources confirmed the headline totals>,
      "primary_count": <int — how many primary sources (WHO/CDC/Africa CDC/MoH/scholarly) you consulted>,
      "wire_count": <int — wire/news sources consulted>,
      "scholarly_count": <int — peer-reviewed or scientific sources consulted, may be 0>,
      "notes": "<one short sentence about agreement or discrepancies between sources>"
    }}
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
      "country": "<country name>",
      "lat": <float>, "lon": <float>,
      "status": "active" | "retracted" | "resolved",
      "tier": "epicenter" | "high" | "new" | "international" | "retracted",
      "first_reported": "YYYY-MM-DD",
      "confirmed_cases": <int — confirmed cases AT THIS LOCATION, omit if unknown>,
      "suspected_cases": <int — suspected cases AT THIS LOCATION, omit if unknown. Some WHO/MoH bulletins DO publish suspected-case breakdowns by health zone — search for a SitRep, bulletin, or MoH dashboard that does, and only omit if no source reports per-location suspected.>,
      "deaths": <int — deaths AT THIS LOCATION, omit if unknown>,
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
  ],
  "news": [
    {{
      "title": "<headline, max 110 chars>",
      "summary": "<2-sentence summary, max 240 chars>",
      "source": "<publication name>",
      "url": "<canonical article URL>",
      "date": "<YYYY-MM-DD>",
      "tags": ["<short tag>", "..."]
    }}
  ],
  "historical_context": {{
    "background": {{
      "virus": "<verified or updated>",
      "family": "<verified>",
      "genus": "<verified>",
      "discovery": "<verified or updated>",
      "case_fatality_rate_historical": "<verified or updated, percentage range>",
      "transmission": "<verified or updated>",
      "incubation_days": "<verified or updated>",
      "symptoms": "<verified or updated>",
      "vaccines_therapeutics": "<CURRENT status, MAX 80 CHARS, e.g. 'None approved; rVSV-EBOV under emergency review'>"
    }},
    "past_outbreaks": [
      {{ "year": "<YYYY or YYYY-YYYY>", "location": "<country/region>", "cases": <int>, "deaths": <int>, "cfr": "<percentage>", "notes": "<one sentence>" }}
    ],
    "why_this_matters": ["<bullet>", "..."]
  }}
}}

Rules:
  - Provide 8–12 news items, dated within the last 7 days, sorted newest first.
  - Each news item must be from a distinct article (no duplicates across sources).
  - Tag news items with short labels like "WHO", "Confirmed case", "Vaccine", \
"Travel", "Containment", "Funding", "Research".
  - Use "tier": "new" for any location first reported in the last 24 hours. Use \
"international" for locations outside the country of origin. Use "retracted" for \
disconfirmed cases.
  - Omit any field for which you have no confirmed source rather than fabricating.
  - For historical_context: VERIFY the previous background facts against current \
authoritative sources. If something has changed (e.g. a vaccine candidate gained \
emergency approval, a new past-outbreak entry should be added, the consensus CFR \
has shifted), update it. Otherwise return the verified values unchanged. \
"why_this_matters" should reflect the CURRENT moment of the outbreak.
  - top_publications should list the 3-5 most prominent / most-cited publications \
this run, in order of authority and relevance.

PREVIOUS HISTORICAL CONTEXT (verify and update as needed):
{prev_history}

PREVIOUS TOTALS (as of {prev_updated}) for context:
{prev_totals}

Today's date is {today}. Output JSON only, no surrounding text or fences.
"""


HISTORY_PATH = ROOT / "data" / "history.json"


def load_existing() -> dict:
    if DATA_PATH.exists():
        with DATA_PATH.open() as f:
            return json.load(f)
    return {}


def load_history() -> dict:
    if HISTORY_PATH.exists():
        with HISTORY_PATH.open() as f:
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


def call_claude(existing: dict, prev_history: dict) -> dict:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise SystemExit("ANTHROPIC_API_KEY is not set")

    client = anthropic.Anthropic(api_key=api_key)

    prev_totals_dict = existing.get("totals", {})
    prev_totals = json.dumps(prev_totals_dict, indent=2) if prev_totals_dict else "(no prior data)"
    prev_updated = existing.get("meta", {}).get("last_updated", "(unknown)")
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # Prefer the model's most recent historical_context (kept in outbreak.json),
    # falling back to the static history.json on first run.
    prior_context = existing.get("historical_context") or prev_history or {}
    prev_history_str = json.dumps(prior_context, indent=2) if prior_context else "(none)"

    user_message = USER_TEMPLATE.format(
        prev_totals=prev_totals,
        prev_updated=prev_updated,
        prev_history=prev_history_str,
        today=today,
    )

    print(f"Calling {MODEL} with web search (max {MAX_SEARCH_USES} uses, {MAX_TOKENS} tokens)…", flush=True)
    response = client.messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
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

    block_types = [getattr(b, "type", "?") for b in response.content]
    print(f"stop_reason={response.stop_reason} block_types={block_types}", flush=True)
    if hasattr(response, "usage"):
        u = response.usage
        print(
            f"usage: input={getattr(u, 'input_tokens', '?')} "
            f"output={getattr(u, 'output_tokens', '?')} "
            f"server_tool_use={getattr(u, 'server_tool_use', None)}",
            flush=True,
        )

    text_chunks = [block.text for block in response.content if getattr(block, "type", None) == "text"]
    raw = "\n".join(text_chunks).strip()
    if not raw:
        for block in response.content:
            bt = getattr(block, "type", "?")
            if bt == "server_tool_use":
                q = getattr(getattr(block, "input", None), "get", lambda *_: None)("query") or ""
                print(f"  searched: {q}", flush=True)
        raise SystemExit(
            "Model returned no text content. "
            f"stop_reason={response.stop_reason}. "
            "If stop_reason=max_tokens, raise MAX_TOKENS. "
            "If stop_reason=pause_turn, the model needs another turn — increase MAX_SEARCH_USES limit or simplify the prompt."
        )

    print("Received response. Parsing JSON…", flush=True)
    return extract_json(raw)


def _next_scheduled_run(now: datetime) -> datetime:
    """Return the next scheduled cron firing time (12:17 or 22:17 UTC)."""
    candidates = [now.replace(hour=12, minute=17, second=0, microsecond=0),
                  now.replace(hour=22, minute=17, second=0, microsecond=0)]
    for c in candidates:
        if c > now:
            return c
    # both already passed today; next is tomorrow at 12:17 UTC
    return candidates[0] + timedelta(days=1)


def merge(existing: dict, fresh: dict) -> dict:
    """Merge the fresh model output with the existing data file structure."""
    out = dict(existing) if existing else {}

    prev_meta = dict(out.get("meta", {}))                 # snapshot BEFORE we mutate it
    prev_last_updated = prev_meta.get("last_updated")     # used for totals_previous.as_of

    meta = out.get("meta", {})
    fresh_meta = fresh.get("meta", {})
    now = datetime.now(timezone.utc)
    next_update = _next_scheduled_run(now)
    # Always use the actual script run time — the model is unreliable at
    # producing a current ISO 8601 timestamp ("now" is not in its context).
    meta.update({
        "last_updated": now.isoformat(timespec="seconds"),
        "next_update": next_update.isoformat(timespec="seconds"),
        "data_sources": fresh_meta.get("data_sources") or meta.get("data_sources", []),
        "disease": meta.get("disease", "Ebola disease (Bundibugyo virus)"),
        "phase": meta.get("phase", "Public Health Emergency of International Concern (PHEIC)"),
        "declared_at": meta.get("declared_at", "2026-05-17T00:00:00Z"),
    })
    if fresh_meta.get("top_publications"):
        meta["top_publications"] = fresh_meta["top_publications"]
    if fresh_meta.get("cross_references"):
        meta["cross_references"] = fresh_meta["cross_references"]
    out["meta"] = meta

    out["totals_previous"] = {
        **(out.get("totals") or {}),
        "as_of": prev_last_updated,
    }
    if "totals" in fresh:
        out["totals"] = fresh["totals"]

    if fresh.get("locations"):
        out["locations"] = fresh["locations"]

    if fresh.get("alerts"):
        out["alerts"] = fresh["alerts"]

    if fresh.get("news"):
        out["news"] = fresh["news"]

    if fresh.get("historical_context"):
        out["historical_context"] = fresh["historical_context"]

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
    prev_history = load_history()
    try:
        fresh = call_claude(existing, prev_history)
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
