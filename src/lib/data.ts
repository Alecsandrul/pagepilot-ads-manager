import { supabase } from "./supabase";
import type { AdRow, BudgetRow, EntityRow, Platform, SyncRun } from "./types";

// NOTE: `thruplays` requires migration 0005 on the live DB - PostgREST
// rejects the whole select if the column is missing. Deploy this frontend
// only AFTER 0005 is applied.
const AD_COLUMNS =
  "platform,date,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name," +
  "spend,impressions,clicks,video_views,video_plays,thruplays,purchases,purchase_value,purchases_are_pooled";

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

/**
 * Current budgets (entity_budgets, migration 0006). The table arriving with
 * a later migration is a normal state: callers treat an error as "no
 * budgets" and every Budget cell shows its placeholder.
 */
export async function fetchBudgets(): Promise<BudgetRow[]> {
  // Same cannot-read guard as fetchSyncStatus: an unauthenticated read is
  // RLS filtered to zero rows with NO error, and empty budgets must render
  // as "could not be read", never as "no budgets exist".
  const { data: sess } = await supabase.auth.getSession();
  if (!sess.session) throw new Error("no signed in session");
  const { data, error } = await supabase
    .from("entity_budgets")
    .select("platform,level,entity_id,campaign_id,budget,budget_type");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as BudgetRow[];
}

/**
 * Everything that EXISTS in the ad accounts (ad_entities, migration 0010),
 * regardless of delivery. Read whole: a few thousand narrow rows, and the UI
 * needs the full set to work out what ad_daily is missing.
 *
 * Like fetchBudgets, an unauthenticated read is RLS filtered to zero rows
 * with NO error, so a throw means "unknown", never "no entities exist". The
 * table arriving with a later migration is a normal state: the caller falls
 * back to insights-only rows and says so.
 */
export async function fetchEntities(): Promise<EntityRow[]> {
  const { data: sess } = await supabase.auth.getSession();
  if (!sess.session) throw new Error("no signed in session");
  let all: EntityRow[] = [];
  for (let i = 0; ; i++) {
    const { data, error } = await supabase
      .from("ad_entities")
      .select(
        "platform,level,entity_id,entity_name,campaign_id,adset_id,status,is_active,created_at"
      )
      .order("entity_id", { ascending: true })
      .range(i * PAGE, (i + 1) * PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as EntityRow[];
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
  // Cannot-read is NOT zero-rows: without a signed in session RLS silently
  // filters sync_runs to nothing, and an empty result must never masquerade
  // as "no sync has ever run". Throw instead; the caller reports the status
  // as unreadable (live bug, 2026-09-03).
  const { data: sess } = await supabase.auth.getSession();
  if (!sess.session) throw new Error("no signed in session");

  const platforms: Platform[] = ["meta", "tiktok", "google"];
  // One query PER platform. A flat limit(60) over all rows let the 32 day
  // google backfill (google + budgets rows) push meta and tiktok's latest
  // runs out of the window - the newest meta row sat at position 132 - and
  // the banner falsely claimed "no sync has ever run" (live bug,
  // 2026-09-03). A per platform limit(1) cannot be crowded out.
  const results = await Promise.all(
    platforms.map((p) =>
      supabase
        .from("sync_runs")
        .select("platform,started_at,finished_at,status,rows_written,error")
        .eq("platform", p)
        .order("started_at", { ascending: false })
        .limit(1)
    )
  );

  const latest: Partial<Record<Platform, SyncRun>> = {};
  platforms.forEach((p, i) => {
    const { data, error } = results[i];
    if (error) throw new Error(`${p}: ${error.message}`);
    const run = (data ?? [])[0] as unknown as SyncRun | undefined;
    if (run) latest[p] = run;
  });

  const problems: string[] = [];
  for (const p of platforms) {
    const run = latest[p];
    if (!run) {
      // Reached only on an authenticated, error free, genuinely empty read.
      problems.push(`${p}: no sync recorded yet`);
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
