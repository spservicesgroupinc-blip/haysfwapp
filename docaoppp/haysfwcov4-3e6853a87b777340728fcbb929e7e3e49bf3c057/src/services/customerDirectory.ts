import type { CustomerSummary } from "../crm/types";
import type { JobEntry } from "../types";

/**
 * A customer picked from the CRM directory travels through the job picker as a
 * synthetic directory row whose id names the customer record.
 */
const CUSTOMER_OPTION_PREFIX = "customer:";

export const customerOptionId = (customerId: string): string =>
  `${CUSTOMER_OPTION_PREFIX}${customerId}`;

export const customerIdOfOption = (
  optionId: string | undefined,
): string | undefined =>
  optionId?.startsWith(CUSTOMER_OPTION_PREFIX)
    ? optionId.slice(CUSTOMER_OPTION_PREFIX.length)
    : undefined;

/** Job reports and customer records disagree on case and spacing. */
export const customerNameKey = (value: string | undefined): string =>
  (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** A full job number or unique full customer/contact value can fill directly. */
export function automaticJobMatch(text: string, jobs: JobEntry[]): JobEntry | undefined {
  const query = customerNameKey(text);
  if (!query) return undefined;
  const numbered = jobs.filter(job => customerNameKey(job.jobNumber) === query);
  if (numbered.length) return numbered.length === 1 ? numbered[0] : undefined;
  const matches = jobs.filter(job => [job.customer, job.customerEmail, job.customerPhone]
    .some(value => customerNameKey(value) === query));
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Turns the loaded customer directory into pickable rows.
 *
 * Customers that still have an active directory job are skipped: that job row
 * already carries the job number and contract amount. Everyone else — closed
 * jobs, customers from an earlier upload the directory no longer lists, or
 * contacts added by hand — stays searchable by name, phone, email, or address.
 */
export function customerOptions(
  jobs: JobEntry[],
  customers: CustomerSummary[],
): JobEntry[] {
  const covered = new Set(
    jobs.filter((job) => job.active).map((job) => customerNameKey(job.customer)),
  );
  return customers
    .filter((customer) => {
      const key = customerNameKey(customer.name);
      return key && !covered.has(key);
    })
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((customer) => ({
      id: customerOptionId(customer.id),
      jobNumber: "",
      customer: customer.name,
      address: customer.address ?? "",
      projectManager: "",
      estimator: "",
      status: "Active",
      customerPhone: customer.phone ?? "",
      customerEmail: customer.email ?? "",
      contractAmount: "",
      active: true,
      updatedAt: customer.updatedAt,
    }));
}

/** The CRM record behind a pick, whether it was a job row or a customer row. */
export function customerIdForPick(
  pick: JobEntry | null | undefined,
  customers: CustomerSummary[],
  typedCustomer: string,
): string | undefined {
  const fromOption = customerIdOfOption(pick?.id);
  if (fromOption) return fromOption;
  const key = customerNameKey(pick?.customer ?? typedCustomer);
  if (!key) return undefined;
  const matches = customers.filter((customer) => customerNameKey(customer.name) === key);
  return matches.length === 1 ? matches[0].id : undefined;
}
