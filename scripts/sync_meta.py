#!/usr/bin/env python3
"""Meta daily ad sync -> NDJSON at AD grain.

Pulls yesterday (or --date / --days N backfill) from the Meta Insights API for
account act_3495944930639395 and writes rows matching public.ad_daily.

HARD CONSTRAINTS (memory: reference_meta_winners_promotion_workflow):
  * The token is development_access tier. Account-level ad insights WITH
    PAGINATION trips "Application request limit reached" and then silently
    returns $0 for everything. So: list campaigns once, then query insights
    PER CAMPAIGN with a pause between calls, and treat an all-zero day as a
    FAILURE (exit 1), never as data.
  * purchases = the `purchase` action type; purchase_value = its action_values
    entry. Meta's pixel CPA is ~6x inflated vs Stripe - a relative ranking,
    never revenue.
  * video_plays = video_play_actions (NOT the 3s view); video_views = the
    `video_view` action (3s). Hook rate = video_views / video_plays.

Usage:  sync_meta.py [--date YYYY-MM-DD] [--days N]
Output: data/meta_<date>.ndjson (one file per day) + summary on stdout.
"""
import argparse
import datetime as dt
import json
import pathlib
import sys
import time
import urllib.parse
import urllib.request

ENV_PATH = "/home/ubuntu/pagepilot-workspace/.env"
ACCOUNT = "act_3495944930639395"
GRAPH = "https://graph.facebook.com/v22.0"
DATA_DIR = pathlib.Path(__file__).resolve().parent.parent / "data"
PAUSE_S = 4  # between per-campaign insights calls (dev-tier rate limit)


def load_env(path=ENV_PATH):
    env = {}
    for line in pathlib.Path(path).read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    return env


def get(url, params):
    qs = urllib.parse.urlencode(params)
    with urllib.request.urlopen(f"{url}?{qs}", timeout=60) as r:
        return json.loads(r.read())


def action_value(items, action_type):
    for a in items or []:
        if a.get("action_type") == action_type:
            return float(a.get("value", 0))
    return None


def fetch_campaigns(token):
    """All non-archived campaigns. A paused campaign can still have spend on a
    past day, so do not filter to ACTIVE."""
    out, url, params = [], f"{GRAPH}/{ACCOUNT}/campaigns", {
        "fields": "id,name,effective_status",
        "limit": 200,
        "access_token": token,
    }
    data = get(url, params)
    out.extend(data.get("data", []))
    # One page of the campaign LIST is fine; the silent-zero trap is on
    # paginated account-level INSIGHTS. 200 covers this account (~dozens).
    if data.get("paging", {}).get("next"):
        print("WARN: >200 campaigns, list truncated", file=sys.stderr)
    return [c for c in out if c.get("effective_status") != "ARCHIVED"]


def fetch_day(token, campaigns, day):
    rows = []
    for i, camp in enumerate(campaigns):
        params = {
            "level": "ad",
            "fields": ("campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,"
                       "spend,impressions,clicks,actions,action_values,video_play_actions"),
            "time_range": json.dumps({"since": day, "until": day}),
            "limit": 500,
            "access_token": token,
        }
        data = get(f"{GRAPH}/{camp['id']}/insights", params)
        for r in data.get("data", []):
            spend = float(r.get("spend", 0))
            imps = int(r.get("impressions", 0))
            if spend == 0 and imps == 0:
                continue
            rows.append({
                "platform": "meta",
                "date": day,
                "campaign_id": r["campaign_id"],
                "campaign_name": r.get("campaign_name"),
                "adset_id": r.get("adset_id"),
                "adset_name": r.get("adset_name"),
                "ad_id": r.get("ad_id"),
                "ad_name": r.get("ad_name"),
                "spend": spend,
                "impressions": imps,
                "clicks": int(r.get("clicks", 0)),
                "video_views": (lambda v: int(v) if v is not None else None)(
                    action_value(r.get("actions"), "video_view")),
                "video_plays": (lambda v: int(v) if v is not None else None)(
                    action_value(r.get("video_play_actions"), "video_view")),
                "purchases": action_value(r.get("actions"), "purchase") or 0,
                "purchase_value": action_value(r.get("action_values"), "purchase"),
                "raw": r,
            })
        if i < len(campaigns) - 1:
            time.sleep(PAUSE_S)
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=(dt.date.today() - dt.timedelta(days=1)).isoformat())
    ap.add_argument("--days", type=int, default=1, help="backfill N days ending at --date")
    args = ap.parse_args()
    token = load_env()["META_ADS_TOKEN"]
    end = dt.date.fromisoformat(args.date)

    campaigns = fetch_campaigns(token)
    print(f"meta: {len(campaigns)} non-archived campaigns")
    DATA_DIR.mkdir(exist_ok=True)

    failed = False
    for d in range(args.days):
        day = (end - dt.timedelta(days=args.days - 1 - d)).isoformat()
        try:
            rows = fetch_day(token, campaigns, day)
        except Exception as e:
            print(f"meta {day}: FAILED {e}", file=sys.stderr)
            failed = True
            continue
        spend = sum(r["spend"] for r in rows)
        # Silent-zero guard: this account spends every day. All-zero = rate
        # limit lied to us, not a real quiet day. Do NOT write the file.
        if spend == 0:
            print(f"meta {day}: ALL-ZERO result ({len(rows)} rows) - treating as "
                  f"FAILURE (development_access silent-zero trap)", file=sys.stderr)
            failed = True
            continue
        out = DATA_DIR / f"meta_{day}.ndjson"
        out.write_text("".join(json.dumps(r) + "\n" for r in rows))
        print(f"meta {day}: {len(rows)} ad rows, spend ${spend:,.2f}, "
              f"purchases {sum(r['purchases'] for r in rows):.0f} -> {out}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
