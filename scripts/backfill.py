#!/usr/bin/env python3
"""Paced historical backfill driver. Rate-limit safety is the priority.

Runs platforms STRICTLY SEQUENTIALLY (default google -> tiktok -> meta), one
day at a time inside each platform, never two API processes at once. After a
platform finishes its days, its files are loaded into Supabase (one load.py
run per day, so sync_runs gets a row per platform-day), then the next
platform starts.

Throttle policy (per team-lead 2026-09-02):
  * A throttle response (Meta code 4/17/613 or "request limit", TikTok
    HTTP 429 / code 40100, Google RESOURCE_EXHAUSTED/429) DOUBLES the
    inter-day pause for the remainder of that platform's run.
  * 3 CONSECUTIVE throttles abort that platform (not the whole backfill);
    the remaining days are reported, not pushed through.
  * Meta's all-zero guard tripping is treated as a throttle: on the
    development_access tier a silent-zero IS the rate limiter lying.
  * A non-throttle failure is logged, its stderr saved to data/<p>_<d>.err
    (load.py turns that into a sync_runs error row), and the run continues.

Machine-greppable log markers: SYNC-OK SYNC-FAIL THROTTLE PLATFORM-ABORT
LOAD-FAIL HALFWAY PLATFORM-DONE BACKFILL-DONE.

Usage: backfill.py --start 2026-08-02 --end 2026-08-31 [--platforms google,tiktok,meta]
"""
import argparse
import datetime as dt
import pathlib
import re
import subprocess
import sys
import time

SCRIPTS = pathlib.Path(__file__).resolve().parent
DATA_DIR = SCRIPTS.parent / "data"

THROTTLE = {
    "meta": re.compile(r'"code"\s*:\s*(?:4|17|613)\b|request limit|too many calls|ALL-ZERO', re.I),
    "tiktok": re.compile(r'HTTP 429|"code"\s*:\s*40100|code 40100|too many request', re.I),
    "google": re.compile(r'RESOURCE_EXHAUSTED|HTTP 429|rate.?limit', re.I),
}
# Inter-day pauses, seconds. Doubled for the rest of a platform's run on any
# throttle. Meta gets the longest: its tier is the fragile one.
BASE_PAUSE = {"google": 20, "tiktok": 20, "meta": 45}


def log(msg):
    print(f"[{dt.datetime.now().isoformat(timespec='seconds')}] {msg}", flush=True)


def run(cmd, timeout=3600):
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    return p.returncode, p.stdout, p.stderr


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", required=True)
    ap.add_argument("--end", required=True)
    ap.add_argument("--platforms", default="google,tiktok,meta")
    args = ap.parse_args()
    start = dt.date.fromisoformat(args.start)
    end = dt.date.fromisoformat(args.end)
    days = [(start + dt.timedelta(days=i)).isoformat()
            for i in range((end - start).days + 1)]
    platforms = [p.strip() for p in args.platforms.split(",")]
    log(f"BACKFILL-START {len(days)} days {args.start}..{args.end} platforms={platforms}")

    overall_fail = False
    for platform in platforms:
        pause = BASE_PAUSE[platform]
        consecutive = 0
        aborted = False
        days_ok, days_fail = [], []
        for i, day in enumerate(days):
            rc, out, err = run([sys.executable, "-u",
                                str(SCRIPTS / f"sync_{platform}.py"), "--date", day])
            blob = out + "\n" + err
            throttled = THROTTLE[platform].search(blob) is not None
            if rc == 0 and not throttled:
                consecutive = 0
                tail = out.strip().splitlines()[-1] if out.strip() else ""
                log(f"SYNC-OK {platform} {day} | {tail}")
                days_ok.append(day)
            else:
                days_fail.append(day)
                (DATA_DIR / f"{platform}_{day}.err").write_text(blob[-2000:])
                if throttled:
                    consecutive += 1
                    pause *= 2
                    log(f"THROTTLE {platform} {day} consecutive={consecutive} "
                        f"pause_now={pause}s | {blob.strip()[-200:]}")
                    if consecutive >= 3:
                        remaining = days[i + 1:]
                        log(f"PLATFORM-ABORT {platform} 3 consecutive throttles; "
                            f"{len(remaining)} days not attempted: "
                            f"{remaining[0]}..{remaining[-1]}" if remaining else
                            f"PLATFORM-ABORT {platform} 3 consecutive throttles on final day")
                        aborted = True
                        break
                else:
                    consecutive = 0
                    log(f"SYNC-FAIL {platform} {day} | {blob.strip()[-200:]}")
            if i < len(days) - 1:
                time.sleep(pause)
            if (i + 1) == (len(days) + 1) // 2:
                log(f"HALFWAY {platform} {i + 1}/{len(days)} days")

        # Load this platform's results (attempted days only; days_fail get
        # their sync_runs error row from the .err file written above).
        loaded, load_errs = 0, 0
        for day in days_ok + days_fail:
            rc, out, err = run([sys.executable, str(SCRIPTS / "load.py"),
                                "--date", day, "--platforms", platform], timeout=600)
            if rc == 0:
                loaded += 1
            else:
                load_errs += 1
                log(f"LOAD-FAIL {platform} {day} | {(out + err).strip()[-200:]}")
            time.sleep(1)
        log(f"PLATFORM-DONE {platform} synced={len(days_ok)} sync_failed={len(days_fail)} "
            f"loaded={loaded} load_errors={load_errs} aborted={aborted} final_pause={pause}s")
        if aborted or days_fail or load_errs:
            overall_fail = True

    log(f"BACKFILL-DONE {'WITH-FAILURES' if overall_fail else 'CLEAN'}")
    sys.exit(1 if overall_fail else 0)


if __name__ == "__main__":
    main()
