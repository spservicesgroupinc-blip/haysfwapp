import React from 'react';
export const inputClass = 'w-full min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-600 disabled:bg-slate-100';
export const buttonClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 disabled:opacity-50';
export const primaryClass = `${buttonClass} !border-red-600 !bg-red-600 !text-white hover:!bg-red-700`;
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const id = React.useId();
  return <div className="min-w-0 space-y-1.5 text-sm font-medium text-slate-700"><label htmlFor={id} className="block">{label}</label>{React.isValidElement(children) ? React.cloneElement(children as React.ReactElement<{ id?: string }>, { id }) : children}</div>;
}
export function Badge({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700">{children}</span>;
}
