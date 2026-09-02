#!/usr/bin/env python3
"""Google Ads daily sync -> NDJSON at CAMPAIGN grain.

Pulls yesterday (or --date / --days N backfill) via GAQL over
googleAds:search, REST v24, customer 8107170060 (direct, no login-customer-id).

HARD CONSTRAINTS (memory: reference_google_ads_api_access):
  * Valid REST versions are v22..v25 as of 2026-09-02. v16..v21 return a BARE
    HTML 404 that looks like a wrong URL or an IP block - it only means that
    version is retired. If this script starts 404ing, probe
    https://googleads.googleapis.com/$discovery/rest?version=vN and bump.
  * metrics.conversions POOLS signups with purchases - it is NOT purchases.
    Stored in `purchases` for schema uniformity; never compare Google CPA
    against Meta/TikTok purchase CPA until a purchase-only conversion action
    exists (none does as of 2026-09-02).
  * Campaign grain only: campaign stats are what we trust and every budget
    decision on this account is campaign level.

Usage:  sync_google.py [--date YYYY-MM-DD] [--days N]
Output: data/google_<date>.ndjson + summary on stdout.
"""
import argparse
import datetime as dt
import json
import pathlib
import sys
import urllib.parse
import urllib.request

ENV_PATH = "/home/ubuntu/pagepilot-workspace/.env"
CUSTOMER = "8107170060"
VERSION = "v24"
DATA_DIR = pathlib.Path(__file__).resolve().parent.parent / "data"


def load_env(path=ENV_PATH):
    env = {}
    for line in pathlib.Path(path).read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    return env


def access_token(env):
    body = urllib.parse.urlencode({
        "client_id": env["GOOGLE_ADS_CLIENT_ID"],
        "client_secret": env["GOOGLE_ADS_CLIENT_SECRET"],
        "refresh_token": env["GOOGLE_ADS_REFRESH_TOKEN"],
        "grant_type": "refresh_token",
    }).encode()
    req = urllib.request.Request("https://oauth2.googleapis.com/token", data=body)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())["access_token"]


def search(env, token, query):
    url = f"https://googleads.googleapis.com/{VERSION}/customers/{CUSTOMER}/googleAds:search"
    results, page_token = [], None
    while True:
        payload = {"query": query}
        if page_token:
            payload["pageToken"] = page_token
        req = urllib.request.Request(
            url, data=json.dumps(payload).encode(),
            headers={"Authorization": f"Bearer {token}",
                     "developer-token": env["GOOGLE_ADS_DEVELOPER_TOKEN"],
                     "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = json.loads(r.read())
        except urllib.error.HTTPError as e:
            body = e.read()[:300]
            if e.code == 404 and b"<html" in body.lower():
                raise RuntimeError(
                    f"bare HTML 404: REST {VERSION} likely retired, probe "
                    f"$discovery/rest?version=vN and bump VERSION") from e
            raise RuntimeError(f"HTTP {e.code}: {body}") from e
        results.extend(data.get("results", []))
        page_token = data.get("nextPageToken")
        if not page_token:
            return results


def fetch_day(env, token, day):
    query = f"""
        SELECT campaign.id, campaign.name, segments.date,
               metrics.cost_micros, metrics.impressions, metrics.clicks,
               metrics.conversions, metrics.conversions_value
        FROM campaign
        WHERE segments.date = '{day}'
    """
    rows = []
    for res in search(env, token, query):
        camp, m = res.get("campaign", {}), res.get("metrics", {})
        spend = int(m.get("costMicros", 0)) / 1e6
        imps = int(m.get("impressions", 0))
        if spend == 0 and imps == 0:
            continue
        rows.append({
            "platform": "google",
            "date": day,
            "campaign_id": str(camp.get("id")),
            "campaign_name": camp.get("name"),
            "adset_id": None,
            "adset_name": None,
            "ad_id": None,
            "ad_name": None,
            "spend": spend,
            "impressions": imps,
            "clicks": int(m.get("clicks", 0)),
            # metrics.video_views is UNRECOGNIZED on FROM campaign at v24
            # (verified 2026-09-02); video metrics need a video-specific report
            "video_views": None,
            "video_plays": None,
            # metrics.conversions = signups POOLED with purchases, NOT purchases
            "purchases": float(m.get("conversions", 0)),
            "purchase_value": float(m["conversionsValue"]) if "conversionsValue" in m else None,
            "raw": res,
        })
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=(dt.date.today() - dt.timedelta(days=1)).isoformat())
    ap.add_argument("--days", type=int, default=1, help="backfill N days ending at --date")
    args = ap.parse_args()
    env = load_env()
    token = access_token(env)
    end = dt.date.fromisoformat(args.date)
    DATA_DIR.mkdir(exist_ok=True)

    failed = False
    for d in range(args.days):
        day = (end - dt.timedelta(days=args.days - 1 - d)).isoformat()
        try:
            rows = fetch_day(env, token, day)
        except Exception as e:
            print(f"google {day}: FAILED {e}", file=sys.stderr)
            failed = True
            continue
        out = DATA_DIR / f"google_{day}.ndjson"
        out.write_text("".join(json.dumps(r) + "\n" for r in rows))
        print(f"google {day}: {len(rows)} campaign rows, "
              f"spend ${sum(r['spend'] for r in rows):,.2f}, "
              f"conversions(pooled) {sum(r['purchases'] for r in rows):.1f} -> {out}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
