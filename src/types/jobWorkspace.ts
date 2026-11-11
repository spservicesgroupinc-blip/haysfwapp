/** Dashboard records are independent of the document's whole-job JSON. */
export type WorkspaceKind = 'workItem' | 'comment' | 'changeOrder' | 'contract';
export type WorkStatus = 'Open' | 'In Progress' | 'Blocked' | 'Done' | 'Cancelled';
export type ChangeStatus = 'Draft' | 'Submitted' | 'Approved' | 'Rejected' | 'Voided';
export interface WorkspaceEntity {
  id: string;
  recordId: string;
  kind: WorkspaceKind;
  revision: number;
  updatedAt: string;
  updatedBy: string;
  data: Record<string, any>;
}
export interface WorkspaceMutation {
  operationId: string;
  recordId: string;
  id: string;
  kind: WorkspaceKind;
  expectedRevision: number;
  financialRevision?: string;
  data: Record<string, any>;
}
export interface WorkspaceActivity {
  id: string;
  entityId?: string;
  at: string;
  actor: string;
  detail: string;
}
export interface StaffMember { email: string; name: string }
export interface WorkspaceSnapshot {
  entities: WorkspaceEntity[];
  activity: WorkspaceActivity[];
  staff: StaffMember[];
  fetchedAt: string;
}
