import type { JobEntry } from "../../types";
import type { Workspace } from "../../workspaces/types";
import { moneyCents } from "../../services/contract";
import {
  normalizeJobNumber,
  workspaceFromDirectory,
} from "../../workspaces/model";
import {
  customerIdOfOption,
  customerNameKey,
} from "../../services/customerDirectory";

/** Exact job numbers win; contact/name matches must identify only one record. */
export function matchingDirectoryEntry(workspace: Workspace, entries: JobEntry[]): JobEntry | undefined {
  const number = normalizeJobNumber(workspace.record.customer.jobNumber);
  const customer = workspace.record.customer;
  const name = customerNameKey(customer.customerName);
  const candidates = entries.filter(entry => {
    if (number && entry.jobNumber.trim()) return normalizeJobNumber(entry.jobNumber) === number;
    return !!name && customerNameKey(entry.customer) === name;
  });
  const exactJobs = number ? candidates.filter(entry => normalizeJobNumber(entry.jobNumber) === number) : [];
  if (exactJobs.length) return exactJobs.length === 1 ? exactJobs[0] : undefined;
  if (candidates.length === 1) return candidates[0];
  const phone = (value: string | undefined) => (value || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  const corroborated = candidates.filter(entry =>
    (customer.lossAddress.trim() && customerNameKey(customer.lossAddress) === customerNameKey(entry.address)) ||
    (customer.email.trim() && customerNameKey(customer.email) === customerNameKey(entry.customerEmail)) ||
    (phone(customer.mainPhone) && phone(customer.mainPhone) === phone(entry.customerPhone)));
  return corroborated.length === 1 ? corroborated[0] : undefined;
}

/** Matched directory data fills blanks; saved corrections remain authoritative. */
export function fillWorkspaceFromDirectory(
  workspace: Workspace,
  entry: JobEntry,
): Workspace {
  const currentNumber = normalizeJobNumber(workspace.record.customer.jobNumber);
  const pickedNumber = normalizeJobNumber(entry.jobNumber);
  if (currentNumber && pickedNumber && currentNumber !== pickedNumber)
    throw new Error(
      "This entry has a different job number. Open its job from Jobs & Documents, or clear the job number before choosing it.",
    );
  const currentName = customerNameKey(workspace.record.customer.customerName);
  const sameJob =
    currentNumber && pickedNumber && currentNumber === pickedNumber;
  if (
    !sameJob &&
    currentName &&
    currentName !== customerNameKey(entry.customer)
  )
    throw new Error(
      "This entry has a different customer. Open or create the correct job before applying its details.",
    );

  const source = workspaceFromDirectory(entry);
  const next = structuredClone(workspace);
  for (const field of [
    "jobNumber",
    "customerName",
    "lossAddress",
    "mainPhone",
    "email",
  ] as const) {
    if (
      !next.record.customer[field].trim() &&
      source.record.customer[field].trim()
    )
      next.record.customer[field] = source.record.customer[field];
  }
  for (const field of [
    "projectManager",
    "estimator",
    "supervisor",
    "foreman",
  ] as const) {
    if (
      (field === "supervisor" || field === "foreman") &&
      !entry[field]?.trim()
    )
      continue;
    if (!next.record.team[field].trim() && source.record.team[field].trim())
      next.record.team[field] = source.record.team[field];
  }
  for (const field of ["carrier", "claimNumber", "dateInspected"] as const) {
    if (field === "dateInspected" && !entry.dateInspected?.trim()) continue;
    if (
      !next.record.insurance[field].trim() &&
      source.record.insurance[field].trim()
    )
      next.record.insurance[field] = source.record.insurance[field];
  }
  for (const field of ["startDate", "finishDate"] as const) {
    if (!next.record.checklist[field].trim() && entry[field]?.trim())
      next.record.checklist[field] = entry[field];
  }
  if (!next.originalContract.trim() && source.originalContract.trim())
    next.originalContract = source.originalContract;
  const contract = moneyCents(next.originalContract);
  if (next.record.changeOrder.originalContractSum === "" && contract !== null)
    next.record.changeOrder.originalContractSum = Number(contract) / 100;
  if (!next.customerId) next.customerId = customerIdOfOption(entry.id);
  if (JSON.stringify(next) === JSON.stringify(workspace)) return workspace;
  next.updatedAt = new Date().toISOString();
  return next;
}
