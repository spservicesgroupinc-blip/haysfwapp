import {
  createEmptyJob,
  ensureRecordDefaults,
  type RestorationJobData,
} from "../documents/types/jobData";
import { CHECKLIST_BOXES } from "../documents/types/productionChecklist";
import { createRequest } from "../services/requests";
import { moneyCents } from "../services/contract";
import {
  priorChangeSummary,
  type PriorChangeSummary,
} from "../services/changeOrder";
import type { ChangeRequest, JobEntry } from "../types";
import type { Workspace } from "./types";

export const normalizeJobNumber = (value: string) => value.trim().toUpperCase();

export function createWorkspace(record?: RestorationJobData): Workspace {
  const id = crypto.randomUUID();
  const data = record
    ? ensureRecordDefaults(structuredClone(record))
    : createEmptyJob();
  if (!record) data.customer.jobNumber = "";
  data.recordId = id;
  return {
    id,
    revision: 0,
    updatedAt: new Date().toISOString(),
    record: data,
    originalContract: "",
    previousChanges: "0.00",
  };
}

export function workspaceFromDirectory(entry: JobEntry): Workspace {
  const workspace = createWorkspace();
  Object.assign(workspace.record.customer, {
    jobNumber: entry.jobNumber,
    customerName: entry.customer,
    lossAddress: entry.address,
    mailingCityStateZip: "",
    mainPhone: entry.customerPhone,
    email: entry.customerEmail,
  });
  Object.assign(workspace.record.team, {
    projectManager: entry.projectManager,
    estimator: entry.estimator,
    supervisor: entry.supervisor || workspace.record.team.supervisor,
    foreman: entry.foreman || workspace.record.team.foreman,
  });
  Object.assign(workspace.record.insurance, {
    carrier: entry.carrier || "",
    claimNumber: entry.claim || "",
    dateInspected: entry.dateInspected || "",
  });
  workspace.record.checklist.startDate = entry.startDate || "";
  workspace.record.checklist.finishDate = entry.finishDate || "";
  workspace.originalContract = entry.contractAmount;
  const contract = moneyCents(entry.contractAmount);
  if (contract !== null)
    workspace.record.changeOrder.originalContractSum = Number(contract) / 100;
  return workspace;
}

/** Only brand new requests inherit shared values; later job edits cannot rewrite history. */
export function requestFromWorkspace(
  workspace: Workspace,
  existing?: ChangeRequest,
  prior?: PriorChangeSummary,
): ChangeRequest {
  if (existing) return structuredClone(existing);
  const request = createRequest();
  const totals = prior ?? priorChangeSummary([], workspace.previousChanges);
  const { customer, insurance, team, branch } = workspace.record;
  return {
    ...request,
    workspaceId: workspace.id,
    job: {
      ...request.job,
      customer: customer.customerName,
      address: customer.lossAddress,
      customerPhone:
        customer.mainPhone || customer.mobilePhone || customer.homePhone,
      customerEmail: customer.email,
      jobNumber: customer.jobNumber,
      projectManager: team.projectManager,
      branchName: branch.name,
      branchAddress: [branch.address, branch.cityStateZip]
        .filter(Boolean)
        .join(", "),
      branchPhone: branch.phone,
      branchContact: team.estimator,
      carrier: insurance.carrier,
      claim: insurance.claimNumber,
      originalContract: workspace.originalContract,
      // Prior change orders continue the job's contract math; the job's
      // baseline plus every priced earlier request, never just the last one.
      previousChanges: totals.previousChanges,
      orderNumber: totals.nextOrderNumber,
    },
  };
}

/** Decimal money stays exact until display-only numeric values enter legacy PDF templates. */
export function recalculateFinancials(
  record: RestorationJobData,
): RestorationJobData {
  const rcv = moneyCents(String(record.financials.totalApprovedRcv));
  const deductible = moneyCents(String(record.financials.deductible));
  if (rcv === null)
    return {
      ...record,
      financials: {
        ...record.financials,
        netClaimValue: 0,
        downPayment: 0,
        midProgressPayment: 0,
        balancePayment: 0,
      },
    };
  const net = deductible === null ? null : rcv - deductible;
  // The existing agreement splits approved RCV, including the customer's deductible.
  const down = (rcv * 50n + (rcv >= 0n ? 50n : -50n)) / 100n;
  const mid = (rcv * 25n + (rcv >= 0n ? 50n : -50n)) / 100n;
  return {
    ...record,
    financials: {
      ...record.financials,
      netClaimValue: net === null ? 0 : Number(net) / 100,
      downPayment: Number(down) / 100,
      midProgressPayment: Number(mid) / 100,
      balancePayment: Number(rcv - down - mid) / 100,
    },
  };
}

export function updateRecordField(
  record: RestorationJobData,
  path: string,
  text: string,
): RestorationJobData {
  const [section, field, extra] = path.split(".");
  const sections = [
    "customer",
    "insurance",
    "financials",
    "team",
    "branch",
    "mortgage",
    "productionNotes",
    "checklist",
  ];
  if (
    extra ||
    !sections.includes(section) ||
    !field ||
    ["__proto__", "constructor", "prototype"].includes(field)
  )
    throw new Error("This field cannot be edited.");
  const data = structuredClone(record);
  const values = data[section as keyof RestorationJobData] as unknown as Record<
    string,
    unknown
  >;
  const checkbox =
    section === "checklist" &&
    CHECKLIST_BOXES.some((item) => item.key === field);
  if (!Object.hasOwn(values, field) && !checkbox)
    throw new Error("Unknown job field.");
  if (typeof values[field] === "boolean" || checkbox)
    values[field] = text === "true" || text === "Yes";
  else if (
    typeof values[field] === "number" ||
    [
      "totalApprovedRcv",
      "deductible",
      "roughEstimateAmount",
      "depreciationAmount",
    ].includes(field)
  ) {
    if (text.trim() && !/^-?\d+(?:\.\d{1,2})?$/.test(text.trim()))
      throw new Error("Enter a valid number.");
    values[field] = text.trim() ? Number(text) : "";
  } else values[field] = text;
  return recalculateFinancials(data);
}
