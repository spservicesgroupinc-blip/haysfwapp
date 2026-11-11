import type { JobEntry } from "../types";

/** Combine the uploaded customer database with report jobs by job number. */
export function sharedJobDirectory(jobs: JobEntry[], reference: JobEntry[] | null): JobEntry[] {
  const key = (job: JobEntry) => job.jobNumber.trim().toUpperCase() || job.id;
  const currentNumbers = new Set((reference ?? []).map(key));
  const rows = new Map(jobs.filter(job => !reference ||
    (!job.id.startsWith("reference:") && (!/^csv-job-[a-f0-9]{32}$/.test(job.id) || currentNumbers.has(key(job)))))
    .map(job => [key(job), job]));
  for (const entry of reference ?? []) {
    const previous = rows.get(key(entry));
    if (!previous) rows.set(key(entry), entry);
    else {
      const populated = Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== "" && value !== undefined));
      rows.set(key(entry), { ...previous, ...populated, id: previous.id } as JobEntry);
    }
  }
  return [...rows.values()];
}
