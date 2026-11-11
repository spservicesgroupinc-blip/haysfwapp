import { useRef, useState } from 'react';
import { parseWorkspaceExport, planWorkspaceMigration, prepareWorkspaceImport, type MigrationPlanItem } from '../services/workspaceMigration';
import type { Workspace } from '../workspaces/types';

interface Props {
  workspaces: Workspace[];
  onImport: (workspace: Workspace) => Promise<void>;
  onDone: () => void;
}
interface Report { state: 'saved' | 'skipped' | 'error'; message: string }

/** Preview first; each ambiguous identity requires a person's choice before any records are saved. */
export default function WorkspaceMigration({ workspaces, onImport, onDone }: Props) {
  const [items, setItems] = useState<MigrationPlanItem[]>([]);
  const [choices, setChoices] = useState<string[]>([]);
  const [reports, setReports] = useState<Record<number, Report>>({});
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const prepared = useRef(new Map<number, Workspace>());
  const imported = useRef(new Map<string, Workspace>());
  const current = () => {
    const known = new Map(workspaces.map(workspace => [workspace.id, workspace]));
    imported.current.forEach((workspace, id) => known.set(id, workspace));
    return [...known.values()];
  };

  async function load(file?: File) {
    if (!file) return;
    setError(''); setBusy(true); setItems([]); setReports({}); setFileName(''); prepared.current.clear(); imported.current.clear();
    try {
      if (file.size > 50 * 1024 * 1024) throw new Error('Choose an export smaller than 50 MB.');
      const plan = planWorkspaceMigration(parseWorkspaceExport(await file.text()), workspaces);
      setItems(plan); setChoices(plan.map(item => item.targetId)); setFileName(file.name);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'This file could not be read.'); }
    finally { setBusy(false); }
  }

  async function run() {
    setBusy(true); setError('');
    for (let index = 0; index < items.length; index += 1) {
      if (reports[index]?.state === 'saved' || reports[index]?.state === 'skipped') continue;
      try {
        const result = prepareWorkspaceImport(items[index], current(), choices[index]);
        if (!result.workspace) {
          setReports(previous => ({ ...previous, [index]: { state: 'skipped', message: 'Skipped; existing job kept.' } }));
          continue;
        }
        // Unknown outcomes retain this exact payload and workspace identity for Retry.
        const workspace = prepared.current.get(index) ?? result.workspace;
        prepared.current.set(index, workspace);
        await onImport(workspace);
        imported.current.set(workspace.id, workspace);
        setReports(previous => ({ ...previous, [index]: { state: 'saved', message: result.conflicts.length
          ? `Saved on this device. Existing values kept for: ${result.conflicts.join(', ')}.`
          : 'Saved on this device; cloud synchronization continues in the background.' } }));
      } catch (failure) {
        setReports(previous => ({ ...previous, [index]: { state: 'error', message: failure instanceof Error ? failure.message : 'Import failed. Retry this row.' } }));
      }
    }
    setBusy(false);
  }

  const unresolved = items.some((_, index) => !choices[index]);
  const unfinished = items.some((_, index) => !reports[index] || reports[index].state === 'error');
  return <section aria-label="Import generator jobs" style={{ display: 'grid', gap: 16 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
      <h2>Import document-generator jobs</h2>
      <button type="button" className="button" onClick={onDone} disabled={busy}>Done</button>
    </div>
    <p>In the document generator, open Jobs and choose “Export for combined app.” Select that JSON file here to preview saved jobs, device drafts, and queued work. Original jobs and Drive files stay available.</p>
    <label style={{ display: 'grid', gap: 8 }}>Generator export JSON
      <input type="file" accept=".json,application/json" disabled={busy} onChange={event => void load(event.target.files?.[0])} />
    </label>
    {error && <p role="alert">{error}</p>}
    {fileName && <p role="status">{fileName} · {items.length} import entries</p>}
    {items.map((item, index) => {
      const report = reports[index];
      let conflicts: string[] = [];
      let previewError = '';
      if (choices[index] && !report) {
        try { conflicts = prepareWorkspaceImport(item, current(), choices[index]).conflicts; }
        catch (failure) { previewError = failure instanceof Error ? failure.message : 'Choose another destination.'; }
      }
      const frozen = !!prepared.current.get(index) || item.targetId === 'skip' || report?.state === 'saved' || report?.state === 'skipped';
      return <article key={`${item.variant}-${item.sourceRecordId}-${index}`} style={{ border: '1px solid #e3e7ec', borderRadius: 8, padding: 16, display: 'grid', gap: 8 }}>
        <h3>{item.record?.customer.customerName || 'Source job'} · {item.record?.customer.jobNumber || item.sourceRecordId}</h3>
        <p>{item.variant.replaceAll('-', ' ')}{item.note ? ` — ${item.note}` : ''}</p>
        <label style={{ display: 'grid', gap: 6 }}>Destination for entry {index + 1}
          <select style={{ minHeight: 44, maxWidth: '100%' }} value={choices[index]} disabled={busy || frozen}
            onChange={event => setChoices(previous => previous.map((choice, row) => row === index ? event.target.value : choice))}>
            <option value="">Choose a destination</option>
            <option value="new">Create a separate job</option>
            <option value="skip">Skip this entry</option>
            {item.candidates.map(id => {
              const workspace = workspaces.find(candidate => candidate.id === id);
              return <option key={id} value={id}>Fill blanks in {workspace?.record.customer.customerName || 'saved job'} · {id.slice(-8)}</option>;
            })}
          </select>
        </label>
        {conflicts.length > 0 && <p>Existing values will be kept for: {conflicts.join(', ')}.</p>}
        {previewError && <p role="alert">{previewError}</p>}
        {report && <p role={report.state === 'error' ? 'alert' : 'status'}>{report.message}</p>}
      </article>;
    })}
    {items.length > 0 && <div>
      <button type="button" className="button primary" disabled={busy || unresolved || !unfinished} onClick={() => void run()}>
        {busy ? 'Importing…' : Object.values(reports).some(report => report.state === 'error') ? 'Retry failed entries' : 'Import selected entries'}
      </button>
      {unresolved && <p>Choose a destination or Skip for each ambiguous entry before importing.</p>}
    </div>}
  </section>;
}
