#!/usr/bin/env python3
"""Load NDJSON sync output into Supabase (ad_daily) and record sync_runs.

For each requested platform, reads data/<platform>_<date>.ndjson and upserts
into public.ad_daily on the grain key
  (platform, date, campaign_id, COALESCE(adset_id,''), COALESCE(ad_id,''))
updating metrics + raw + synced_at on conflict.

EVERY platform gets a sync_runs row, success OR failure - a missing NDJSON
file (sync crashed or refused to write an all-zero day) is recorded as
status='error', never skipped silently. If data/<platform>_<date>.err exists
(written by daily_sync.sh from the sync's stderr) its tail goes into the
error column.

Uses psql + \\copy through a staging temp table: no Python DB driver exists
on this box (PEP 668 blocks pip) and psql handles CSV escaping/quoting
natively. Empty CSV fields become NULL (psql CSV default), which is what the
nullable columns want.

Usage:  load.py [--date YYYY-MM-DD] [--platforms meta,tiktok,google]
Exit 1 if any platform failed to load.
"""
import argparse
import csv
import datetime as dt
import io
import json
import pathlib
import subprocess
import sys
import tempfile

ENV_PATH = "/home/ubuntu/pagepilot-workspace/.env"
DB_HOST = "db.xtrapxzbfuovnutldete.supabase.co"
DATA_DIR = pathlib.Path(__file__).resolve().parent.parent / "data"

COLS = ["platform", "date", "campaign_id", "campaign_name", "adset_id",
        "adset_name", "ad_id", "ad_name", "spend", "impressions", "clicks",
        "video_views", "video_plays", "thruplays", "purchases",
        "purchase_value", "purchases_are_pooled", "raw"]
METRIC_COLS = ["campaign_name", "adset_name", "ad_name", "spend", "impressions",
               "clicks", "video_views", "video_plays", "thruplays", "purchases",
               "purchase_value", "purchases_are_pooled", "raw"]
# Columns that may not be writable yet: thruplays arrives with migration
# 0005, purchases_are_pooled is a GENERATED column until 0007 recreates it
# as plain. Migrations are applied by the main session, not this repo, and
# the daily cron can run this code first - so probe and drop as needed.
OPTIONAL_COLS = ["thruplays", "purchases_are_pooled"]
BUDGET_COLS = ["platform", "level", "entity_id", "campaign_id", "entity_name",
               "budget", "budget_type"]
CONFLICT = "(platform, date, campaign_id, COALESCE(adset_id,''), COALESCE(ad_id,''))"


def db_pass():
    for line in pathlib.Path(ENV_PATH).read_text().splitlines():
        if line.startswith("ADSMGR_SYNC_PASS="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("ADSMGR_SYNC_PASS missing from .env")


def psql(password, sql_script):
    """Run a psql script; raise with stderr on any error."""
    p = subprocess.run(
        ["psql", "-h", DB_HOST, "-p", "5432", "-U", "ads_sync", "-d", "postgres",
         "-v", "ON_ERROR_STOP=1", "-qAt", "-f", "-"],
        input=sql_script, capture_output=True, text=True, timeout=300,
        env={"PGPASSWORD": password, "PGCONNECT_TIMEOUT": "15",
             "PATH": "/usr/bin:/bin"})
    if p.returncode != 0:
        raise RuntimeError(p.stderr.strip()[-500:] or f"psql exit {p.returncode}")
    return p.stdout


def sql_str(s):
    return "'" + str(s).replace("'", "''") + "'"


def record_run(password, platform, started, status, rows, error):
    psql(password, f"""
        INSERT INTO public.sync_runs (platform, started_at, finished_at, status, rows_written, error)
        VALUES ({sql_str(platform)}, {sql_str(started)}, now(), {sql_str(status)},
                {rows if rows is not None else 'NULL'},
                {sql_str(error[:2000]) if error else 'NULL'});
    """)


def ad_daily_writable_cols(password):
    """Names of public.ad_daily columns the loader may write (present and
    not GENERATED). See OPTIONAL_COLS: probed once per run so this code is
    safe on either side of migrations 0005 and 0007."""
    out = psql(password,
               "SELECT column_name || ':' || is_generated "
               "FROM information_schema.columns "
               "WHERE table_schema='public' AND table_name='ad_daily';")
    info = dict(l.split(":", 1) for l in out.strip().splitlines() if ":" in l)
    return {c for c, gen in info.items() if gen == "NEVER"}


def budgets_table_exists(password):
    out = psql(password,
               "SELECT count(*) FROM information_schema.tables "
               "WHERE table_schema='public' AND table_name='entity_budgets';")
    return out.strip() == "1"


def load_platform(password, platform, day, cols, metric_cols):
    path = DATA_DIR / f"{platform}_{day}.ndjson"
    rows = [json.loads(l) for l in path.read_text().splitlines() if l.strip()]
    if not rows:
        raise RuntimeError(f"{path.name} exists but is empty")
    buf = io.StringIO()
    w = csv.writer(buf)

    def cell(r, c):
        v = r.get(c)
        # purchases_are_pooled is NOT NULL: NDJSON written before 2026-09-02
        # lacks the key, and those rows were not pooled (meta/tiktok) - with
        # ONE trap: a PRE-0007 google NDJSON re-loaded WITHOUT re-syncing
        # would be mislabeled false. The google re-backfill replaces those
        # files, so never re-load an old google file by itself.
        if c == "purchases_are_pooled" and v is None:
            return "false"
        if v is None:
            return ""
        if isinstance(v, bool):
            return "true" if v else "false"
        return json.dumps(v) if c == "raw" else v

    for r in rows:
        w.writerow([cell(r, c) for c in cols])
    with tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False) as f:
        f.write(buf.getvalue())
        csv_path = f.name
    try:
        updates = ", ".join(f"{c} = excluded.{c}" for c in metric_cols)
        # Google changed grain on 2026-09-02 (campaign -> ad): old and new
        # rows share no conflict key, so an upsert alone would DOUBLE COUNT
        # a re-loaded day. Google days are therefore REPLACED wholesale
        # (delete + insert, one transaction); a google sync always emits the
        # full day. Meta/TikTok keep pure upserts.
        delete_day = (f"DELETE FROM public.ad_daily "
                      f"WHERE platform='google' AND date='{day}';"
                      if platform == "google" else "")
        psql(password, f"""
            BEGIN;
            CREATE TEMP TABLE stage (LIKE public.ad_daily INCLUDING DEFAULTS) ON COMMIT DROP;
            \\copy stage ({", ".join(cols)}) FROM '{csv_path}' WITH (FORMAT csv)
            {delete_day}
            INSERT INTO public.ad_daily AS t ({", ".join(cols)})
            SELECT {", ".join(cols)} FROM stage
            ON CONFLICT {CONFLICT}
            DO UPDATE SET {updates}, synced_at = now();
            COMMIT;
        """)
    finally:
        pathlib.Path(csv_path).unlink(missing_ok=True)
    return len(rows)


def load_budgets(password, day):
    """Full replace of entity_budgets from the day's snapshot."""
    path = DATA_DIR / f"budgets_{day}.ndjson"
    rows = [json.loads(l) for l in path.read_text().splitlines() if l.strip()]
    if not rows:
        raise RuntimeError(f"{path.name} exists but is empty")
    buf = io.StringIO()
    w = csv.writer(buf)
    for r in rows:
        w.writerow(["" if r.get(c) is None else r[c] for c in BUDGET_COLS])
    with tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False) as f:
        f.write(buf.getvalue())
        csv_path = f.name
    try:
        psql(password, f"""
            BEGIN;
            CREATE TEMP TABLE bstage (LIKE public.entity_budgets INCLUDING DEFAULTS) ON COMMIT DROP;
            \\copy bstage ({", ".join(BUDGET_COLS)}) FROM '{csv_path}' WITH (FORMAT csv)
            DELETE FROM public.entity_budgets;
            INSERT INTO public.entity_budgets ({", ".join(BUDGET_COLS)})
            SELECT {", ".join(BUDGET_COLS)} FROM bstage;
            COMMIT;
        """)
    finally:
        pathlib.Path(csv_path).unlink(missing_ok=True)
    return len(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=(dt.date.today() - dt.timedelta(days=1)).isoformat())
    ap.add_argument("--platforms", default="meta,tiktok,google")
    # Budgets are a CURRENT snapshot tied to the daily run, not to the day
    # being (re)loaded. "require" (daily_sync.sh): a missing snapshot is a
    # recorded sync_runs error. "auto" (backfill.py and manual re-loads of
    # historic days): load the file if present, otherwise skip with a note -
    # the 2026-09-03 backfill recorded 92 bogus budgets ERROR rows because
    # the old behavior demanded a budgets file for every historic date.
    ap.add_argument("--budgets", choices=["auto", "require"], default="auto")
    args = ap.parse_args()
    password = db_pass()
    failed = False

    cols, metric_cols = list(COLS), list(METRIC_COLS)
    try:
        writable = ad_daily_writable_cols(password)
        drop = [c for c in OPTIONAL_COLS if c not in writable]
    except Exception as e:
        print(f"column probe failed ({e}) - loading base columns only", file=sys.stderr)
        drop = list(OPTIONAL_COLS)
    for c in drop:
        print(f"ad_daily.{c} not writable yet (migration pending) - loading "
              f"without it", file=sys.stderr)
        cols.remove(c)
        metric_cols.remove(c)

    for platform in args.platforms.split(","):
        platform = platform.strip()
        started = dt.datetime.now(dt.timezone.utc).isoformat()
        path = DATA_DIR / f"{platform}_{args.date}.ndjson"
        if not path.exists():
            err_file = DATA_DIR / f"{platform}_{args.date}.err"
            detail = err_file.read_text()[-800:] if err_file.exists() else \
                "no stderr captured - sync never ran or wrote nothing"
            msg = f"NDJSON missing: sync failed or refused an all-zero day. {detail}"
            print(f"{platform} {args.date}: ERROR {msg}", file=sys.stderr)
            try:
                record_run(password, platform, started, "error", None, msg)
            except Exception as e:
                print(f"{platform}: could not even record sync_runs: {e}", file=sys.stderr)
            failed = True
            continue
        try:
            n = load_platform(password, platform, args.date, cols, metric_cols)
            record_run(password, platform, started, "success", n, None)
            print(f"{platform} {args.date}: upserted {n} rows")
        except Exception as e:
            print(f"{platform} {args.date}: LOAD FAILED {e}", file=sys.stderr)
            try:
                record_run(password, platform, started, "error", None, str(e))
            except Exception as e2:
                print(f"{platform}: could not even record sync_runs: {e2}", file=sys.stderr)
            failed = True

    # Budgets snapshot -> entity_budgets (migration 0006): full replace,
    # budgets are current attributes, not history. Gated on the table
    # existing so this code is safe to run before the migration lands.
    bpath = DATA_DIR / f"budgets_{args.date}.ndjson"
    try:
        have_budgets = budgets_table_exists(password)
    except Exception as e:
        have_budgets = False
        print(f"budgets: table probe failed ({e})", file=sys.stderr)
    if have_budgets:
        started = dt.datetime.now(dt.timezone.utc).isoformat()
        if not bpath.exists() and args.budgets == "auto":
            print(f"budgets: no snapshot for {args.date} (--budgets auto) - skipped",
                  file=sys.stderr)
        elif not bpath.exists():
            err_file = DATA_DIR / f"budgets_{args.date}.err"
            detail = err_file.read_text()[-800:] if err_file.exists() else \
                "no stderr captured - sync_budgets never ran or wrote nothing"
            msg = f"budgets NDJSON missing: sync_budgets failed. {detail}"
            print(f"budgets {args.date}: ERROR {msg}", file=sys.stderr)
            try:
                record_run(password, "budgets", started, "error", None, msg)
            except Exception as e:
                print(f"budgets: could not record sync_runs: {e}", file=sys.stderr)
            failed = True
        else:
            try:
                n = load_budgets(password, args.date)
                record_run(password, "budgets", started, "success", n, None)
                print(f"budgets {args.date}: replaced entity_budgets, {n} rows")
            except Exception as e:
                print(f"budgets {args.date}: LOAD FAILED {e}", file=sys.stderr)
                try:
                    record_run(password, "budgets", started, "error", None, str(e))
                except Exception as e2:
                    print(f"budgets: could not record sync_runs: {e2}", file=sys.stderr)
                failed = True
    elif bpath.exists():
        print("budgets: entity_budgets table missing (migration 0006 not "
              "applied) - snapshot left unloaded", file=sys.stderr)

    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
