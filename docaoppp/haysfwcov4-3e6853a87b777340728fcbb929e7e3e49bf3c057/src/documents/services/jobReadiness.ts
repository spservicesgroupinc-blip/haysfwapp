import type { RestorationJobData } from '../types/jobData';

export interface MissingJobField {
  label: string;
  section: 'customer' | 'insurance' | 'financials';
  inputId: string;
}

/** The same required fields drive navigation badges and document review. */
export function getMissingJobFields(job: RestorationJobData): MissingJobField[] {
  const missing: MissingJobField[] = [];
  if (!job.customer.customerName.trim()) missing.push({ label: 'Customer name', section: 'customer', inputId: 'customer-customerName' });
  if (!job.customer.lossAddress.trim()) missing.push({ label: 'Loss property address', section: 'customer', inputId: 'customer-lossAddress' });
  if (!job.insurance.carrier.trim()) missing.push({ label: 'Insurance carrier', section: 'insurance', inputId: 'insurance-carrier' });
  if (!job.insurance.claimNumber.trim()) missing.push({ label: 'Claim number', section: 'insurance', inputId: 'insurance-claimNumber' });
  if (job.financials.totalApprovedRcv === '') missing.push({ label: 'Total approved RCV', section: 'financials', inputId: 'rcv-input' });
  if (job.financials.deductible === '') missing.push({ label: 'Deductible', section: 'financials', inputId: 'deductible-input' });
  return missing;
}
