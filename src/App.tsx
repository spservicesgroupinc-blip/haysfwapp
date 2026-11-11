/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  RestorationJobData,
  CustomerData,
  InsuranceData,
  FinancialData,
  TeamData,
  MortgageData,
  ChangeOrderData,
  createEmptyJob,
  ensureRecordDefaults,
} from './types/jobData';
import {
  uploadPdfToGoogleDrive,
  syncJobToGoogleSheets,
} from './services/googleWorkspaceService';
import {
  downloadPdf,
  generateCompletePacket,
  generateDocWithSpans,
  type PdfFieldSpan,
} from './services/pdfService';
import { getPdfFieldSchema } from './services/pdfFieldSchema';
import type { JobDocument } from './services/documentCatalog';
import {
  isDatabaseConfigured,
  isDeveloperBypassEnabled,
  login as loginToDatabase,
  registerAccount,
  logout as logoutFromDatabase,
  verifySession,
  getCurrentUser,
  subscribeSession,
  AppUser,
} from './services/appsScriptService';
import {
  deleteJobOffline,
  getSyncState,
  initJobSync,
  loadJobOffline,
  readCachedJobSummaries,
  refreshJobs,
  restoreDraft,
  saveJobOffline,
  scheduleDraftSave,
  flushDraftSave,
  subscribeSyncState,
  type RestoredDraft,
  type SyncState,
} from './services/jobSync';
import type { SyncJobSummary } from './services/localDb';
import { LoginScreen } from './components/LoginScreen';
import { Navbar } from './components/Navbar';
import { MobileSectionNav, Sidebar, WORKSPACE_SECTIONS } from './components/Sidebar';
import type { WorkspaceTab } from './components/Sidebar';
import { SavedCustomersPage } from './components/SavedCustomersPage';
import { JobWorkspace } from './components/JobWorkspace';
import { CustomerImportPage } from './components/CustomerImportPage';
import { FinancialSummaryCard } from './components/FinancialSummaryCard';
import { SectionCustomer } from './components/SectionCustomer';
import { SectionInsurance } from './components/SectionInsurance';
import { SectionTeam } from './components/SectionTeam';
import { SectionMortgage } from './components/SectionMortgage';
import { SectionChangeOrder } from './components/SectionChangeOrder';
import { SectionChecklist } from './components/SectionChecklist';
import { SectionProductionNotes } from './components/SectionProductionNotes';
import { IntakeParserCard } from './components/IntakeParserCard';
import { DocumentGenerationPanel } from './components/DocumentGenerationPanel';
import { PdfPreviewModal } from './components/PdfPreviewModal';
import { ConfirmModal } from './components/ConfirmModal';
import { PwaStatus } from './components/PwaStatus';
import { ProvenanceRecord } from './services/intakeParser';
import { getMissingJobFields, type MissingJobField } from './services/jobReadiness';
import { recordChangeOrder } from './services/changeOrders';
import { CHECKLIST_BOXES } from './types/productionChecklist';
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';

export default function App() {
  const [jobData, setJobData] = useState<RestorationJobData>(() => createEmptyJob());
  const [provenance, setProvenance] = useState<ProvenanceRecord>({});
  const [intakeSession, setIntakeSession] = useState(0);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('home');

  // Shared document storage and database actions use the Apps Script account session.
  const [isDriveLoading, setIsDriveLoading] = useState(false);
  const [isSheetsLoading, setIsSheetsLoading] = useState(false);
  const [driveSuccessLink, setDriveSuccessLink] = useState<string | undefined>();
  const [sheetsSuccessLink, setSheetsSuccessLink] = useState<string | undefined>();

  // Preview Modal state
  const [previewTitle, setPreviewTitle] = useState<string>('');
  const [previewDoc, setPreviewDoc] = useState<JobDocument | null>(null);
  const previewSnapshotRef = React.useRef<RestorationJobData | null>(null);
  const [isSnapshotPreview, setIsSnapshotPreview] = useState(false);
  const [ledgerDocument, setLedgerDocument] = useState<{ recordId: string; label: string; changeOrder: ChangeOrderData } | null>(null);
  const handleDocumentOrder = React.useCallback((next: { recordId: string; label: string; changeOrder: ChangeOrderData } | null) => {
    setLedgerDocument(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
  }, []);
  const documentData = (snapshot: RestorationJobData): RestorationJobData => ledgerDocument && ledgerDocument.recordId === snapshot.recordId
    ? { ...snapshot, changeOrderHistory: [], changeOrder: ledgerDocument.changeOrder } : snapshot;
  const [previewBytes, setPreviewBytes] = useState<Uint8Array | null>(null);
  const [previewSpans, setPreviewSpans] = useState<PdfFieldSpan[]>([]);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isPreviewRegenerating, setIsPreviewRegenerating] = useState(false);

  // Latest job record for async PDF work (generators must read the freshest state).
  const jobDataRef = React.useRef<RestorationJobData>(jobData);
  const previewRegenTimerRef = React.useRef<number | null>(null);

  jobDataRef.current = jobData;

  // Confirm Modal state (for Workspace changes)
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    action: () => Promise<void>;
    confirmLabel: string;
    isDanger?: boolean;
  }>({
    isOpen: false,
    title: '',
    message: '',
    action: async () => {},
    confirmLabel: 'Confirm',
  });

  // Notification Banner
  const [statusNotification, setStatusNotification] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);

  // ---- Customer database (Google Apps Script) state ----------------------
  const [recordId, setRecordId] = useState<string | undefined>(undefined);
  const [isDirty, setIsDirty] = useState(false);
  const [isSavingJob, setIsSavingJob] = useState(false);
  const [savedJobs, setSavedJobs] = useState<SyncJobSummary[]>([]);
  const [isLoadingJobs, setIsLoadingJobs] = useState(false);
  const [jobListError, setJobListError] = useState<string | null>(null);
  const [jobSearch, setJobSearch] = useState('');
  const [databaseEmail, setDatabaseEmail] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<AppUser | null>(() => getCurrentUser());
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>(getSyncState);

  // Dirty tracking compares the record against the last saved/loaded baseline,
  // so programmatic whole-record replacements never look like user edits.
  const baselineRef = React.useRef<string>(JSON.stringify(jobData));
  // True once the workspace has been filled from the shared/draft copy, so a
  // later sign-in does not overwrite work already on screen.
  const draftRestoredRef = React.useRef(false);
  const lastDraftScheduledRef = React.useRef<string>('');
  const saveInProgressRef = React.useRef(false);
  const workspaceGenerationRef = React.useRef(0);
  const workspaceSessionRef = React.useRef(0);
  const jobLoadRequestRef = React.useRef(0);
  const fieldToFocusRef = React.useRef<string | null>(null);
  const notificationTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setIsDirty(JSON.stringify(jobData) !== baselineRef.current);
  }, [jobData]);

  useEffect(() => {
    if (!fieldToFocusRef.current) return;
    document.getElementById(fieldToFocusRef.current)?.focus();
    fieldToFocusRef.current = null;
  }, [activeTab]);

  /** Replaces the whole record and treats it as the new clean baseline. */
  const replaceJob = (next: RestorationJobData) => {
    workspaceGenerationRef.current++;
    const normalized = ensureRecordDefaults(next);
    baselineRef.current = JSON.stringify(normalized);
    jobDataRef.current = normalized;
    setJobData(normalized);
    setIsDirty(false);
  };

  /** Discards intake and document state belonging to the previous workspace. */
  const clearJobArtifacts = () => {
    workspaceSessionRef.current++;
    setProvenance({});
    setIntakeSession((previous) => previous + 1);
    setDriveSuccessLink(undefined);
    setSheetsSuccessLink(undefined);
    setIsPreviewOpen(false);
    setPreviewTitle('');
    setPreviewDoc(null);
    setPreviewBytes(null);
    setPreviewSpans([]);
    setIsPreviewLoading(false);
    setIsPreviewRegenerating(false);
    if (previewRegenTimerRef.current !== null) {
      window.clearTimeout(previewRegenTimerRef.current);
      previewRegenTimerRef.current = null;
    }
  };

  // Offline-first sync engine: connectivity listeners, outbox flush, status.
  useEffect(() => initJobSync(), []);
  useEffect(() => subscribeSyncState(setSyncState), []);
  useEffect(() => subscribeSession((next) => {
    setCurrentUser(next);
    if (!next) {
      draftRestoredRef.current = false;
      setWorkspaceReady(false);
    }
  }), []);
  useEffect(() => {
    if (!currentUser && !isDeveloperBypassEnabled()) return;
    void readCachedJobSummaries().then(setSavedJobs).catch(() => {});
  }, [syncState.lastSyncAt, currentUser]);

  // Autosave the workspace record (debounced) so a reload never loses work…
  useEffect(() => {
    if (!workspaceReady || (!currentUser && !isDeveloperBypassEnabled())) return;
    const serialized = JSON.stringify({ jobData, recordId });
    if (serialized === lastDraftScheduledRef.current) return;
    lastDraftScheduledRef.current = serialized;
    scheduleDraftSave(jobData, recordId);
  }, [jobData, recordId, workspaceReady, currentUser]);

  // Restore after authentication, before autosave can publish the empty form.
  useEffect(() => {
    if (!isAuthReady || draftRestoredRef.current) return;
    if (!getCurrentUser() && !isDeveloperBypassEnabled()) return;
    let cancelled = false;
    let restoredSnapshot = jobDataRef.current;
    const apply = (draft: RestoredDraft) => {
      if (cancelled || jobDataRef.current !== restoredSnapshot) return;
      const normalized = ensureRecordDefaults(draft.job);
      baselineRef.current = JSON.stringify(normalized);
      restoredSnapshot = normalized;
      jobDataRef.current = normalized;
      lastDraftScheduledRef.current = JSON.stringify({ jobData: normalized, recordId: draft.recordId ?? draft.job.recordId });
      setJobData(normalized);
      setRecordId(draft.recordId ?? draft.job.recordId);
      setWorkspaceReady(true);
    };
    void restoreDraft(apply).then((draft) => {
      if (cancelled) return;
      if (draft) apply(draft);
      else lastDraftScheduledRef.current = JSON.stringify({ jobData: jobDataRef.current, recordId: undefined });
      draftRestoredRef.current = true;
      setWorkspaceReady(true);
    }).catch((err) => {
      if (!cancelled) { setWorkspaceReady(true); showStatus('error', err?.message || 'Could not restore the workspace draft.'); }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthReady, currentUser]);

  // Restore and verify any stored session before rendering the app.
  useEffect(() => {
    let cancelled = false;

    const restore = async () => {
      if (isDeveloperBypassEnabled() || !isDatabaseConfigured() || !getCurrentUser()) {
        if (!cancelled) setIsAuthReady(true);
        return;
      }
      try {
        const user = await verifySession();
        if (!cancelled) setCurrentUser(user);
      } catch (err) {
        console.warn('Session verification failed:', err);
      } finally {
        if (!cancelled) setIsAuthReady(true);
      }
    };

    restore();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRefreshJobs = async () => {
    const owner = getCurrentUser()?.email;
    setIsLoadingJobs(true);
    setJobListError(null);
    // Paint the cached list instantly, then reconcile with the server.
    try {
      const cached = await readCachedJobSummaries();
      if (getCurrentUser()?.email !== owner) return;
      if (cached.length) setSavedJobs(cached);
      const result = await refreshJobs();
      if (getCurrentUser()?.email !== owner) return;
      setSavedJobs(result.jobs);
      setJobListError(result.error ?? null);
    } catch (err) {
      setJobListError(err instanceof Error ? err.message : 'Could not load saved customers.');
    } finally { if (getCurrentUser()?.email === owner) setIsLoadingJobs(false); }
  };

  // Load the saved-customer list as soon as the workspace becomes available.
  useEffect(() => {
    if (!isAuthReady || !isDatabaseConfigured()) return;
    if (!currentUser && !isDeveloperBypassEnabled()) return;
    void handleRefreshJobs();
    // handleRefreshJobs is rebuilt every render; it is intentionally excluded here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthReady, currentUser]);

  /** Jump to the Saved Customers home page with a fresh list. */
  const handleOpenSavedCustomers = async () => {
    setActiveTab('home');
    await handleRefreshJobs();
  };

  /** Side-menu navigation. Returning home always refreshes the saved list. */
  const handleNavigate = (tab: WorkspaceTab) => {
    setActiveTab(tab);
    if (tab === 'home') void handleRefreshJobs();
  };

  const handleReviewField = (field: MissingJobField) => {
    fieldToFocusRef.current = field.inputId;
    setActiveTab(field.section);
  };

  const handleAppSignIn = async (email: string, password: string) => {
    const user = await loginToDatabase(email, password);
    setCurrentUser(user);
    setDatabaseEmail(user.email);
    showStatus('success', `Signed in as ${user.name || user.email}.`);
  };

  const handleAppRegister = async (values: {
    name: string;
    email: string;
    password: string;
    inviteCode: string;
  }) => {
    const user = await registerAccount(values);
    setCurrentUser(user);
    setDatabaseEmail(user.email);
    showStatus('success', `Account created. Welcome, ${user.name || user.email}.`);
  };

  const handleAppSignOut = async () => {
    try { await flushDraftSave(); }
    catch (err: any) { showStatus('error', err?.message || 'Could not save your draft before signing out.'); return; }
    await logoutFromDatabase();
    setCurrentUser(null);
    setDatabaseEmail(null);
    setSavedJobs([]);
    setRecordId(undefined);
    replaceJob(createEmptyJob());
    clearJobArtifacts();
    draftRestoredRef.current = false;
    lastDraftScheduledRef.current = '';
    setWorkspaceReady(false);
    showStatus('info', 'Signed out.');
  };

  const handleSaveJob = async () => {
    if (saveInProgressRef.current) return;
    saveInProgressRef.current = true;
    const snapshot = jobDataRef.current;
    const generation = workspaceGenerationRef.current;
    setIsSavingJob(true);
    try {
      const outcome = await saveJobOffline({ ...snapshot, recordId: snapshot.recordId ?? recordId });
      // Never replace edits made while device persistence was in flight.
      if (workspaceGenerationRef.current === generation && jobDataRef.current === snapshot) {
        setRecordId(outcome.recordId);
        replaceJob(outcome.record);
      } else if (workspaceGenerationRef.current === generation) {
        setRecordId(outcome.recordId);
        setJobData(prev => ({ ...prev, recordId: outcome.recordId }));
      }
      if (outcome.queued) {
        showStatus(
          'info',
          `Job ${snapshot.customer.jobNumber || ''} saved on this device. ${navigator.onLine ? 'Syncing to the customer database.' : 'It will sync when the connection returns.'}`
        );
      } else {
        showStatus(
          'success',
          outcome.created
            ? `Saved job ${jobData.customer.jobNumber} to the customer database.`
            : `Updated job ${jobData.customer.jobNumber} in the customer database.`
        );
      }
      void readCachedJobSummaries().then(setSavedJobs).catch(() => {});
    } catch (err: any) {
      showStatus('error', err?.message || 'Could not save to the customer database.');
    } finally {
      saveInProgressRef.current = false;
      setIsSavingJob(false);
    }
  };

  const handleLoadJob = async (id: string) => {
    // Continue editing the open workspace without replacing its draft with a saved copy.
    if (recordId === id) {
      setActiveTab('dashboard');
      return;
    }
    const request = ++jobLoadRequestRef.current;
    const session = workspaceSessionRef.current;
    try {
      // Keep the document draft discoverable in Jobs before replacing the form.
      if (isDirty) {
        await flushDraftSave();
        await saveJobOffline(jobDataRef.current);
      }
      const { job, fromCache } = await loadJobOffline(id);
      if (request !== jobLoadRequestRef.current || session !== workspaceSessionRef.current) return;
      replaceJob(job);
      setRecordId(job.recordId ?? id);
      clearJobArtifacts();
      setActiveTab('dashboard');
      const who = job.customer.customerName || 'record';
      const label = `(${job.customer.jobNumber || 'no job number'})`;
      showStatus(
        fromCache ? 'info' : 'success',
        fromCache ? `Opened ${who} ${label} from this device's saved copy.` : `Opened ${who} ${label}.`
      );
    } catch (err: any) {
      if (request !== jobLoadRequestRef.current || session !== workspaceSessionRef.current) return;
      showStatus('error', err?.message || 'Could not open that saved job.');
    }
  };

  const handleDeleteJob = (job: SyncJobSummary) => {
    setConfirmDialog({
      isOpen: true,
      title: 'Delete this saved job?',
      message: `This removes ${job.customerName || 'this record'} (${job.jobNumber || 'no job number'}) from the customer database. The audit log keeps a record of the deletion.`,
      confirmLabel: 'Delete Job',
      isDanger: true,
      action: async () => {
        try {
          const outcome = await deleteJobOffline(job.recordId);
          if (recordId === job.recordId) setRecordId(undefined);
          showStatus(
            'info',
            outcome.queued
              ? 'Saved job deleted on this device — the database will catch up when online.'
              : 'Saved job deleted.'
          );
          await handleRefreshJobs();
        } catch (err: any) {
          showStatus('error', err?.message || 'Could not delete that job.');
        }
      },
    });
  };

  const showStatus = (type: 'success' | 'error' | 'info', message: string) => {
    setStatusNotification({ type, message });
    if (notificationTimerRef.current) clearTimeout(notificationTimerRef.current);
    notificationTimerRef.current = setTimeout(() => {
      setStatusNotification(null);
    }, 5000);
  };

  // Recalculate Financials whenever RCV or Deductible changes
  const computeFinancialRecord = (
    current: RestorationJobData,
    rcvVal: number | '',
    dedVal: number | ''
  ): RestorationJobData => {
    const rcv = typeof rcvVal === 'number' && !isNaN(rcvVal) ? rcvVal : 0;
    const deductible = typeof dedVal === 'number' && !isNaN(dedVal) ? dedVal : 0;

    const netClaimValue = Math.max(0, rcv - deductible);
    const downPayment = rcv * 0.5; // 50%
    const midProgressPayment = rcv * 0.25; // 25%
    const balancePayment = rcv * 0.25; // 25%

    return {
      ...current,
      financials: {
        ...current.financials,
        totalApprovedRcv: rcvVal,
        deductible: dedVal,
        netClaimValue,
        downPayment,
        midProgressPayment,
        balancePayment,
      },
    };
  };

  const updateFinancials = (rcvVal: number | '', dedVal: number | '') => {
    setJobData((prev) => computeFinancialRecord(prev, rcvVal, dedVal));
  };

  // Field change handlers
  const handleCustomerChange = (field: keyof CustomerData, value: string) => {
    setJobData((prev) => ({
      ...prev,
      customer: { ...prev.customer, [field]: value },
    }));
  };

  const handleInsuranceChange = (field: keyof InsuranceData, value: any) => {
    setJobData((prev) => ({
      ...prev,
      insurance: { ...prev.insurance, [field]: value },
    }));
  };

  const handleTeamChange = (field: keyof TeamData, value: string) => {
    setJobData((prev) => ({
      ...prev,
      team: { ...prev.team, [field]: value },
    }));
  };

  const handleMortgageChange = (field: keyof MortgageData, value: any) => {
    setJobData((prev) => ({
      ...prev,
      mortgage: { ...prev.mortgage, [field]: value },
    }));
  };

  const handleChangeOrderChange = (field: keyof ChangeOrderData, value: any) => {
    setJobData((prev) => ({
      ...prev,
      changeOrder: { ...prev.changeOrder, [field]: value },
    }));
  };

  const handleRecordChangeOrder = async () => {
    if (saveInProgressRef.current) return;
    const snapshot = jobDataRef.current;
    const generation = workspaceGenerationRef.current;
    saveInProgressRef.current = true;
    setIsSavingJob(true);
    try {
      const next = recordChangeOrder(snapshot);
      const outcome = await saveJobOffline(next);
      if (workspaceGenerationRef.current !== generation) return;
      // A recorded order must survive an immediate reload, without waiting for
      // the normal debounced workspace autosave after the next render.
      scheduleDraftSave(outcome.record, outcome.recordId);
      await flushDraftSave();
      if (workspaceGenerationRef.current !== generation) return;
      setRecordId(outcome.recordId);
      if (jobDataRef.current === snapshot) replaceJob(outcome.record);
      else setJobData(latest => ({ ...latest, recordId: outcome.recordId,
        changeOrderHistory: next.changeOrderHistory, changeOrder: next.changeOrder }));
      void readCachedJobSummaries().then(setSavedJobs).catch(() => {});
      showStatus('success', `${snapshot.changeOrder.changeOrderNumber} recorded on this device and queued for sync. ${next.changeOrder.changeOrderNumber} is ready.`);
    } catch (err: any) {
      showStatus('error', err?.message || 'Could not record this change order.');
    } finally {
      saveInProgressRef.current = false;
      setIsSavingJob(false);
    }
  };

  const handleChecklistChange = (
    field: keyof RestorationJobData['checklist'],
    value: any
  ) => {
    setJobData((prev) => ({
      ...prev,
      checklist: { ...prev.checklist, [field]: value },
    }));
  };

  const handleProductionNotesChange = (
    field: keyof RestorationJobData['productionNotes'],
    value: string
  ) => {
    setJobData((prev) => ({
      ...prev,
      productionNotes: { ...prev.productionNotes, [field]: value },
    }));
  };

  // Preview Document Handler
  const handleOpenPreview = async (doc: JobDocument, snapshot?: RestorationJobData) => {
    if (!snapshot && doc.id === 'change_order' && ledgerDocument?.recordId === jobDataRef.current.recordId) snapshot = documentData(jobDataRef.current);
    previewSnapshotRef.current = snapshot ?? null;
    setIsSnapshotPreview(!!snapshot);
    setPreviewTitle(doc.title);
    setPreviewDoc(doc);
    setPreviewBytes(null);
    setPreviewSpans([]);
    setIsPreviewOpen(true);
    setIsPreviewLoading(true);

    try {
      const { bytes, spans } = await generateDocWithSpans(doc.generator, snapshot ?? jobDataRef.current);
      setPreviewBytes(bytes);
      setPreviewSpans(spans);
    } catch (err: any) {
      console.error('Failed generating preview:', err);
      showStatus('error', 'Error generating PDF preview');
    } finally {
      setIsPreviewLoading(false);
    }
  };

  /** Debounced live regeneration after a click-to-edit change in the preview. */
  const regeneratePreview = (doc: JobDocument, data: RestorationJobData) => {
    if (previewRegenTimerRef.current !== null) {
      window.clearTimeout(previewRegenTimerRef.current);
    }
    previewRegenTimerRef.current = window.setTimeout(async () => {
      setIsPreviewRegenerating(true);
      try {
        const { bytes, spans } = await generateDocWithSpans(doc.generator, data);
        setPreviewBytes(bytes);
        setPreviewSpans(spans);
      } catch (err: any) {
        console.error('Failed regenerating preview:', err);
        showStatus('error', 'Error refreshing PDF preview');
      } finally {
        setIsPreviewRegenerating(false);
      }
    }, 300);
  };

  // Fields whose PDF editor widgets commit 'Yes'/'No' instead of raw booleans.
  const BOOLEAN_PDF_FIELDS = new Set<string>([
    ...CHECKLIST_BOXES.map(item => `checklist.${item.key}`),
    'mortgage.hasMortgage',
    'changeOrder.isInsuranceRelated',
    'checklist.isSelfPay',
    'checklist.isProgramClaim',
    'checklist.hasCheckBeenSent',
    'checklist.isDepreciationWithheld',
  ]);

  // Fields stored as number | '' that the PDF editor edits as free text.
  const NUMERIC_PDF_FIELDS = new Set<string>([
    'changeOrder.originalContractSum',
    'changeOrder.netPreviousChanges',
    'changeOrder.changeAmount',
    'changeOrder.addedDays',
    'checklist.depreciationAmount',
  ]);

  const coercePdfFieldValue = (field: string, value: string): string | number | boolean => {
    if (BOOLEAN_PDF_FIELDS.has(field)) {
      const lower = value.toLowerCase();
      return lower === 'yes' ? true : lower === 'no' ? false : value;
    }
    if (NUMERIC_PDF_FIELDS.has(field)) {
      if (value === '') return '';
      const n = Number(value);
      return Number.isNaN(n) ? '' : n;
    }
    return value;
  };

  /** Routes an edit from the click-to-edit PDF preview into the job record. */
  const handlePdfFieldChange = (field: string, value: string) => {
    if (jobDataRef.current.changeOrderHistory?.length &&
      ['changeOrder.originalContractSum', 'changeOrder.netPreviousChanges'].includes(field)) return;
    const dot = field.indexOf('.');
    if (dot === -1) return;
    const section = field.slice(0, dot);
    const fieldName = field.slice(dot + 1);

    const current = jobDataRef.current;
    let next: RestorationJobData;

    if (section === 'financials') {
      if (fieldName === 'totalApprovedRcv' || fieldName === 'deductible') {
        const num = value === '' ? '' : Number(value);
        const parsed = typeof num === 'number' && !Number.isNaN(num) ? num : '';
        next = computeFinancialRecord(
          current,
          fieldName === 'totalApprovedRcv' ? parsed : current.financials.totalApprovedRcv,
          fieldName === 'deductible' ? parsed : current.financials.deductible
        );
      } else {
        // commenceDays / completeDays are day counts.
        next = {
          ...current,
          financials: {
            ...current.financials,
            [fieldName]: value === '' ? 0 : Number(value) || 0,
          },
        };
      }
    } else if (section === 'branch') {
      next = { ...current, branch: { ...current.branch, [fieldName]: value } };
    } else if (
      section === 'customer' ||
      section === 'insurance' ||
      section === 'team' ||
      section === 'mortgage' ||
      section === 'changeOrder' ||
      section === 'checklist' ||
      section === 'productionNotes'
    ) {
      const nextRaw: any = { ...current };
      nextRaw[section] = {
        ...(current as any)[section],
        [fieldName]: coercePdfFieldValue(field, value),
      };
      next = nextRaw as RestorationJobData;
    } else {
      return;
    }

    jobDataRef.current = next;
    setJobData(next);

    if (previewDoc) {
      regeneratePreview(previewDoc, next);
    }
  };

  const handlePreviewDownload = async () => {
    if (!previewDoc) return;
    try {
      const snapshot = previewSnapshotRef.current ?? jobDataRef.current;
      const bytes = await previewDoc.generator(snapshot);
      downloadPdf(bytes, previewDoc.buildFileName(snapshot));
    } catch (err) {
      console.error('Download error:', err);
    }
  };

  // Save the CURRENTLY previewed document to Google Drive (per-document upload).
  const handleSaveDocToDrive = () => {
    if (!previewDoc) return;
    const doc = previewDoc;
    const snapshot = previewSnapshotRef.current ?? jobDataRef.current;
    const session = workspaceSessionRef.current;
    const fileName = doc.buildFileName(snapshot);

    setConfirmDialog({
      isOpen: true,
      title: `Save ${doc.title} to Google Drive?`,
      message: `This will generate ${doc.title} for Job #${snapshot.customer.jobNumber} and save it in the shared Google Drive folder managed by the app's Google Apps Script backend.`,
      confirmLabel: 'Upload to Drive',
      action: async () => {
        setIsDriveLoading(true);
        try {
          const pdfBytes = await doc.generator(snapshot);
          const result = await uploadPdfToGoogleDrive(pdfBytes, fileName);
          if (session !== workspaceSessionRef.current) return;
          setDriveSuccessLink(result.webViewLink);
          showStatus('success', `Saved "${fileName}" to shared Google Drive storage.`);
        } catch (err: any) {
          if (session !== workspaceSessionRef.current) return;
          console.error('Drive save error:', err);
          showStatus('error', err.message || 'Failed to save to Google Drive');
        } finally {
          setIsDriveLoading(false);
        }
      },
    });
  };

  // Save to Google Drive with Mandatory User Confirmation
  const handleSaveToDrive = () => {
    const snapshot = documentData(jobDataRef.current);
    const session = workspaceSessionRef.current;
    const fileName = `${snapshot.customer.jobNumber}_Complete_Packet_${snapshot.customer.customerName}.pdf`;

    setConfirmDialog({
      isOpen: true,
      title: 'Save Packet to Google Drive?',
      message: `This will generate the complete Hays + Sons restoration packet for Job #${snapshot.customer.jobNumber} (${snapshot.customer.customerName}) and save it in the shared Google Drive folder managed by the app's Google Apps Script backend.`,
      confirmLabel: 'Upload to Drive',
      action: async () => {
        setIsDriveLoading(true);
        try {
          const pdfBytes = await generateCompletePacket(snapshot);
          const result = await uploadPdfToGoogleDrive(pdfBytes, fileName);
          if (session !== workspaceSessionRef.current) return;
          setDriveSuccessLink(result.webViewLink);
          showStatus('success', `Saved "${fileName}" to shared Google Drive storage.`);
        } catch (err: any) {
          if (session !== workspaceSessionRef.current) return;
          console.error('Drive save error:', err);
          showStatus('error', err.message || 'Failed to save to Google Drive');
        } finally {
          setIsDriveLoading(false);
        }
      },
    });
  };

  // Sync to Google Sheets with Mandatory User Confirmation
  const handleSyncToSheets = () => {
    const snapshot = jobDataRef.current;
    const session = workspaceSessionRef.current;
    setConfirmDialog({
      isOpen: true,
      title: 'Sync Job to Google Sheets?',
      message: `This will save Job #${snapshot.customer.jobNumber} (${snapshot.customer.customerName}), including its financial figures and team assignments, to the app's shared Google Apps Script database. An existing job is updated in its current row.`,
      confirmLabel: 'Sync to Sheets',
      action: async () => {
        setIsSheetsLoading(true);
        try {
          const result = await syncJobToGoogleSheets(snapshot);
          if (session !== workspaceSessionRef.current) return;
          setSheetsSuccessLink(result.spreadsheetUrl);
          showStatus('success', `Saved Job #${snapshot.customer.jobNumber} to the shared Google Sheets database.`);
        } catch (err: any) {
          if (session !== workspaceSessionRef.current) return;
          console.error('Sheets sync error:', err);
          showStatus('error', err.message || 'Failed to sync to Google Sheets');
        } finally {
          setIsSheetsLoading(false);
        }
      },
    });
  };

  // Reset Job with Confirmation
  const handleReset = () => {
    setConfirmDialog({
      isOpen: true,
      title: 'Start New Restoration Job?',
      message:
        'This will remove the uploaded intake file, pasted text, and analysis results, and reset all job fields to their defaults. Make sure you have downloaded or saved any needed PDF documents first.',
      confirmLabel: 'Clear All Fields',
      isDanger: true,
      action: async () => {
        const blankJob = createEmptyJob();
        replaceJob(blankJob);
        setRecordId(undefined);
        clearJobArtifacts();
        setActiveTab('intake');
        // Persist the cleared workspace immediately instead of waiting for autosave.
        lastDraftScheduledRef.current = JSON.stringify({ jobData: blankJob, recordId: undefined });
        scheduleDraftSave(blankJob);
        try {
          await flushDraftSave();
        } catch (err: any) {
          showStatus('error', err?.message || 'Could not save the cleared workspace on this device.');
          return;
        }
        showStatus('info', 'New blank job created — not yet saved to the database.');
      },
    });
  };

  const handleApplyIntake = (newJob: RestorationJobData, newProv: ProvenanceRecord) => {
    replaceJob(newJob);
    setRecordId(newJob.recordId);
    setProvenance(newProv);
    const who = newJob.customer.customerName || 'new intake';
    showStatus('success', `Master Job Record updated from intake (${who}) - all production documents refreshed.`);
  };

  const missingFieldCounts: Partial<Record<WorkspaceTab, number>> = {};
  for (const field of getMissingJobFields(jobData)) {
    missingFieldCounts[field.section] = (missingFieldCounts[field.section] ?? 0) + 1;
  }
  const jobSections = WORKSPACE_SECTIONS.filter((section) => section.id !== 'home' && section.id !== 'customerImport');
  const sectionIndex = jobSections.findIndex((section) => section.id === activeTab);
  const previousSection = sectionIndex > 0 ? jobSections[sectionIndex - 1] : undefined;
  const nextSection = sectionIndex >= 0 ? jobSections[sectionIndex + 1] : undefined;

  // Auth gate — the workspace is only reachable once signed in (or in developer mode).
  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!currentUser && !isDeveloperBypassEnabled()) {
    return (
      <>
        <LoginScreen
          onSubmit={handleAppSignIn}
          onRegister={handleAppRegister}
          isDatabaseConfigured={isDatabaseConfigured()}
        />
        <PwaStatus />
      </>
    );
  }

  if (!workspaceReady) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center gap-2 text-sm text-slate-500" role="status">
      <Loader2 className="w-5 h-5 animate-spin" /> Restoring your workspace…
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans flex flex-col">
      {/* Top Navbar */}
      <Navbar
        jobNumber={jobData.customer.jobNumber}
        customerName={jobData.customer.customerName}
        onReset={handleReset}
        isDirty={isDirty}
        isSavingJob={isSavingJob}
        savedJobsCount={savedJobs.length}
        databaseEmail={currentUser ? currentUser.email : null}
        isDatabaseConfigured={isDatabaseConfigured()}
        isDeveloperBypass={isDeveloperBypassEnabled()}
        onSaveJob={handleSaveJob}
        onOpenSavedCustomers={handleOpenSavedCustomers}
        onSignOut={handleAppSignOut}
        pendingSyncCount={syncState.pendingCount}
        isOffline={!syncState.online}
        draftStatus={syncState.draftStatus}
        isSyncing={syncState.syncing}
      />

      {/* Status toast */}
      {statusNotification && (
        <div className="fixed top-[calc(5rem+env(safe-area-inset-top))] inset-x-4 sm:inset-x-auto sm:right-5 z-50 animate-in slide-in-from-top-2 duration-200">
          <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-lg w-full sm:w-auto sm:max-w-sm">
            <span
              className={`mt-1 w-2 h-2 rounded-full shrink-0 ${
                statusNotification.type === 'success'
                  ? 'bg-emerald-500'
                  : statusNotification.type === 'error'
                  ? 'bg-red-500'
                  : 'bg-slate-400'
              }`}
            />
            <p className="text-[13px] font-medium text-slate-800 leading-snug">
              {statusNotification.message}
            </p>
          </div>
        </div>
      )}

      {/* Main */}
      <main className="flex-1 w-full min-w-0 max-w-[1400px] mx-auto px-3 py-4 sm:px-5 sm:py-6">
        {activeTab !== 'home' && (
          <div className="mb-4 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm lg:hidden" aria-label="Current job">
            <span className="font-semibold text-slate-900">{jobData.customer.customerName || 'New job'}</span>
            <span className="text-slate-500">· {jobData.customer.jobNumber}</span>
          </div>
        )}
        {/* Compact section menu below the lg breakpoint */}
        <MobileSectionNav
          activeTab={activeTab}
          onNavigate={handleNavigate}
          savedJobsCount={savedJobs.length}
          missingFieldCounts={missingFieldCounts}
        />

        <div className="flex items-start gap-6">
          {/* Side menu — one entry per section */}
          <Sidebar
            activeTab={activeTab}
            onNavigate={handleNavigate}
            savedJobsCount={savedJobs.length}
            customerName={jobData.customer.customerName}
            jobNumber={jobData.customer.jobNumber}
            isDirty={isDirty}
            missingFieldCounts={missingFieldCounts}
          />

          {/* Section workspace */}
          <div className="flex-1 min-w-0 space-y-4 sm:space-y-6">
            {/* Keep intake mounted across sections so navigation preserves pending analysis. */}
            <IntakeParserCard
              key={intakeSession}
              onApplyIntake={handleApplyIntake}
              currentJob={jobData}
              currentProvenance={provenance}
              isExpanded={activeTab === 'intake'}
              onExpand={() => handleNavigate('intake')}
            />

            {activeTab === 'home' && (
              <SavedCustomersPage
                jobs={savedJobs}
                isLoading={isLoadingJobs}
                error={jobListError}
                search={jobSearch}
                currentRecordId={recordId}
                isDatabaseConfigured={isDatabaseConfigured()}
                databaseEmail={currentUser ? currentUser.email : null}
                isDeveloperBypass={isDeveloperBypassEnabled()}
                onSearchChange={setJobSearch}
                onRefresh={handleRefreshJobs}
                onOpenJob={handleLoadJob}
                onDeleteJob={handleDeleteJob}
                onNewJob={handleReset}
                onImportCustomers={() => handleNavigate('customerImport')}
              />
            )}

            <JobWorkspace
              key={`${currentUser?.email || 'developer'}:${recordId || 'unsaved'}`}
              job={jobData} recordId={recordId} tab={activeTab} navigate={handleNavigate}
              preview={handleOpenPreview} online={syncState.online}
              onDocumentOrder={handleDocumentOrder}
            />

            {activeTab === 'customerImport' && (
              <CustomerImportPage
                key={currentUser?.email || 'developer'}
                canImport={isDeveloperBypassEnabled() || currentUser?.role === 'admin' || currentUser?.role === 'editor'}
                onOpenIntake={() => handleNavigate('intake')}
              />
            )}

            {activeTab === 'customer' && (
              <SectionCustomer
                data={jobData.customer}
                jobData={jobData}
                onPreview={handleOpenPreview}
                onChange={handleCustomerChange}
              />
            )}

            {activeTab === 'insurance' && (
              <SectionInsurance
                data={jobData.insurance}
                jobData={jobData}
                onPreview={handleOpenPreview}
                onChange={handleInsuranceChange}
              />
            )}

            {activeTab === 'financials' && (
              <FinancialSummaryCard
                financials={jobData.financials}
                jobData={jobData}
                onPreview={handleOpenPreview}
                onRcvChange={(val) => updateFinancials(val, jobData.financials.deductible)}
                onDeductibleChange={(val) =>
                  updateFinancials(jobData.financials.totalApprovedRcv, val)
                }
              />
            )}

            {activeTab === 'team' && (
              <SectionTeam
                data={jobData.team}
                branch={jobData.branch}
                jobData={jobData}
                onPreview={handleOpenPreview}
                onChange={handleTeamChange}
              />
            )}

            {activeTab === 'mortgage' && (
              <SectionMortgage
                data={jobData.mortgage}
                jobData={jobData}
                onPreview={handleOpenPreview}
                onChange={handleMortgageChange}
              />
            )}

            {activeTab === 'legacyChangeOrder' && (
              <SectionChangeOrder
                data={jobData.changeOrder}
                jobData={jobData}
                onPreview={doc => handleOpenPreview(doc, jobData)}
                onChange={handleChangeOrderChange}
                onRecordOrder={handleRecordChangeOrder}
                isSaving={isSavingJob}
              />
            )}

            {activeTab === 'checklist' && (
              <SectionChecklist
                checklist={jobData.checklist}
                jobData={jobData}
                onPreview={handleOpenPreview}
                onChange={handleChecklistChange}
              />
            )}

            {activeTab === 'productionNotes' && (
              <SectionProductionNotes
                productionNotes={jobData.productionNotes}
                jobData={jobData}
                onPreview={handleOpenPreview}
                onChange={handleProductionNotesChange}
              />
            )}

            {activeTab === 'documents' && (
              <>
              <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
                Change order used in documents and the complete packet: <strong>{ledgerDocument && ledgerDocument.recordId === recordId ? ledgerDocument.label : 'Legacy job form (unreviewed)'}</strong>.
                <button className="ml-2 min-h-11 font-semibold text-red-700 underline" onClick={() => handleNavigate('changeOrder')}>Choose a change order</button>
              </div>
              <DocumentGenerationPanel
                jobData={documentData(jobData)}
                onPreview={handleOpenPreview}
                onSaveToDrive={handleSaveToDrive}
                onSyncToSheets={handleSyncToSheets}
                isDriveLoading={isDriveLoading}
                isSheetsLoading={isSheetsLoading}
                driveSuccessLink={driveSuccessLink}
                sheetsSuccessLink={sheetsSuccessLink}
                onReviewField={handleReviewField}
              />
              </>
            )}

            {activeTab !== 'home' && activeTab !== 'customerImport' && (
              <nav className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4" aria-label="Job section actions">
                {previousSection ? (
                  <button type="button" onClick={() => handleNavigate(previousSection.id)} className="inline-flex min-h-10 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-white hover:text-slate-900">
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                    {previousSection.label}
                  </button>
                ) : <span className="text-sm text-slate-500">Upload an intake or enter the job details manually.</span>}
                {nextSection && (
                  <button type="button" onClick={() => handleNavigate(nextSection.id)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:border-slate-400 hover:bg-slate-50">
                    Next: {nextSection.label}
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </nav>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 mt-auto">
        <div className="max-w-[1400px] mx-auto px-3 sm:px-5 py-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-center sm:text-left text-[12px] text-slate-500">
          <p className="font-medium text-slate-600">
            Hays &amp; Sons Complete Restoration — Fort Wayne Division
          </p>
          <p className="tabular-nums">909 Production Road, Fort Wayne, IN 46808 · 1-260-471-9110</p>
        </div>
      </footer>

      {/* PDF In-App Preview Modal (click-to-edit) */}
      <PdfPreviewModal
        isOpen={isPreviewOpen}
        title={previewTitle}
        pdfBytes={previewBytes}
        isLoading={isPreviewLoading}
        isRegenerating={isPreviewRegenerating}
        onClose={() => {
          setIsPreviewOpen(false);
          setPreviewBytes(null);
          setPreviewDoc(null);
          setPreviewSpans([]);
          if (previewRegenTimerRef.current !== null) {
            window.clearTimeout(previewRegenTimerRef.current);
            previewRegenTimerRef.current = null;
          }
        }}
        onDownload={handlePreviewDownload}
        jobData={previewSnapshotRef.current ?? jobData}
        editableFields={previewDoc && !isSnapshotPreview ? getPdfFieldSchema(previewDoc.id).filter(field => !jobData.changeOrderHistory?.length || !['changeOrder.originalContractSum', 'changeOrder.netPreviousChanges'].includes(field.key)) : []}
        spans={isSnapshotPreview ? [] : previewSpans}
        onFieldChange={isSnapshotPreview ? undefined : handlePdfFieldChange}
        onSaveToDrive={previewDoc ? handleSaveDocToDrive : undefined}
        isDriveLoading={isDriveLoading}
        driveSuccessLink={driveSuccessLink}
      />

      {/* Workspace / Destructive Confirmation Modal */}
      <ConfirmModal
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        confirmLabel={confirmDialog.confirmLabel}
        isDanger={confirmDialog.isDanger}
        onCancel={() => setConfirmDialog((prev) => ({ ...prev, isOpen: false }))}
        onConfirm={async () => {
          const action = confirmDialog.action;
          setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
          await action();
        }}
      />

      {/* PWA install / update prompt + offline + pending-sync status */}
      <PwaStatus />
    </div>
  );
}
