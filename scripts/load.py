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
        "purchase_value", "raw"]
METRIC_COLS = ["campaign_name", "adset_name", "ad_name", "spend", "impressions",
               "clicks", "video_views", "video_plays", "thruplays", "purchases",
               "purchase_value", "raw"]
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


def has_thruplays(password):
    """Migration 0005 adds ad_daily.thruplays, but migrations are applied by
    the main session, not this repo - and the daily cron can run this code
    before the migration lands. Probe once per run and load without the
    column until it exists (old NDJSON has no `thruplays` key either, which
    r.get() below already tolerates)."""
    out = psql(password,
               "SELECT count(*) FROM information_schema.columns "
               "WHERE table_schema='public' AND table_name='ad_daily' "
               "AND column_name='thruplays';")
    return out.strip() == "1"


def load_platform(password, platform, day, cols, metric_cols):
    path = DATA_DIR / f"{platform}_{day}.ndjson"
    rows = [json.loads(l) for l in path.read_text().splitlines() if l.strip()]
    if not rows:
        raise RuntimeError(f"{path.name} exists but is empty")
    buf = io.StringIO()
    w = csv.writer(buf)
    for r in rows:
        w.writerow(["" if r.get(c) is None else
                    (json.dumps(r[c]) if c == "raw" else r[c]) for c in cols])
    with tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False) as f:
        f.write(buf.getvalue())
        csv_path = f.name
    try:
        updates = ", ".join(f"{c} = excluded.{c}" for c in metric_cols)
        psql(password, f"""
            BEGIN;
            CREATE TEMP TABLE stage (LIKE public.ad_daily INCLUDING DEFAULTS) ON COMMIT DROP;
            \\copy stage ({", ".join(cols)}) FROM '{csv_path}' WITH (FORMAT csv)
            INSERT INTO public.ad_daily AS t ({", ".join(cols)})
            SELECT {", ".join(cols)} FROM stage
            ON CONFLICT {CONFLICT}
            DO UPDATE SET {updates}, synced_at = now();
            COMMIT;
        """)
    finally:
        pathlib.Path(csv_path).unlink(missing_ok=True)
    return len(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=(dt.date.today() - dt.timedelta(days=1)).isoformat())
    ap.add_argument("--platforms", default="meta,tiktok,google")
    args = ap.parse_args()
    password = db_pass()
    failed = False

    cols, metric_cols = list(COLS), list(METRIC_COLS)
    try:
        if not has_thruplays(password):
            print("ad_daily.thruplays missing (migration 0005 not applied yet)"
                  " - loading without it", file=sys.stderr)
            cols.remove("thruplays")
            metric_cols.remove("thruplays")
    except Exception as e:
        print(f"thruplays probe failed ({e}) - loading without it", file=sys.stderr)
        cols.remove("thruplays")
        metric_cols.remove("thruplays")

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

    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
