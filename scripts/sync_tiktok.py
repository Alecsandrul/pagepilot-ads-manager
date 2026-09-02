#!/usr/bin/env python3
"""TikTok daily ad sync -> NDJSON at MIXED grain.

Pulls yesterday (or --date / --days N backfill) from
/open_api/v1.3/report/integrated/get/ for advertiser 7567330229333770256.

GRAIN: manual campaigns at AD level (AUCTION_AD), Smart+ campaigns at
CAMPAIGN level (AUCTION_CAMPAIGN) because Smart+ reports oddly at ad level
(auto-generated ad shells with unstable ids). Both levels are pulled for the
whole account and split locally by the campaign's Smart+ flag.

HARD CONSTRAINTS (memory: reference_tiktok_ad_copy_2026_08_11):
  * purchases = `complete_payment`, NEVER `conversion` - 133 adgroups optimize
    toward ON_WEB_ORDER which does not fire; `conversion` was 0 for May-Jul
    2026 while $52k was spent. complete_payment only registers from Apr 2026.
  * video_plays = video_play_actions (NOT the 3s play, memory
    reference_martynas_results_format); video_views = video_watched_2s.
  * purchase_value stays NULL - no trustworthy value metric on this account.

Usage:  sync_tiktok.py [--date YYYY-MM-DD] [--days N]
Output: data/tiktok_<date>.ndjson + summary on stdout.
"""
import argparse
import datetime as dt
import json
import pathlib
import sys
import urllib.parse
import urllib.request

ENV_PATH = "/home/ubuntu/pagepilot-workspace/.env"
ADVERTISER = "7567330229333770256"
BASE = "https://business-api.tiktok.com/open_api/v1.3"
DATA_DIR = pathlib.Path(__file__).resolve().parent.parent / "data"


def load_env(path=ENV_PATH):
    env = {}
    for line in pathlib.Path(path).read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    return env


def get(token, endpoint, params):
    qs = urllib.parse.urlencode(params)
    req = urllib.request.Request(f"{BASE}{endpoint}?{qs}",
                                 headers={"Access-Token": token})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.loads(r.read())
    except urllib.error.HTTPError as e:
        # Surface status + body: HTTP 429 / code 40100 are the throttle
        # markers the backfill driver greps stderr for.
        raise RuntimeError(f"HTTP {e.code}: {e.read().decode(errors='replace')[:400]}") from None
    if data.get("code") != 0:
        raise RuntimeError(f"{endpoint}: code {data.get('code')} {data.get('message')}")
    return data["data"]


def fetch_campaign_flags(token):
    """campaign_id -> is_smart_plus.

    VERIFIED 2026-09-02 on this account: a Smart+ campaign returns
    campaign_automation_type "UPGRADED_SMART_PLUS" while
    is_smart_performance_campaign stays FALSE. So the automation-type field is
    the real signal; match SMART anywhere in the value, not as a prefix."""
    flags, page = {}, 1
    while True:
        data = get(token, "/campaign/get/", {
            "advertiser_id": ADVERTISER, "page": page, "page_size": 100})
        for c in data.get("list", []):
            smart = bool(c.get("is_smart_performance_campaign"))
            if not smart:
                for k, v in c.items():
                    if k.endswith("automation_type") and isinstance(v, str) \
                            and "SMART" in v.upper():
                        smart = True
            flags[str(c["campaign_id"])] = smart
        info = data.get("page_info", {})
        if page >= info.get("total_page", 1):
            return flags
        page += 1


def fetch_report(token, level, dims, id_metrics, day):
    metrics = id_metrics + ["spend", "impressions", "clicks",
                            "video_play_actions", "video_watched_2s",
                            "complete_payment"]
    rows, page = [], 1
    while True:
        data = get(token, "/report/integrated/get/", {
            "advertiser_id": ADVERTISER,
            "report_type": "BASIC",
            "data_level": level,
            "dimensions": json.dumps(dims),
            "metrics": json.dumps(metrics),
            "start_date": day, "end_date": day,
            "page": page, "page_size": 1000,
        })
        rows.extend(data.get("list", []))
        info = data.get("page_info", {})
        if page >= info.get("total_page", 1):
            return rows
        page += 1


def to_row(day, dims, m, grain):
    return {
        "platform": "tiktok",
        "date": day,
        "campaign_id": str(m.get("campaign_id") or dims.get("campaign_id")),
        "campaign_name": m.get("campaign_name"),
        "adset_id": str(dims["adgroup_id"]) if grain == "ad" and dims.get("adgroup_id") else
                    (str(m["adgroup_id"]) if grain == "ad" and m.get("adgroup_id") else None),
        "adset_name": m.get("adgroup_name") if grain == "ad" else None,
        "ad_id": str(dims.get("ad_id")) if grain == "ad" else None,
        "ad_name": m.get("ad_name") if grain == "ad" else None,
        "spend": float(m.get("spend", 0)),
        "impressions": int(m.get("impressions", 0)),
        "clicks": int(m.get("clicks", 0)),
        "video_views": int(m.get("video_watched_2s", 0)),
        "video_plays": int(m.get("video_play_actions", 0)),
        "purchases": float(m.get("complete_payment", 0)),
        "purchase_value": None,  # no trustworthy value metric here
        "raw": {"dimensions": dims, "metrics": m},
    }


def fetch_day(token, smart_flags, day):
    rows = []
    # Manual campaigns: AD grain
    for item in fetch_report(token, "AUCTION_AD", ["ad_id", "stat_time_day"],
                             ["campaign_id", "campaign_name", "adgroup_id",
                              "adgroup_name", "ad_name"], day):
        m, dims = item["metrics"], item["dimensions"]
        if smart_flags.get(str(m.get("campaign_id")), False):
            continue  # Smart+ handled at campaign grain below
        r = to_row(day, dims, m, "ad")
        if r["spend"] > 0 or r["impressions"] > 0:
            rows.append(r)
    # Smart+ campaigns: CAMPAIGN grain
    for item in fetch_report(token, "AUCTION_CAMPAIGN",
                             ["campaign_id", "stat_time_day"],
                             ["campaign_name"], day):
        m, dims = item["metrics"], item["dimensions"]
        if not smart_flags.get(str(dims.get("campaign_id")), False):
            continue
        r = to_row(day, dims, m, "campaign")
        if r["spend"] > 0 or r["impressions"] > 0:
            rows.append(r)
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=(dt.date.today() - dt.timedelta(days=1)).isoformat())
    ap.add_argument("--days", type=int, default=1, help="backfill N days ending at --date")
    args = ap.parse_args()
    token = load_env()["TIKTOK_ADS_TOKEN"]
    end = dt.date.fromisoformat(args.date)

    smart_flags = fetch_campaign_flags(token)
    n_smart = sum(smart_flags.values())
    print(f"tiktok: {len(smart_flags)} campaigns, {n_smart} Smart+")
    DATA_DIR.mkdir(exist_ok=True)

    failed = False
    for d in range(args.days):
        day = (end - dt.timedelta(days=args.days - 1 - d)).isoformat()
        try:
            rows = fetch_day(token, smart_flags, day)
        except Exception as e:
            print(f"tiktok {day}: FAILED {e}", file=sys.stderr)
            failed = True
            continue
        spend = sum(r["spend"] for r in rows)
        out = DATA_DIR / f"tiktok_{day}.ndjson"
        out.write_text("".join(json.dumps(r) + "\n" for r in rows))
        n_camp = sum(1 for r in rows if r["ad_id"] is None)
        print(f"tiktok {day}: {len(rows)} rows ({len(rows)-n_camp} ad-grain, "
              f"{n_camp} Smart+ campaign-grain), spend ${spend:,.2f}, "
              f"payments {sum(r['purchases'] for r in rows):.0f} -> {out}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
