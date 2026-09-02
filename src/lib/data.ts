import { supabase } from "./supabase";
import type { AdRow, Platform, SyncRun } from "./types";

const AD_COLUMNS =
  "platform,date,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name," +
  "spend,impressions,clicks,video_views,video_plays,purchases,purchase_value,purchases_are_pooled";

const PAGE = 1000;

/**
 * Fetch ad_daily rows for [from, to] inclusive, all platforms, paginated past
 * the PostgREST 1000 row cap. Never selects the raw jsonb column.
 */
export async function fetchAdRows(from: string, to: string): Promise<AdRow[]> {
  let all: AdRow[] = [];
  for (let i = 0; ; i++) {
    const { data, error } = await supabase
      .from("ad_daily")
      .select(AD_COLUMNS)
      .gte("date", from)
      .lte("date", to)
      .order("date", { ascending: true })
      .order("campaign_id", { ascending: true })
      .order("adset_id", { ascending: true, nullsFirst: true })
      .order("ad_id", { ascending: true, nullsFirst: true })
      .range(i * PAGE, (i + 1) * PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as AdRow[];
    all = all.concat(rows);
    if (rows.length < PAGE) break;
  }
  return all;
}

export interface SyncStatus {
  latest: Partial<Record<Platform, SyncRun>>;
  /** Human readable problems: missing, stale (>26h) or errored syncs. */
  problems: string[];
}

/**
 * Latest sync run per platform. The schema comment is explicit: the dashboard
 * must surface a missing, stale (>26h) or errored sync and never render a
 * silent zero.
 */
export async function fetchSyncStatus(): Promise<SyncStatus> {
  const { data, error } = await supabase
    .from("sync_runs")
    .select("platform,started_at,finished_at,status,rows_written,error")
    .order("started_at", { ascending: false })
    .limit(60);
  if (error) throw new Error(error.message);

  const latest: Partial<Record<Platform, SyncRun>> = {};
  for (const run of (data ?? []) as unknown as SyncRun[]) {
    if (!latest[run.platform]) latest[run.platform] = run;
  }

  const problems: string[] = [];
  const platforms: Platform[] = ["meta", "tiktok", "google"];
  for (const p of platforms) {
    const run = latest[p];
    if (!run) {
      problems.push(`${p}: no sync has ever run`);
      continue;
    }
    if (run.status === "error") {
      problems.push(`${p}: last sync failed`);
      continue;
    }
    const ageH = (Date.now() - new Date(run.started_at).getTime()) / 3600000;
    if (ageH > 26) {
      problems.push(`${p}: last sync ${Math.floor(ageH)}h ago, data may be stale`);
    }
  }
  return { latest, problems };
}
