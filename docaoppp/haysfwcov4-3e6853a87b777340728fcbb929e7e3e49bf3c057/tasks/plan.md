# Combined documents and change orders

Approved goal: use haysfwco as one PWA with shared permanent job records, full document generation, estimate intake, related change requests and safe migration from haysdocuments-2.

Build order: workspace contract and durable storage; additive Apps Script endpoints; isolated document module; job navigation and prefilled requests; migration; browser/PDF/regression checks; backend then preview deployment.

Design: retain the existing white/slate/red app shell and review landing page. Jobs & Documents is a separate route. A job has Details, Documents, and Change Requests; forms remain grouped in optional sections. Keep mobile controls at least 44px. Show device save, queued sync, confirmed cloud save, conflict, and retry states distinctly. CSV imports are separate from permanent workspace records. Keep installed PWA identity and Apps Script/Sheets/Drive architecture. Never infer original contract from RCV or PM price as final customer price.
