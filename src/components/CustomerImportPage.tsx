import React, { useEffect, useRef, useState } from 'react';
import { Upload, RefreshCw, Loader2 } from 'lucide-react';
import { MAX_CUSTOMER_CSV_BYTES, parseCustomerCsv, type CustomerReference, type CustomerReferenceSnapshot } from '../services/customerReference';
import { getCustomerReference, replaceCustomerReference } from '../services/customerReferenceService';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const buttonClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2 disabled:opacity-50';

export function CustomerImportPage({ canImport, onOpenIntake }: { canImport: boolean; onOpenIntake: () => void }) {
  const [snapshot, setSnapshot] = useState<CustomerReferenceSnapshot | null>(null);
  const [preview, setPreview] = useState<{ customers: CustomerReference[]; fileName: string; priceColumn: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const mounted = useRef(false);
  const request = useRef(0);

  const refresh = async () => {
    const version = ++request.current;
    setLoading(true); setError('');
    try {
      const latest = await getCustomerReference();
      if (mounted.current && request.current === version) setSnapshot(latest);
    } catch (err) {
      if (mounted.current && request.current === version) {
        setSnapshot(null);
        setError(err instanceof Error ? err.message : 'Could not load the shared customer list.');
      }
    } finally {
      if (mounted.current && request.current === version) setLoading(false);
    }
  };
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => { mounted.current = false; request.current++; };
  }, []);

  const readCsv = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const version = ++request.current;
    setReading(true); setPreview(null); setError(''); setMessage('');
    try {
      if (!/\.csv$/i.test(file.name)) throw new Error('Choose a CSV file.');
      if (file.size > MAX_CUSTOMER_CSV_BYTES) throw new Error('CSV must be 10 MB or smaller.');
      const parsed = parseCustomerCsv(await file.text());
      if (mounted.current && request.current === version) setPreview({ ...parsed, fileName: file.name });
    } catch (err) {
      if (mounted.current && request.current === version) setError(err instanceof Error ? err.message : 'Could not read the CSV.');
    } finally {
      if (mounted.current && request.current === version) setReading(false);
    }
  };

  const save = async () => {
    if (!preview || saving) return;
    setSaving(true); setError(''); setMessage('');
    try {
      const latest = await replaceCustomerReference(preview.customers, preview.fileName);
      if (!mounted.current) return;
      setSnapshot(latest); setPreview(null); setSearch('');
      setMessage(`Saved ${latest.customers.length} customers for all users and devices. The previous CSV reference data was replaced.`);
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : 'Could not save the customer knowledge base.');
    } finally { if (mounted.current) setSaving(false); }
  };

  const query = search.trim().toLowerCase();
  const visible = (preview?.customers ?? snapshot?.customers ?? []).filter(customer => !query || `${customer.customerName} ${customer.jobNumber}`.toLowerCase().includes(query));
  return (
    <section className="rounded-xl border border-slate-200 bg-white" aria-label="Customer Knowledge Base">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 p-4 sm:p-5">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Customer Knowledge Base</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">Upload a customer CSV once to keep a shared list of customer names, DASH job numbers, contract prices, and property addresses for all users and devices. Intake analysis reads only the document you upload - this list is never sent to the AI.</p>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading || saving || reading} className={buttonClass}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden /> Refresh shared list
        </button>
      </div>
      <div className="space-y-4 p-4 sm:p-5">
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Each saved upload replaces the entire shared customer knowledge base for all users and devices. Saved jobs and documents are kept.</p>
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4">
          <label htmlFor="customer-csv-upload" className="block text-sm font-semibold text-slate-900">Choose customer CSV</label>
          <p id="customer-csv-help" className="mt-1 text-sm text-slate-600">Required columns: Customer or Customer Name, Job Number, and Contract Price or Estimate Amount. Up to 5,000 rows and 10 MB. Job Address, Loss City, Loss State, and Loss ZIP are also saved when present. The saved list must fit within 100 KB.</p>
          <input id="customer-csv-upload" type="file" accept=".csv,text/csv" onChange={readCsv} disabled={!canImport || loading || reading || saving} aria-describedby="customer-csv-help" className="mt-3 block min-h-11 w-full min-w-0 text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-white file:px-4 file:py-3 file:font-semibold file:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 disabled:opacity-50" />
          {!canImport && <p className="mt-2 text-sm text-slate-600">An editor or administrator can replace this shared list.</p>}
        </div>
        {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        {message && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
        {(loading || reading) && <p role="status" className="flex items-center gap-2 text-sm text-slate-600"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />{reading ? 'Reading CSV…' : 'Loading shared customers…'}</p>}
        {preview ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-700"><strong>Preview: {preview.customers.length} customers</strong> from {preview.fileName}. Contract price comes from “{preview.priceColumn}”. Blank prices remain unknown.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void save()} disabled={saving || loading || reading} className={`${buttonClass} border-red-600 bg-red-600 text-white hover:bg-red-700`}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />}
                {saving ? 'Saving shared customers…' : 'Replace knowledge base'}
              </button>
              <button type="button" onClick={() => { setPreview(null); setSearch(''); }} disabled={saving} className={buttonClass}>Cancel preview</button>
            </div>
          </div>
        ) : snapshot && (
          <p className="text-sm text-slate-600">{snapshot.customers.length} shared customers{snapshot.updatedAt && <> · {snapshot.fileName} · Updated {new Date(snapshot.updatedAt).toLocaleString()} by {snapshot.updatedBy}</>}</p>
        )}
        <div>
          <label htmlFor="customer-reference-search" className="mb-1 block text-sm font-medium text-slate-700">Search customer knowledge base</label>
          <input id="customer-reference-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Customer name or job number" className="min-h-11 w-full rounded-lg border border-slate-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-600" />
        </div>
        <div className="max-h-[28rem] overflow-auto rounded-lg border border-slate-200">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{preview ? 'CSV preview' : 'Shared customer knowledge base'}</caption>
            <thead className="sticky top-0 bg-slate-100 text-slate-700"><tr><th scope="col" className="p-3">Customer name</th><th scope="col" className="p-3">Job number</th><th scope="col" className="p-3">Property address</th><th scope="col" className="p-3 text-right">Contract price</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{visible.map(customer => <tr key={customer.jobNumber}><td className="p-3 break-words">{customer.customerName}</td><td className="p-3">{customer.jobNumber}</td><td className="p-3 break-words">{[customer.jobAddress, customer.city, customer.state, customer.zip].filter(Boolean).join(", ") || "Unknown"}</td><td className="p-3 text-right tabular-nums">{customer.contractPrice === null ? 'Unknown' : usd.format(customer.contractPrice)}</td></tr>)}</tbody>
          </table>
          {!visible.length && !loading && <p className="p-4 text-sm text-slate-500">{query ? 'No matching customers.' : 'No customers imported yet.'}</p>}
        </div>
        <button type="button" onClick={onOpenIntake} disabled={saving} className={buttonClass}>Go to intake</button>
      </div>
    </section>
  );
}
