import type { JobStage } from "../types";

export type { JobStage };

/** Deduplicated customer master record. */
export interface Customer {
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  cityStateZip?: string;
  tags?: string[];
  /** IDs of customers that were merged into this one. */
  mergedFromIds?: string[];
}

/** Lightweight row for the customer directory list. */
export interface CustomerSummary {
  id: string;
  revision?: number;
  createdAt?: string;
  cityStateZip?: string;
  mergedFromIds?: string[];
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  tags?: string[];
  jobCount: number;
  openTaskCount: number;
  updatedAt: string;
}

export type ActivityKind =
  | "note"
  | "call"
  | "email"
  | "sms"
  | "meeting"
  | "other"
  | "status_change"
  | "stage_change"
  | "request_submitted"
  | "email_sent"
  | "task_completed";

export type ActivityDirection = "inbound" | "outbound" | "system";

/**
 * One entry in a customer's timeline: free-text notes, logged communications,
 * and system-generated events all share this shape.
 */
export interface Activity {
  id: string;
  customerId: string;
  workspaceId?: string;
  kind: ActivityKind;
  direction: ActivityDirection;
  body: string;
  at: string; // ISO timestamp
  by?: string;
}

export type TaskStatus = "open" | "done";

/** A follow-up task/reminder linked to a customer and optionally a job. */
export interface Task {
  id: string;
  customerId: string;
  workspaceId?: string;
  title: string;
  dueDate?: string; // YYYY-MM-DD
  assignee?: string;
  status: TaskStatus;
  revision: number;
  createdAt: string;
  completedAt?: string;
}

export interface NewCustomerInput {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  cityStateZip?: string;
  tags?: string[];
}

export interface NewTaskInput {
  title: string;
  dueDate?: string;
  assignee?: string;
}

export interface NewCommunicationInput {
  kind: "call" | "email" | "sms" | "meeting" | "other";
  direction: "inbound" | "outbound";
  summary: string;
  by?: string;
}
