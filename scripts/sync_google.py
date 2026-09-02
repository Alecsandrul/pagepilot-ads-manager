#!/usr/bin/env python3
"""Google Ads daily sync -> NDJSON at AD grain with campaign-grain fallback.

Pulls yesterday (or --date / --days N backfill) via GAQL over
googleAds:search, REST v24, customer 8107170060 (direct, no login-customer-id).

GRAIN (since 2026-09-02, Alex approved): ad_group_ad level, like Meta.
VERIFIED 2026-09-02 on this account: per-ad spend/impressions/conversions sum
EXACTLY to the campaign report for SEARCH and DEMAND_GEN campaigns. A
campaign whose ad rows do NOT cover its spend on a day (Performance Max
reports on asset groups, not ad_group_ad) falls back to ONE campaign-grain
row for that day - same pattern as TikTok Smart+. One grain per campaign-day,
never both; load.py additionally DELETEs a google day before inserting it so
a re-backfill replaces old campaign-grain rows instead of double counting.

PURCHASES (since 2026-09-02): the `browser_payment` conversion action ONLY,
selected via segments.conversion_action_name - NOT metrics.conversions.
VERIFIED 2026-09-02: metrics.conversions POOLS 'PagePilot (web)
store_creation' (ENGAGEMENT, often the larger share - Jan 2026: 1548.6 vs
576.1) with browser_payment; browser_payment is the account's only PURCHASE
action inside the metric. So `purchases`/`purchase_value` here are real
purchases, comparable with Meta, and rows get purchases_are_pooled = false
(plain column since migration 0007). Rows synced BEFORE this change hold
pooled metrics.conversions and keep purchases_are_pooled = true until the
google re-backfill replaces them.

HARD CONSTRAINTS (memory: reference_google_ads_api_access):
  * Valid REST versions are v22..v25 as of 2026-09-02. v16..v21 return a BARE
    HTML 404 that looks like a wrong URL or an IP block - it only means that
    version is retired. If this script starts 404ing, probe
    https://googleads.googleapis.com/$discovery/rest?version=vN and bump.
  * metrics.video_views is UNRECOGNIZED on FROM campaign at v24; video
    metrics and thruplays stay NULL for google.

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
PURCHASE_ACTION = "browser_payment"
# A campaign-day is "covered" by its ad rows when their spend matches the
# campaign figure within this tolerance (absolute, or 0.5% relative).
SPEND_TOLERANCE = 0.05
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


def _purchases(env, token, day, from_clause, id_path):
    """{entity_id: (purchases, value)} for browser_payment only."""
    out = {}
    # A segment used in WHERE must also be SELECTed (GAQL rule:
    # EXPECTED_REFERENCED_FIELD_IN_SELECT_CLAUSE).
    for res in search(env, token, f"""
        SELECT {id_path}, segments.conversion_action_name,
               metrics.conversions, metrics.conversions_value
        FROM {from_clause} WHERE segments.date = '{day}'
          AND segments.conversion_action_name = '{PURCHASE_ACTION}'"""):
        node = res
        for part in id_path.split(".")[:-1]:
            key = {"ad_group_ad": "adGroupAd"}.get(part, part)
            node = node[key]
        m = res.get("metrics", {})
        out[str(node["id"])] = (float(m.get("conversions", 0)),
                                float(m.get("conversionsValue", 0)))
    return out


def _base_row(day):
    return {"platform": "google", "date": day, "video_views": None,
            "video_plays": None, "thruplays": None,
            "purchases_are_pooled": False}


def fetch_day(env, token, day):
    # 1. Campaign grain: baseline totals for coverage checks + fallback rows.
    camp = {}
    for res in search(env, token, f"""
        SELECT campaign.id, campaign.name, metrics.cost_micros,
               metrics.impressions, metrics.clicks
        FROM campaign WHERE segments.date = '{day}'"""):
        c, m = res["campaign"], res.get("metrics", {})
        camp[str(c["id"])] = {
            "name": c.get("name"),
            "spend": int(m.get("costMicros", 0)) / 1e6,
            "impressions": int(m.get("impressions", 0)),
            "clicks": int(m.get("clicks", 0)),
            "raw": res,
        }

    # 2. Ad grain: spend/imps/clicks per ad.
    by_camp = {}
    for res in search(env, token, f"""
        SELECT campaign.id, ad_group.id, ad_group.name,
               ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type,
               metrics.cost_micros, metrics.impressions, metrics.clicks
        FROM ad_group_ad WHERE segments.date = '{day}'"""):
        m, ad, ag = res.get("metrics", {}), res["adGroupAd"]["ad"], res["adGroup"]
        cid = str(res["campaign"]["id"])
        by_camp.setdefault(cid, []).append({
            "adset_id": str(ag["id"]),
            "adset_name": ag.get("name"),
            "ad_id": str(ad["id"]),
            # RSAs usually have no ad.name; fall back to the ad type so the
            # row is still recognizable.
            "ad_name": ad.get("name") or ad.get("type"),
            "spend": int(m.get("costMicros", 0)) / 1e6,
            "impressions": int(m.get("impressions", 0)),
            "clicks": int(m.get("clicks", 0)),
            "raw": res,
        })

    # 3. Purchases (browser_payment only) at both grains.
    ad_purch = _purchases(env, token, day, "ad_group_ad", "ad_group_ad.ad.id")
    camp_purch = _purchases(env, token, day, "campaign", "campaign.id")

    rows, fallbacks = [], []
    for cid, c in camp.items():
        cp = camp_purch.get(cid, (0.0, 0.0))
        if c["spend"] == 0 and c["impressions"] == 0 and cp[0] == 0:
            continue
        c_ads = by_camp.get(cid, [])
        ad_spend = sum(x["spend"] for x in c_ads)
        covered = bool(c_ads) and abs(ad_spend - c["spend"]) <= max(
            SPEND_TOLERANCE, 0.005 * c["spend"])
        if covered:
            for x in c_ads:
                p = ad_purch.get(x["ad_id"], (0.0, 0.0))
                if x["spend"] == 0 and x["impressions"] == 0 and p[0] == 0:
                    continue
                x["raw"]["browser_payment"] = {"conversions": p[0], "value": p[1]}
                rows.append({**_base_row(day), "campaign_id": cid,
                             "campaign_name": c["name"], **{k: x[k] for k in
                             ("adset_id", "adset_name", "ad_id", "ad_name",
                              "spend", "impressions", "clicks", "raw")},
                             "purchases": p[0],
                             "purchase_value": p[1] if p[0] > 0 else None})
        else:
            fallbacks.append(cid)
            c["raw"]["browser_payment"] = {"conversions": cp[0], "value": cp[1]}
            rows.append({**_base_row(day), "campaign_id": cid,
                         "campaign_name": c["name"], "adset_id": None,
                         "adset_name": None, "ad_id": None, "ad_name": None,
                         "spend": c["spend"], "impressions": c["impressions"],
                         "clicks": c["clicks"], "purchases": cp[0],
                         "purchase_value": cp[1] if cp[0] > 0 else None,
                         "raw": c["raw"]})
    return rows, fallbacks


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
            rows, fallbacks = fetch_day(env, token, day)
        except Exception as e:
            print(f"google {day}: FAILED {e}", file=sys.stderr)
            failed = True
            continue
        out = DATA_DIR / f"google_{day}.ndjson"
        out.write_text("".join(json.dumps(r) + "\n" for r in rows))
        n_fb = sum(1 for r in rows if r["ad_id"] is None)
        fb = f", campaign-grain fallback: {fallbacks}" if fallbacks else ""
        print(f"google {day}: {len(rows)} rows ({len(rows)-n_fb} ad grain, "
              f"{n_fb} fallback), spend ${sum(r['spend'] for r in rows):,.2f}, "
              f"purchases {sum(r['purchases'] for r in rows):.1f} -> {out}{fb}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
