import type { CustomerReference, CustomerReferenceSnapshot } from "../documents/services/customerReference";
import type { JobEntry } from "../types";

/** Stable IDs keep reference options usable before a directory refresh completes. */
export function customerReferencesToJobs(customers: CustomerReference[], updatedAt = ""): JobEntry[] {
  return customers.map(customer => {
    const status = customer.status?.trim() || "Active";
    const cityStateZip = [customer.city, customer.state, customer.zip].filter(Boolean).join(" ");
    return {
      id: `reference:${encodeURIComponent(customer.jobNumber.trim().toUpperCase())}`,
      jobNumber: customer.jobNumber,
      customer: customer.customerName,
      address: [customer.jobAddress, cityStateZip].filter(Boolean).join(", "),
      jobAddress: customer.jobAddress ?? "", city: customer.city ?? "", state: customer.state ?? "", zip: customer.zip ?? "",
      projectManager: customer.projectManager ?? "", estimator: customer.estimator ?? "", status,
      foreman: customer.foreman ?? "", supervisor: customer.supervisor ?? "", secondaryEmail: customer.secondaryEmail ?? "",
      customerPhone: customer.customerPhone ?? "", customerEmail: customer.customerEmail ?? "",
      carrier: customer.carrier ?? "", claim: customer.claim ?? "",
      dateInspected: customer.dateInspected ?? "", startDate: customer.startDate ?? "", finishDate: customer.finishDate ?? "",
      contractAmount: customer.contractPrice === null ? "" : customer.contractPrice.toFixed(2),
      active: !["closed", "cancelled", "canceled", "inactive", "archived"].includes(status.toLowerCase()),
      updatedAt,
    };
  });
}

export function customerReferenceJobs(snapshot: CustomerReferenceSnapshot): JobEntry[] {
  return customerReferencesToJobs(snapshot.customers, snapshot.updatedAt);
}

/** Both CSV entry points persist the same shared reference contract. */
export function jobsToCustomerReferences(jobs: JobEntry[]): CustomerReference[] {
  return jobs.map(job => ({
    customerName: job.customer,
    jobNumber: job.jobNumber,
    contractPrice: job.contractAmount === "" ? null : Number(job.contractAmount),
    jobAddress: job.jobAddress ?? job.address,
    city: job.city ?? "", state: job.state ?? "", zip: job.zip ?? "",
    ...Object.fromEntries((["customerPhone", "customerEmail", "secondaryEmail", "projectManager", "foreman", "supervisor", "estimator", "status", "carrier", "claim", "dateInspected", "startDate", "finishDate"] as const)
      .filter(field => !!job[field]).map(field => [field, job[field]])),
  }));
}
