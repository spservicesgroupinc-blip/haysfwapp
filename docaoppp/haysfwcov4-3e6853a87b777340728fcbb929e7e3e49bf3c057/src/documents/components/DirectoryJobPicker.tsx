import { useId, useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { JobEntry } from "../../types";

export function DirectoryJobPicker({
  jobs,
  onSelect,
  disabled = false,
  label = "Find a job or customer",
}: {
  jobs: JobEntry[];
  onSelect: (entry: JobEntry) => void;
  disabled?: boolean;
  label?: string;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const matches = useMemo(() => {
    const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return jobs
      .filter((job) => job.active)
      .filter((job) => {
        const text = [
          job.jobNumber,
          job.customer,
          job.address,
          job.customerPhone,
          job.customerEmail,
          job.secondaryEmail,
          job.projectManager,
          job.estimator,
          job.supervisor,
          job.foreman,
        ]
          .join(" ")
          .toLowerCase();
        return terms.every((term) => text.includes(term));
      });
  }, [jobs, query]);
  return (
    <div className="directory-picker">
      <label
        htmlFor={id}
        className="block text-[12px] font-medium text-slate-600"
      >
        {label}
      </label>
      <div className="workspace-search">
        <Search size={18} aria-hidden="true" />
        <input
          id={id}
          type="search"
          value={query}
          disabled={disabled}
          placeholder="Customer, job number, address, phone, or email"
          aria-describedby={`${id}-help`}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <p id={`${id}-help`} className="workspace-help">
      Exact matches fill automatically. You can choose another entry here; your saved edits are kept.
      </p>
      {query.trim() && (
        <div aria-label="Matching jobs and customers">
          {matches.slice(0, 8).map((job) => (
            <button
              key={job.id}
              type="button"
              className="workspace-list-row"
              disabled={disabled}
              onClick={() => {
                onSelect(job);
                setQuery("");
              }}
            >
              <span>
                <strong>
                  {job.customer || "Unnamed customer"}
                  {job.jobNumber
                    ? ` · ${job.jobNumber}`
                    : " · Customer contact"}
                </strong>
                <small>
                  {[job.address, job.customerPhone, job.customerEmail]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
              </span>
              <span>Choose</span>
            </button>
          ))}
          <p role="status" className="workspace-help">
            {matches.length === 0
              ? "No matching jobs or customers. You can enter details manually."
              : matches.length > 8
                ? `${matches.length} matches. Showing the first 8; refine your search to find another entry.`
                : `${matches.length} matching ${matches.length === 1 ? "entry" : "entries"}.`}
          </p>
        </div>
      )}
      {!jobs.length && (
        <p className="workspace-help">
          Upload a customer CSV or add a customer to use autofill.
        </p>
      )}
    </div>
  );
}
