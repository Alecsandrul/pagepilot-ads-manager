#!/usr/bin/env bash
# Daily ads sync: pull yesterday from Meta, TikTok, Google, then load into
# Supabase. Designed for cron (installed by the main session, NOT here), e.g.
#   30 6 * * * /home/ubuntu/projects/pagepilot-ads-manager/scripts/daily_sync.sh >> /home/ubuntu/projects/pagepilot-ads-manager/data/daily_sync.log 2>&1
#
# Platforms run STAGGERED with off-minute pauses between them so we never
# open three API bursts at once (Meta's development_access tier is the
# fragile one). A failed sync does NOT stop the others; load.py records a
# sync_runs error row for any platform whose NDJSON is missing - failures
# are visible in the DB, never a silent zero.

set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATE="${1:-$(date -d yesterday +%F)}"
FAILED=0

echo "=== daily_sync $DATE start $(date -Is) ==="

for platform in meta tiktok google; do
  err="$DIR/../data/${platform}_${DATE}.err"
  if python3 "$DIR/sync_${platform}.py" --date "$DATE" 2> "$err"; then
    rm -f "$err"
    echo "sync_${platform}: ok"
  else
    echo "sync_${platform}: FAILED (stderr kept at $err)"
    cat "$err"
    FAILED=1
  fi
  # off-minute stagger between platforms (and a beat before the load)
  sleep 73
done

python3 "$DIR/load.py" --date "$DATE" --platforms meta,tiktok,google || FAILED=1

echo "=== daily_sync $DATE done $(date -Is) exit $FAILED ==="
exit $FAILED
