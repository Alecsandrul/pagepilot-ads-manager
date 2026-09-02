#!/usr/bin/env python3
"""Budget snapshot sync -> NDJSON for public.entity_budgets.

Budgets are CURRENT entity attributes, not daily history (design note in
migration 0006): every run captures the full budget picture and the loader
replaces the entity_budgets table wholesale. One row per entity that OWNS a
budget at the level where it lives:

  meta   -> ad set daily_budget/lifetime_budget (minor units -> dollars);
            campaign budget for CBO campaigns. An ad set under CBO has no
            budget of its own and gets NO row (the UI derives "CBO").
  tiktok -> ad group budget (BUDGET_MODE_DAY daily / BUDGET_MODE_TOTAL
            lifetime; BUDGET_MODE_INFINITE owns nothing -> no row);
            campaign budget for CBO and Smart+ campaigns
            (BUDGET_MODE_DYNAMIC_DAILY_BUDGET counts as daily).
  google -> campaign budget, campaign_budget.amount_micros / 1e6, daily.

All three ad accounts bill in USD, so amounts are USD.

Usage:  sync_budgets.py [--date YYYY-MM-DD]
Output: data/budgets_<date>.ndjson + summary on stdout.
"""
import argparse
import datetime as dt
import json
import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import sync_google
import sync_meta
import sync_tiktok

DATA_DIR = pathlib.Path(__file__).resolve().parent.parent / "data"


def row(platform, level, entity_id, campaign_id, name, budget, budget_type):
    return {"platform": platform, "level": level, "entity_id": str(entity_id),
            "campaign_id": str(campaign_id) if campaign_id else None,
            "entity_name": name, "budget": budget, "budget_type": budget_type}


def fetch_meta(env):
    token = env["META_ADS_TOKEN"]
    rows = []
    data = sync_meta.get(f"{sync_meta.GRAPH}/{sync_meta.ACCOUNT}/campaigns", {
        "fields": "id,name,effective_status,daily_budget,lifetime_budget",
        "limit": 200, "access_token": token})
    for c in data.get("data", []):
        if c.get("effective_status") == "ARCHIVED":
            continue
        if c.get("daily_budget"):
            rows.append(row("meta", "campaign", c["id"], None, c.get("name"),
                            int(c["daily_budget"]) / 100, "daily"))
        elif c.get("lifetime_budget"):
            rows.append(row("meta", "campaign", c["id"], None, c.get("name"),
                            int(c["lifetime_budget"]) / 100, "lifetime"))
    # Ad set LIST calls are safe to paginate (the dev-tier silent-zero trap is
    # on paginated account-level INSIGHTS, see sync_meta.py) - but pause
    # between pages anyway.
    url = f"{sync_meta.GRAPH}/{sync_meta.ACCOUNT}/adsets"
    params = {"fields": "id,name,campaign_id,daily_budget,lifetime_budget,effective_status",
              "limit": 200, "access_token": token}
    while True:
        time.sleep(sync_meta.PAUSE_S)
        data = sync_meta.get(url, params)
        for a in data.get("data", []):
            if a.get("effective_status") == "ARCHIVED":
                continue
            if a.get("daily_budget"):
                rows.append(row("meta", "adset", a["id"], a.get("campaign_id"),
                                a.get("name"), int(a["daily_budget"]) / 100, "daily"))
            elif a.get("lifetime_budget"):
                rows.append(row("meta", "adset", a["id"], a.get("campaign_id"),
                                a.get("name"), int(a["lifetime_budget"]) / 100, "lifetime"))
        paging = data.get("paging", {})
        after = paging.get("cursors", {}).get("after")
        if not paging.get("next") or not after:
            return rows
        params["after"] = after


def _tiktok_pages(token, endpoint):
    page = 1
    while True:
        data = sync_tiktok.get(token, endpoint, {
            "advertiser_id": sync_tiktok.ADVERTISER, "page": page, "page_size": 100})
        yield from data.get("list", [])
        if page >= data.get("page_info", {}).get("total_page", 1):
            return
        page += 1


def _tiktok_budget_type(mode):
    if mode in ("BUDGET_MODE_DAY", "BUDGET_MODE_DYNAMIC_DAILY_BUDGET"):
        return "daily"
    if mode == "BUDGET_MODE_TOTAL":
        return "lifetime"
    return None  # BUDGET_MODE_INFINITE and friends: entity owns no budget


def fetch_tiktok(env):
    token = env["TIKTOK_ADS_TOKEN"]
    rows = []
    for c in _tiktok_pages(token, "/campaign/get/"):
        t = _tiktok_budget_type(c.get("budget_mode"))
        if t and float(c.get("budget") or 0) > 0:
            rows.append(row("tiktok", "campaign", c["campaign_id"], None,
                            c.get("campaign_name"), float(c["budget"]), t))
    for a in _tiktok_pages(token, "/adgroup/get/"):
        t = _tiktok_budget_type(a.get("budget_mode"))
        if t and float(a.get("budget") or 0) > 0:
            rows.append(row("tiktok", "adset", a["adgroup_id"], a.get("campaign_id"),
                            a.get("adgroup_name"), float(a["budget"]), t))
    return rows


def fetch_google(env):
    token = sync_google.access_token(env)
    rows = []
    for r in sync_google.search(env, token,
            "SELECT campaign.id, campaign.name, campaign_budget.amount_micros "
            "FROM campaign WHERE campaign.status != 'REMOVED'"):
        amount = int(r.get("campaignBudget", {}).get("amountMicros", 0)) / 1e6
        if amount > 0:
            c = r["campaign"]
            rows.append(row("google", "campaign", c["id"], None, c.get("name"),
                            amount, "daily"))
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=(dt.date.today() - dt.timedelta(days=1)).isoformat())
    args = ap.parse_args()
    env = sync_meta.load_env()
    DATA_DIR.mkdir(exist_ok=True)

    rows, failed = [], []
    for name, fn in (("meta", fetch_meta), ("tiktok", fetch_tiktok), ("google", fetch_google)):
        try:
            got = fn(env)
            rows.extend(got)
            print(f"budgets {name}: {len(got)} rows")
        except Exception as e:
            print(f"budgets {name}: FAILED {e}", file=sys.stderr)
            failed.append(name)
    if failed:
        # Partial snapshot would DELETE the failed platform's budgets on load.
        # All or nothing: refuse to write the file.
        print(f"budgets: not writing file, failed platforms: {failed}", file=sys.stderr)
        sys.exit(1)
    out = DATA_DIR / f"budgets_{args.date}.ndjson"
    out.write_text("".join(json.dumps(r) + "\n" for r in rows))
    print(f"budgets: {len(rows)} rows -> {out}")


if __name__ == "__main__":
    main()
