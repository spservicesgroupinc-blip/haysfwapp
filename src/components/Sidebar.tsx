import React from 'react';
import {
  Home,
  UserCircle,
  ShieldAlert,
  Coins,
  Users2,
  FileEdit,
  CheckCircle,
  StickyNote,
  FileCheck,
  FileInput,
  Landmark,
  AlertCircle,
  Upload,
  LayoutDashboard,
  ClipboardList,
  History,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/** Every page reachable from the workspace side menu. */
export type WorkspaceTab =
  | 'home'
  | 'customerImport'
  | 'intake'
  | 'dashboard'
  | 'tasks'
  | 'activity'
  | 'legacyChangeOrder'
  | 'customer'
  | 'insurance'
  | 'financials'
  | 'mortgage'
  | 'team'
  | 'changeOrder'
  | 'checklist'
  | 'productionNotes'
  | 'documents';

export interface WorkspaceSection {
  id: WorkspaceTab;
  label: string;
  icon: LucideIcon;
  group: 'Workspace' | 'Job details' | 'Production' | 'Documents';
}

/** Order mirrors the intake-to-production workflow. */
export const WORKSPACE_SECTIONS: WorkspaceSection[] = [
  { id: 'home', label: 'Jobs', icon: Home, group: 'Workspace' },
  { id: 'customerImport', label: 'Customer Knowledge Base', icon: Upload, group: 'Workspace' },
  { id: 'intake', label: 'Intake', icon: FileInput, group: 'Workspace' },
  { id: 'dashboard', label: 'Customer Dashboard', icon: LayoutDashboard, group: 'Job details' },
  { id: 'tasks', label: 'Tasks & Issues', icon: ClipboardList, group: 'Job details' },
  { id: 'activity', label: 'Activity', icon: History, group: 'Job details' },
  { id: 'customer', label: 'Customer & Property', icon: UserCircle, group: 'Job details' },
  { id: 'insurance', label: 'Insurance & Claim', icon: ShieldAlert, group: 'Job details' },
  { id: 'financials', label: 'Financials', icon: Coins, group: 'Job details' },
  { id: 'mortgage', label: 'Mortgage', icon: Landmark, group: 'Job details' },
  { id: 'team', label: 'Team', icon: Users2, group: 'Production' },
  { id: 'productionNotes', label: 'Production Notes', icon: StickyNote, group: 'Production' },
  { id: 'checklist', label: 'Checklist', icon: CheckCircle, group: 'Production' },
  { id: 'changeOrder', label: 'Change Orders', icon: FileEdit, group: 'Production' },
  { id: 'legacyChangeOrder', label: 'Legacy Change Order', icon: FileEdit, group: 'Production' },
  { id: 'documents', label: 'Documents', icon: FileCheck, group: 'Documents' },
];

const WORKSPACE_GROUPS = ['Workspace', 'Job details', 'Production', 'Documents'] as const;

interface NavItemProps {
  section: WorkspaceSection;
  isActive: boolean;
  badge?: number;
  missingFieldCount?: number;
  onNavigate: (tab: WorkspaceTab) => void;
  variant: 'sidebar' | 'strip';
}

const NavItem: React.FC<NavItemProps> = ({
  section,
  isActive,
  badge,
  missingFieldCount,
  onNavigate,
  variant,
}) => {
  const Icon = section.icon;
  const base =
    variant === 'sidebar'
      ? 'flex w-full items-center gap-2.5 px-2.5 min-h-11 rounded-lg text-[13px] font-medium border transition-colors'
      : 'inline-flex shrink-0 items-center gap-2 px-3 min-h-11 rounded-lg text-[13px] font-medium border transition-colors whitespace-nowrap';

  return (
    <button
      type="button"
      onClick={() => onNavigate(section.id)}
      aria-current={isActive ? 'page' : undefined}
      className={`${base} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-inset ${
        isActive
          ? 'bg-red-50 border-red-200 text-red-700'
          : 'bg-transparent border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900'
      }`}
    >
      <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-red-600' : 'text-slate-400'}`} aria-hidden />
      <span className={variant === 'sidebar' ? 'min-w-0 flex-1 text-left leading-4' : ''}>{section.label}</span>
      {typeof badge === 'number' && badge > 0 && (
        <span
          className={`${
            variant === 'sidebar' ? 'ml-auto' : ''
          } min-w-[18px] h-[18px] px-1 rounded text-[11px] font-bold flex items-center justify-center tabular-nums ${
            isActive ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'
          }`}
        >
          {badge}
        </span>
      )}
      {typeof missingFieldCount === 'number' && missingFieldCount > 0 && (
        <span
          title={`${missingFieldCount} required fields missing`}
          aria-label={`${missingFieldCount} required fields missing`}
          className="ml-auto inline-flex shrink-0 items-center gap-1 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800 tabular-nums"
        >
          <AlertCircle className="h-3 w-3" aria-hidden />
          {missingFieldCount}
        </span>
      )}
    </button>
  );
};

interface SidebarProps {
  activeTab: WorkspaceTab;
  onNavigate: (tab: WorkspaceTab) => void;
  savedJobsCount: number;
  customerName: string;
  jobNumber: string;
  isDirty: boolean;
  missingFieldCounts?: Partial<Record<WorkspaceTab, number>>;
}

/** Desktop side menu: one entry per section, plus the current record's context. */
export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onNavigate,
  savedJobsCount,
  customerName,
  jobNumber,
  isDirty,
  missingFieldCounts,
}) => {
  const hasCustomer = Boolean(customerName.trim());

  return (
    <aside
      className="hidden lg:flex flex-col w-60 shrink-0 self-start sticky top-20 max-h-[calc(100dvh-6rem)]"
      aria-label="Workspace navigation"
    >
      <div className="min-h-0 overflow-y-auto bg-white rounded-xl border border-slate-200 p-2">
        <nav aria-label="Job workspace" className="space-y-2">
          {WORKSPACE_GROUPS.map((group) => (
            <div key={group}>
              <p className="px-2.5 pt-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                {group}
              </p>
              <div className="space-y-0.5">
                {WORKSPACE_SECTIONS.filter((section) => section.group === group).map((section) => (
                  <NavItem
                    key={section.id}
                    section={section}
                    isActive={activeTab === section.id}
                    badge={section.id === 'home' ? savedJobsCount : undefined}
                    missingFieldCount={missingFieldCounts?.[section.id]}
                    onNavigate={onNavigate}
                    variant="sidebar"
                  />
                ))}
              </div>
            </div>
          ))}
        </nav>
      </div>

      {/* Current record context */}
      <div className="mt-3 shrink-0 bg-white rounded-xl border border-slate-200 px-3.5 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          Current job
        </p>
        <div className="mt-2 flex items-center gap-2">
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              hasCustomer ? (isDirty ? 'bg-amber-500' : 'bg-emerald-500') : 'bg-slate-300'
            }`}
            aria-hidden
          />
          <p className="text-[13px] font-semibold text-slate-900 truncate">
            {hasCustomer ? customerName : 'New job'}
          </p>
        </div>
        <p className="mt-1 text-[11px] text-slate-500 tabular-nums truncate">
          {jobNumber || 'No job number yet'}
        </p>
        {isDirty && (
          <span className="mt-2 inline-block text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
            Unsaved changes
          </span>
        )}
      </div>
    </aside>
  );
};

interface MobileSectionNavProps {
  activeTab: WorkspaceTab;
  onNavigate: (tab: WorkspaceTab) => void;
  savedJobsCount: number;
  missingFieldCounts?: Partial<Record<WorkspaceTab, number>>;
}

/** Phones use a section picker; tablets keep a scrollable navigation strip. */
export const MobileSectionNav: React.FC<MobileSectionNavProps> = ({
  activeTab,
  onNavigate,
  savedJobsCount,
  missingFieldCounts,
}) => (
  <div className="lg:hidden mb-4 min-w-0">
    <label className="block sm:hidden text-xs font-semibold text-slate-600 mb-1.5" htmlFor="workspace-section">
      Workspace section
    </label>
    <select
      id="workspace-section"
      value={activeTab}
      onChange={(event) => onNavigate(event.target.value as WorkspaceTab)}
      className="sm:hidden w-full min-w-0 min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-slate-900 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
    >
      {WORKSPACE_GROUPS.map((group) => (
        <optgroup key={group} label={group}>
          {WORKSPACE_SECTIONS.filter((section) => section.group === group).map((section) => (
            <option key={section.id} value={section.id}>
              {section.label}{section.id === 'home' && savedJobsCount > 0 ? ` (${savedJobsCount})` : ''}{(missingFieldCounts?.[section.id] ?? 0) > 0 ? ` — ${missingFieldCounts?.[section.id]} missing` : ''}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
    <nav className="hidden sm:flex gap-1 overflow-x-auto no-scrollbar" aria-label="Workspace navigation">
      {WORKSPACE_SECTIONS.map((section) => (
        <NavItem
          key={section.id}
          section={section}
          isActive={activeTab === section.id}
          badge={section.id === 'home' ? savedJobsCount : undefined}
          missingFieldCount={missingFieldCounts?.[section.id]}
          onNavigate={onNavigate}
          variant="strip"
        />
      ))}
    </nav>
  </div>
);
