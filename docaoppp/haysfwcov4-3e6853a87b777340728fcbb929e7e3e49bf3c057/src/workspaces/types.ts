import type { RestorationJobData } from '../documents/types/jobData';
import type { JobStage } from '../types';

/** Permanent job identity; directory imports and request snapshots are independent. */
export interface Workspace {
  id: string;
  revision: number;
  updatedAt: string;
  record: RestorationJobData;
  originalContract: string;
  previousChanges: string;
  /** Job lifecycle stage for the CRM pipeline view. */
  stage?: JobStage;
  /** Links this permanent job to a CRM customer record. */
  customerId?: string;
  sourceRecordId?: string;
  migration?: { source: string; sourceRecordId: string; variant: string; sourceKey: string; importedAt: string; original: unknown };
}

export interface JobDocument {
  id: string;
  workspaceId: string;
  name: string;
  kind: string;
  driveFileId: string;
  inputFingerprint: string;
  templateVersion: number;
  createdAt: string;
}

export interface WorkspaceRow {
  workspace: Workspace;
  serverRevision: number;
  dirty: boolean;
  inFlight?: { workspace: Workspace; expectedRevision: number; mutationId: string };
  error?: string;
  conflict?: boolean;
  /** A competing editor draft; the current device copy stays intact until chosen. */
  localConflict?: Workspace;
}

export interface DocumentRow {
  document: JobDocument;
  data?: string;
  pending: boolean;
  mutationId?: string;
  error?: string;
}
