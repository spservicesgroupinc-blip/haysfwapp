import { useCallback, useEffect, useMemo, useState } from "react";
import { Mail, MapPin, Phone, Plus, Search, UserRound } from "lucide-react";
import { listCustomers, subscribeCrm } from "../../crm";
import type { CustomerSummary } from "../../crm/types";
import CustomerForm from "./CustomerForm";
import "./crm.css";

export interface CustomerListProps {
  onOpen: (id: string) => void;
}

export default function CustomerList({ onOpen }: CustomerListProps) {
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const rows = await listCustomers();
      setCustomers(rows);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    let active = true;
    const read = async () => {
      try {
        const rows = await listCustomers();
        if (active) {
          setCustomers(rows);
          setError("");
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : String(err));
      }
    };
    void read();
    const unsubscribe = subscribeCrm(() => void read());
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const query = search.trim().toLowerCase();
  const visible = useMemo(() => {
    const filtered = query
      ? customers.filter((c) =>
          `${c.name ?? ""} ${c.phone ?? ""} ${c.email ?? ""} ${c.address ?? ""}`
            .toLowerCase()
            .includes(query),
        )
      : customers;
    return [...filtered].sort((a, b) => a.name.localeCompare(b.name));
  }, [customers, query]);

  const handleSaved = useCallback(async () => {
    setShowForm(false);
    await load();
  }, [load]);

  return (
    <div className="crm">
      <div className="crm-head">
        <div>
          <p className="eyebrow">Customer directory</p>
          <h1>Customers</h1>
          <p>Contacts, follow-ups, and job history in one place.</p>
        </div>
        <button className="button primary" onClick={() => setShowForm(true)}>
          <Plus size={18} />
          New customer
        </button>
      </div>

      {error ? (
        <div className="notice danger" role="alert">
          {error}
        </div>
      ) : null}

      <label className="search crm-search">
        <Search size={17} />
        <input
          aria-label="Search customers"
          placeholder="Search name, phone, email, or address"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>

      <div className="crm-list">
        {visible.length ? (
          visible.map((customer) => (
            <button
              key={customer.id}
              className="crm-card"
              onClick={() => onOpen(customer.id)}
            >
              <span className="crm-card-avatar" aria-hidden="true">
                <UserRound size={20} />
              </span>
              <span className="crm-card-main">
                <strong>{customer.name || "Untitled customer"}</strong>
                {customer.phone ? (
                  <small>
                    <Phone size={12} />
                    {customer.phone}
                  </small>
                ) : null}
                {customer.email ? (
                  <small>
                    <Mail size={12} />
                    {customer.email}
                  </small>
                ) : null}
                {customer.address ? (
                  <small>
                    <MapPin size={12} />
                    {customer.address}
                  </small>
                ) : null}
              </span>
              <span className="crm-card-stats">
                <span className="crm-badge">
                  {customer.jobCount} {customer.jobCount === 1 ? "job" : "jobs"}
                </span>
                {customer.openTaskCount > 0 ? (
                  <span className="crm-badge crm-badge-attention">
                    {customer.openTaskCount} open
                  </span>
                ) : null}
              </span>
              <span className="crm-card-open" aria-hidden="true">
                Open →
              </span>
            </button>
          ))
        ) : (
          <p className="crm-empty">
            {customers.length
              ? "No customers match your search."
              : "No customers yet. Import jobs on the Jobs page and every customer on the report is added here, or add one manually."}
          </p>
        )}
      </div>

      {showForm ? (
        <CustomerForm
          mode="create"
          onCancel={() => setShowForm(false)}
          onSaved={handleSaved}
        />
      ) : null}
    </div>
  );
}
