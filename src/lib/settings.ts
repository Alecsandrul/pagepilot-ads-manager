import { supabase } from "./supabase";

export const TIKTOK_VALUE_KEY = "tiktok_assumed_conversion_value";
export const TIKTOK_VALUE_DEFAULT = 40;

/**
 * Assumed $ per TikTok result, from app_settings (migration 0004).
 * Falls back to the default when the row is missing or invalid.
 */
export async function fetchTiktokValue(): Promise<number> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", TIKTOK_VALUE_KEY)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const v = Number(data?.value);
  return Number.isFinite(v) && v > 0 ? v : TIKTOK_VALUE_DEFAULT;
}

export async function saveTiktokValue(v: number): Promise<void> {
  if (!Number.isFinite(v) || v <= 0) throw new Error("Value must be a positive number");
  const { error } = await supabase.from("app_settings").upsert({
    key: TIKTOK_VALUE_KEY,
    value: v,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}
