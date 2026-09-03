#!/usr/bin/env python3
"""Entity list sync -> NDJSON for public.ad_entities (migration 0010).

ROOT CAUSE THIS EXISTS TO FIX (2026-09-03): every other sync in this repo
reads an INSIGHTS API, and insights only describe delivery. An ad that has
been built but has never spent returns no insights row at all, so it could
never reach ad_daily and could never appear in the dashboard. On 2026-09-03,
98 of 182 non-archived ads in the Meta Creative Testing campaign had never
appeared in ad_daily, including all 24 ads of batches 99 to 106 - built
2026-09-02, all PAUSED, all invisible.

This script pulls the ENTITY lists instead: what exists, its status, and when
it was created. No metrics. The loader replaces the table wholesale (same
snapshot model as sync_budgets.py / entity_budgets), because these are
current attributes, not history.

Levels use entity_budgets' vocabulary: campaign / adset / ad, where "adset"
covers Meta ad sets, TikTok ad groups and Google ad groups.

ARCHIVED / REMOVED entities are excluded on every platform. They are gone
from the account UI too, and including them would bury the live rows.

Usage:  sync_entities.py [--date YYYY-MM-DD]
Output: data/entities_<date>.ndjson + summary on stdout.
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


def row(platform, level, entity_id, name, campaign_id, adset_id, status,
        is_active, created_at):
    return {
        "platform": platform,
        "level": level,
        "entity_id": str(entity_id),
        "entity_name": name,
        "campaign_id": str(campaign_id) if campaign_id else None,
        "adset_id": str(adset_id) if adset_id else None,
        "status": status,
        "is_active": bool(is_active),
        "created_at": created_at,
    }


# ---------------------------------------------------------------- meta

def _meta_pages(token, edge, fields):
    """Paginate a Meta LIST edge. Safe to paginate: the development_access
    silent-zero trap documented in sync_meta.py is on paginated account level
    INSIGHTS, not on entity lists. Pause between pages regardless."""
    url = f"{sync_meta.GRAPH}/{sync_meta.ACCOUNT}/{edge}"
    params = {"fields": fields, "limit": 200, "access_token": token}
    first = True
    while True:
        if not first:
            time.sleep(sync_meta.PAUSE_S)
        first = False
        data = sync_meta.get(url, params)
        yield from data.get("data", [])
        paging = data.get("paging", {})
        after = paging.get("cursors", {}).get("after")
        if not paging.get("next") or not after:
            return
        params["after"] = after


# Meta effective_status values that can still DELIVER. WITH_ISSUES is the
# trap: it means "running, but something is wrong" (a rejected placement, a
# warning), not "stopped" - 9 entities in this account sat in it, and calling
# them inactive would have reported live spend under a dead looking pill.
# Everything else either cannot deliver (PAUSED, ADSET_PAUSED,
# CAMPAIGN_PAUSED, DISAPPROVED, PENDING_BILLING_INFO) or has not started yet
# (PENDING_REVIEW, IN_PROCESS, PREAPPROVED).
META_LIVE_STATUS = {"ACTIVE", "WITH_ISSUES"}


def fetch_meta(env):
    """Campaigns, ad sets and ads with effective_status and created_time.

    effective_status is the one that matters: an ad whose own status is ACTIVE
    but whose ad set is paused reports ADSET_PAUSED, and that is precisely the
    "why is my new ad not spending" answer the dashboard needs to show.
    """
    token = env["META_ADS_TOKEN"]
    rows = []
    for c in _meta_pages(token, "campaigns", "id,name,effective_status,created_time"):
        if c.get("effective_status") == "ARCHIVED":
            continue
        rows.append(row("meta", "campaign", c["id"], c.get("name"), None, None,
                        c.get("effective_status"),
                        c.get("effective_status") in META_LIVE_STATUS,
                        c.get("created_time")))
    for a in _meta_pages(token, "adsets",
                         "id,name,campaign_id,effective_status,created_time"):
        if a.get("effective_status") == "ARCHIVED":
            continue
        rows.append(row("meta", "adset", a["id"], a.get("name"),
                        a.get("campaign_id"), None, a.get("effective_status"),
                        a.get("effective_status") in META_LIVE_STATUS,
                        a.get("created_time")))
    for d in _meta_pages(token, "ads",
                         "id,name,campaign_id,adset_id,effective_status,created_time"):
        if d.get("effective_status") == "ARCHIVED":
            continue
        rows.append(row("meta", "ad", d["id"], d.get("name"),
                        d.get("campaign_id"), d.get("adset_id"),
                        d.get("effective_status"),
                        d.get("effective_status") in META_LIVE_STATUS,
                        d.get("created_time")))
    return rows


# -------------------------------------------------------------- tiktok

def _tiktok_pages(token, endpoint):
    page = 1
    while True:
        data = sync_tiktok.get(token, endpoint, {
            "advertiser_id": sync_tiktok.ADVERTISER, "page": page,
            "page_size": 100})
        yield from data.get("list", [])
        if page >= data.get("page_info", {}).get("total_page", 1):
            return
        page += 1


def _tiktok_active(item):
    """TikTok splits the user's own switch (operation_status: ENABLE/DISABLE)
    from the delivery verdict (secondary_status). Live means the switch is on
    AND the secondary status is not a not-delivering state.

    The secondary status already folds in the parents: an ad under a paused
    ad group reports AD_STATUS_ADGROUP_DISABLE, which is TikTok's equivalent
    of Meta's ADSET_PAUSED. Note REVIEW_PARTIALLY_APPROVED counts as live -
    it delivers on the placements that were approved."""
    if item.get("operation_status") != "ENABLE":
        return False
    sec = item.get("secondary_status") or ""
    return not any(bad in sec for bad in
                   ("DISABLE", "DELETE", "REJECT", "NOT_START", "TIME_DONE"))


def fetch_tiktok(env):
    token = env["TIKTOK_ADS_TOKEN"]
    rows = []
    for c in _tiktok_pages(token, "/campaign/get/"):
        if c.get("operation_status") == "DELETE":
            continue
        rows.append(row("tiktok", "campaign", c["campaign_id"],
                        c.get("campaign_name"), None, None,
                        c.get("secondary_status") or c.get("operation_status"),
                        _tiktok_active(c), c.get("create_time")))
    for a in _tiktok_pages(token, "/adgroup/get/"):
        if a.get("operation_status") == "DELETE":
            continue
        rows.append(row("tiktok", "adset", a["adgroup_id"],
                        a.get("adgroup_name"), a.get("campaign_id"), None,
                        a.get("secondary_status") or a.get("operation_status"),
                        _tiktok_active(a), a.get("create_time")))
    for d in _tiktok_pages(token, "/ad/get/"):
        if d.get("operation_status") == "DELETE":
            continue
        rows.append(row("tiktok", "ad", d["ad_id"], d.get("ad_name"),
                        d.get("campaign_id"), d.get("adgroup_id"),
                        d.get("secondary_status") or d.get("operation_status"),
                        _tiktok_active(d), d.get("create_time")))
    return rows


# -------------------------------------------------------------- google

def fetch_google(env):
    """Google has no created_time on campaign/ad_group/ad_group_ad in GAQL,
    so created_at stays null there and the UI falls back to status alone.

    Google's status fields are per level and do NOT fold in the parents (an
    ENABLED ad under a PAUSED campaign still reads ENABLED), unlike Meta's
    effective_status and TikTok's secondary_status. So is_active is derived
    here by walking the ancestors - otherwise the dashboard would call a
    plainly dead ad active.
    """
    token = sync_google.access_token(env)
    rows = []
    live_campaigns, live_groups = set(), set()

    for r in sync_google.search(env, token,
            "SELECT campaign.id, campaign.name, campaign.status "
            "FROM campaign WHERE campaign.status != 'REMOVED'"):
        c = r["campaign"]
        on = c.get("status") == "ENABLED"
        if on:
            live_campaigns.add(str(c["id"]))
        rows.append(row("google", "campaign", c["id"], c.get("name"), None,
                        None, c.get("status"), on, None))

    for r in sync_google.search(env, token,
            "SELECT ad_group.id, ad_group.name, ad_group.status, campaign.id "
            "FROM ad_group WHERE ad_group.status != 'REMOVED'"):
        g, camp = r["adGroup"], str(r["campaign"]["id"])
        on = g.get("status") == "ENABLED" and camp in live_campaigns
        if on:
            live_groups.add(str(g["id"]))
        rows.append(row("google", "adset", g["id"], g.get("name"), camp, None,
                        g.get("status"), on, None))

    for r in sync_google.search(env, token,
            "SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, "
            "ad_group_ad.status, ad_group.id, campaign.id "
            "FROM ad_group_ad WHERE ad_group_ad.status != 'REMOVED'"):
        ad, grp = r["adGroupAd"]["ad"], str(r["adGroup"]["id"])
        on = r["adGroupAd"].get("status") == "ENABLED" and grp in live_groups
        rows.append(row("google", "ad", ad["id"],
                        # Responsive search ads usually carry no name; the id
                        # is what ad_daily shows for them too.
                        ad.get("name") or f"Ad {ad['id']}",
                        r["campaign"]["id"], grp,
                        r["adGroupAd"].get("status"), on, None))
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date",
                    default=(dt.date.today() - dt.timedelta(days=1)).isoformat())
    ap.add_argument("--dry-run", action="store_true",
                    help="fetch and summarise, write no file")
    args = ap.parse_args()
    env = sync_meta.load_env()
    DATA_DIR.mkdir(exist_ok=True)

    rows, failed = [], []
    for name, fn in (("meta", fetch_meta), ("tiktok", fetch_tiktok),
                     ("google", fetch_google)):
        try:
            got = fn(env)
            rows.extend(got)
            live = sum(1 for r in got if r["is_active"])
            print(f"entities {name}: {len(got)} rows ({live} active)")
        except Exception as e:
            print(f"entities {name}: FAILED {e}", file=sys.stderr)
            failed.append(name)
    if failed:
        # Same all-or-nothing rule as sync_budgets.py: the loader REPLACES
        # the table, so a partial snapshot would silently delete the failed
        # platform's entities. Refuse to write the file.
        print(f"entities: not writing file, failed platforms: {failed}",
              file=sys.stderr)
        sys.exit(1)
    if args.dry_run:
        print(f"entities: DRY RUN, {len(rows)} rows, no file written")
        return
    out = DATA_DIR / f"entities_{args.date}.ndjson"
    out.write_text("".join(json.dumps(r) + "\n" for r in rows))
    print(f"entities: {len(rows)} rows -> {out}")


if __name__ == "__main__":
    main()
