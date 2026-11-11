import type { JobDetails } from "../types";

/** Canonical decimal dollars, at most two fractional digits. Never use floats. */
export function moneyCents(value: string): bigint | null {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  return (
    (match[1] ? -1n : 1n) *
    (BigInt(match[2]) * 100n + BigInt((match[3] ?? "").padEnd(2, "0")))
  );
}

export function formatCents(value: bigint): string {
  const absolute = value < 0n ? -value : value;
  const dollars = (absolute / 100n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${value < 0n ? "-" : ""}$${dollars}.${(absolute % 100n).toString().padStart(2, "0")}`;
}

/** Canonical decimal dollars without a currency symbol, e.g. "-1250.19". */
export function decimalCents(value: bigint): string {
  const absolute = value < 0n ? -value : value;
  return `${value < 0n ? "-" : ""}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, "0")}`;
}

export function contractAmounts(
  job: Pick<JobDetails, "originalContract" | "previousChanges">,
) {
  const originalText = job.originalContract ?? "";
  const previousText = job.previousChanges ?? "";
  const original = moneyCents(originalText);
  const previous = previousText.trim() ? moneyCents(previousText) : 0n;
  return {
    original:
      original !== null
        ? formatCents(original)
        : originalText.trim()
          ? "Unavailable"
          : "Not provided",
    previous: previous !== null ? formatCents(previous) : "Unavailable",
    total:
      original !== null && previous !== null
        ? formatCents(original + previous)
        : !originalText.trim() && previous !== null
          ? "Not provided"
          : "Unavailable",
  };
}
