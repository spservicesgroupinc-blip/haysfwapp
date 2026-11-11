import type { ChangeRequest } from "../types";
import { decimalCents, moneyCents, formatCents } from "./contract";

/** Start document preparation with submitted information; retain estimator corrections. */
export function customerDocumentDraft(request: ChangeRequest): ChangeRequest {
  const scope = request.requestedChanges
    .map((change, index) =>
      [
        request.requestedChanges.length > 1
          ? `Change ${index + 1}${change.room ? ` - ${change.room}` : ""} (${change.action})`
          : [
              change.room,
              change.action !== "add" ? `${change.action} work` : "",
            ]
              .filter(Boolean)
              .join(" - "),
        change.description,
        change.measurements && `Measurements: ${change.measurements}`,
        change.materials && `Materials: ${change.materials}`,
        change.scheduleImpact && `Schedule: ${change.scheduleImpact}`,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .filter(Boolean)
    .join("\n\n");
  return {
    ...request,
    job: {
      ...request.job,
      branchContact: request.job.branchContact?.trim()
        ? request.job.branchContact
        : request.estimatorName,
    },
    finalChangeOrder: {
      ...request.finalChangeOrder,
      scope: request.finalChangeOrder?.scope.trim()
        ? request.finalChangeOrder.scope
        : scope,
      // The PM's submitted amount is the estimator's starting price. An
      // estimator edit always wins, and the new contract total recalculates
      // from this value as soon as the modal opens.
      amount: request.finalChangeOrder?.amount.trim()
        ? request.finalChangeOrder.amount
        : signedAmountValue(request.knownChangeAmount),
    },
  };
}

export const signedMoneyCents = (value: string): bigint | null =>
  /^[+-]?\d+(?:\.\d{1,2})?$/.test(value.trim())
    ? moneyCents(value.trim().replace(/^\+/, ""))
    : null;

/** Canonical signed amount text for the document input, e.g. "+1250.19". */
export function signedAmountValue(value: string | undefined): string {
  if (!value?.trim()) return "";
  const cents = signedMoneyCents(value);
  if (cents === null) return "";
  const absolute = cents < 0n ? -cents : cents;
  const dollars = (absolute / 100n).toString();
  const fraction = (absolute % 100n).toString().padStart(2, "0");
  return `${cents < 0n ? "-" : "+"}${dollars}.${fraction}`;
}

export interface PriorChangeSummary {
  /** Net authorized changes before the new request, as decimal dollars. */
  previousChanges: string;
  /** Next change-order number derived from the job's saved requests. */
  nextOrderNumber: string;
  /** Number of earlier requests that already carried a price. */
  pricedCount: number;
}

/**
 * Rolls a job's earlier change orders into the next request's starting values.
 * The estimator's final price for an earlier request wins; the PM's submitted
 * amount is the fallback until that request is priced. The caller supplies the
 * job's baseline so imported previous changes are never counted twice.
 */
export function priorChangeSummary(
  requests: Pick<
    ChangeRequest,
    "job" | "finalChangeOrder" | "knownChangeAmount"
  >[],
  baseline = "0.00",
): PriorChangeSummary {
  let cents = signedMoneyCents(baseline) ?? 0n;
  let pricedCount = 0;
  let highestOrder = requests.length;
  for (const request of requests) {
    const final = request.finalChangeOrder?.amount?.trim();
    const amount = signedMoneyCents(final || request.knownChangeAmount || "");
    if (amount !== null) {
      cents += amount;
      pricedCount += 1;
    }
    const match = /^CO-(\d+)$/i.exec(request.job.orderNumber?.trim() ?? "");
    if (match) highestOrder = Math.max(highestOrder, Number(match[1]));
  }
  return {
    previousChanges: decimalCents(cents),
    nextOrderNumber: `CO-${String(highestOrder + 1).padStart(2, "0")}`,
    pricedCount,
  };
}

/** Reads each saved request, skipping a failed read so intake never blocks. */
async function readRequests(
  summaries: { id: string }[],
  load: (id: string) => Promise<ChangeRequest>,
): Promise<ChangeRequest[]> {
  return (
    await Promise.all(
      summaries.map(async (summary) => {
        try {
          return await load(summary.id);
        } catch {
          return null;
        }
      }),
    )
  ).filter((request): request is ChangeRequest => request !== null);
}

/**
 * Rolls a known set of saved requests (for example a workspace's linked
 * requests) into the next change order's starting values.
 */
export async function priorChangesFrom(
  summaries: { id: string }[],
  load: (id: string) => Promise<ChangeRequest>,
  baseline: string,
): Promise<PriorChangeSummary | null> {
  if (!summaries.length) return null;
  const loaded = await readRequests(summaries, load);
  return loaded.length ? priorChangeSummary(loaded, baseline) : null;
}

/**
 * Loads every saved request for one job number and rolls their prices into the
 * totals for the next change order. Without an explicit baseline, the earliest
 * saved request's previous-changes value is the job's starting point.
 */
export async function priorChangesForJob(
  summaries: { id: string; job: { jobNumber: string } }[],
  jobNumber: string,
  load: (id: string) => Promise<ChangeRequest>,
  baseline?: string,
): Promise<PriorChangeSummary | null> {
  const target = jobNumber.trim().toUpperCase();
  if (!target) return null;
  const matches = summaries.filter(
    (summary) => summary.job.jobNumber.trim().toUpperCase() === target,
  );
  if (!matches.length) return null;
  const loaded = await readRequests(matches, load);
  if (!loaded.length) return null;
  const base =
    baseline ??
    loaded
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]!.job
      .previousChanges;
  return priorChangeSummary(loaded, base);
}

export function signedAmountLabel(value: string | undefined): string {
  if (!value?.trim()) return "Not provided";
  const cents = signedMoneyCents(value);
  return cents === null
    ? "Unavailable"
    : `${cents > 0n ? "+" : ""}${formatCents(cents)}`;
}

export function pricingInputError(
  request: Pick<ChangeRequest, "lineNumbers" | "finalChangeOrder">,
): string {
  if (
    request.lineNumbers?.trim() &&
    !/^[+-][1-9]\d*(?:[\s,]+[+-][1-9]\d*)*$/.test(request.lineNumbers.trim())
  )
    return "Enter a line number greater than zero in each row and choose Add or Remove.";
  const value = request.finalChangeOrder?.amount;
  if (value?.trim() && signedMoneyCents(value) === null)
    return "Final change amount must be dollars with at most two decimal places, such as +1250.19 or -250.00.";
  return "";
}

export function finalDocumentError(request: ChangeRequest): string {
  const job = request.job;
  for (const [label, value] of [
    ["Customer name", job.customer],
    ["Property address", job.address],
    ["Job number", job.jobNumber],
    ["Change-order number", job.orderNumber],
    ["Change-order date", job.date],
    ["Final customer scope", request.finalChangeOrder?.scope],
  ])
    if (!value?.trim())
      return `Enter ${label!.toLowerCase()} in Finalize customer document, then save changes.`;
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(job.date) ||
    Number.isNaN(Date.parse(job.date)) ||
    new Date(job.date).toISOString().slice(0, 10) !== job.date
  )
    return "Enter a valid change-order date.";
  if (
    moneyCents(job.originalContract ?? "") === null ||
    (job.previousChanges?.trim() && moneyCents(job.previousChanges) === null)
  )
    return "Enter valid original contract and previous authorized change amounts before generating the customer document.";
  if (
    !request.finalChangeOrder?.amount.trim() ||
    signedMoneyCents(request.finalChangeOrder.amount) === null
  )
    return "Enter a final change amount (use 0.00 for no price change), then save changes.";
  if (!/^\d+$/.test(job.addedDays.trim()))
    return "Enter added days as a whole number (use 0 for no change).";
  return pricingInputError(request);
}

export function finalContractTotal(request: ChangeRequest): string {
  const original = moneyCents(request.job.originalContract ?? "");
  const previous = request.job.previousChanges?.trim()
    ? moneyCents(request.job.previousChanges)
    : 0n;
  const change = signedMoneyCents(request.finalChangeOrder?.amount ?? "");
  return original === null || previous === null || change === null
    ? "Unavailable"
    : formatCents(original + previous + change);
}
