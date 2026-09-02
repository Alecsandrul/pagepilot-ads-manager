import type { Currency } from "./types";

/**
 * Hardcoded display rates, same values as the design file.
 * USD is the source of truth; EUR and RON are a courtesy conversion.
 */
const FX: Record<Currency, number> = { USD: 1, EUR: 0.92, RON: 4.6 };
const SYMBOL: Record<Currency, string> = { USD: "$", EUR: "€", RON: "" };

export function money(v: number, dec: number, cur: Currency): string {
  const x = v * FX[cur];
  const s = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  }).format(x);
  return cur === "RON" ? `${s} RON` : `${SYMBOL[cur]}${s}`;
}

export function num(v: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(v));
}

export function pct(v: number): string {
  return (
    new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(v * 100) + "%"
  );
}

export function dec(v: number, d: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(v);
}

/**
 * The em dash placeholder used for empty data cells, exactly as in the design.
 * Allowed as a data placeholder glyph only, never inside sentences.
 */
export const EMPTY = "—";

/** Minus sign glyph for negative deltas (a math glyph, not sentence punctuation). */
export const MINUS = "−";
