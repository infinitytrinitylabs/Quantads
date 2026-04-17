/**
 * Shared numeric utility helpers used across the ad-exchange modules.
 */

/** Round a currency value to 2 decimal places. */
export function roundCurrency(value: number): number {
  return Number(value.toFixed(2));
}

/** Round a value to N decimal places. */
export function roundToDecimals(value: number, decimals: number): number {
  return Number(value.toFixed(decimals));
}

/** Clamp a number to [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
