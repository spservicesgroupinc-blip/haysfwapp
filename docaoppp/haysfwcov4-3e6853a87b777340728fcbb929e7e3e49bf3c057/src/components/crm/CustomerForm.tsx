import { useEffect, useRef, useState, type FormEvent } from "react";
import { GitMerge, X } from "lucide-react";
import { createCustomer, mergeCustomers, updateCustomer } from "../../crm";
import type {
  Customer,
  CustomerSummary,
  NewCustomerInput,
} from "../../crm/types";
import "./crm.css";

export interface CustomerFormProps {
  mode: "create" | "edit";
  initial?: Customer;
  customers?: CustomerSummary[];
  mergeFocus?: boolean;
  onCancel: () => void;
  onSaved: (customer: Customer) => void;
}

export default function CustomerForm({
  mode,
  initial,
  customers = [],
  mergeFocus = false,
  onCancel,
  onSaved,
}: CustomerFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [cityStateZip, setCityStateZip] = useState(initial?.cityStateZip ?? "");
  const [tags, setTags] = useState((initial?.tags ?? []).join(", "));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mergeOtherId, setMergeOtherId] = useState("");
  const mergeSelectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (mergeFocus) mergeSelectRef.current?.focus();
  }, [mergeFocus]);

  const mergeCandidates = customers.filter((c) => c.id !== initial?.id);

  function buildInput(): NewCustomerInput {
    return {
      name: name.trim(),
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      address: address.trim() || undefined,
      cityStateZip: cityStateZip.trim() || undefined,
      tags: tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    };
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) {
      setError("A customer name is required.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const input = buildInput();
      const saved =
        mode === "edit" && initial
          ? await updateCustomer({
              ...initial,
              name: input.name,
              phone: input.phone,
              email: input.email,
              address: input.address,
              cityStateZip: input.cityStateZip,
              tags: input.tags,
            })
          : await createCustomer(input);
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleMerge() {
    if (!initial || !mergeOtherId) return;
    setBusy(true);
    setError("");
    try {
      const merged = await mergeCustomers(initial.id, mergeOtherId);
      onSaved(merged);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="crm-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={mode === "edit" ? "Edit customer" : "New customer"}
      onClick={onCancel}
    >
      <div
        className="crm-form-card"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="crm-form-head">
          <h2>{mode === "edit" ? "Edit customer" : "New customer"}</h2>
          <button className="icon-button" aria-label="Close" onClick={onCancel}>
            <X size={18} />
          </button>
        </div>

        <form className="crm-form" onSubmit={handleSubmit}>
          <div className="crm-field crm-field-full">
            <label htmlFor="crm-name">Name</label>
            <input
              id="crm-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus={!mergeFocus}
              required
            />
          </div>
          <div className="crm-field">
            <label htmlFor="crm-phone">Phone</label>
            <input
              id="crm-phone"
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </div>
          <div className="crm-field">
            <label htmlFor="crm-email">Email</label>
            <input
              id="crm-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="crm-field crm-field-full">
            <label htmlFor="crm-address">Address</label>
            <input
              id="crm-address"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
            />
          </div>
          <div className="crm-field">
            <label htmlFor="crm-city">City, state, ZIP</label>
            <input
              id="crm-city"
              value={cityStateZip}
              onChange={(event) => setCityStateZip(event.target.value)}
            />
          </div>
          <div className="crm-field">
            <label htmlFor="crm-tags">Tags (comma-separated)</label>
            <input
              id="crm-tags"
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="e.g. commercial, insurance"
            />
          </div>

          {error ? (
            <div className="notice danger crm-field-full" role="alert">
              {error}
            </div>
          ) : null}

          <div className="crm-form-actions crm-field-full">
            <button type="button" className="button" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="button primary" disabled={busy}>
              {busy
                ? "Saving…"
                : mode === "edit"
                  ? "Save changes"
                  : "Create customer"}
            </button>
          </div>
        </form>

        {mode === "edit" && initial ? (
          <section
            className="crm-merge"
            aria-label="Merge with another customer"
          >
            <h3>
              <GitMerge size={16} />
              Merge another customer into this one
            </h3>
            <p>
              Combining records keeps this customer's details and folds the
              other customer's jobs and history into it.
            </p>
            <div className="crm-merge-controls">
              <label htmlFor="crm-merge-other">Customer to merge</label>
              <select
                id="crm-merge-other"
                ref={mergeSelectRef}
                value={mergeOtherId}
                onChange={(event) => setMergeOtherId(event.target.value)}
                disabled={busy}
              >
                <option value="">Choose a customer…</option>
                {mergeCandidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="button"
                disabled={busy || !mergeOtherId}
                onClick={handleMerge}
              >
                <GitMerge size={16} />
                Merge into this customer
              </button>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
