# Original Hays + Sons change-order form

Copied unchanged from `C:\Users\russe\haysdocuments` on October 13, 2026.
PDF editing support was additionally copied from
`C:\Users\russe\haysdocuments-2`. The four shared service/type files in the
source-file list below are byte-identical between those two projects.
This folder preserves the original form implementation for the next expansion
of the change-order app. It is outside the app's `src` directory and is not
connected to the current submission or PDF-generation flows.

## Source files

- `src/services/pdfService.ts`: `generateChangeOrder(data)` at line 1781
  draws the original one-page Letter-size **Change Order / Addendum** PDF.
  The complete source file is retained because the generator uses its shared
  logo, layout, currency, text, and editable-field helpers. It also contains
  generators for other documents from the source app.
- `src/types/jobData.ts`: `RestorationJobData`, `ChangeOrderData`, branch and
  customer types, and `createEmptyJob()` for initializing a record.
- `src/services/pdfFieldSchema.ts`: `PDF_FIELD_SCHEMA.change_order` describes
  the editable customer, job, insurance, branch, scope, pricing, and date fields.
- `src/components/SectionChangeOrder.tsx`: the original change-order entry form.
- `src/components/SectionPdfActions.tsx`: its preview/download controls.
- `src/services/documentCatalog.ts`: connects those controls to the generator
  and document filenames.
- `src/components/PdfPreviewModal.tsx`: the click-to-edit PDF preview from
  `haysdocuments-2`, with inline field widgets, a fields drawer, page navigation,
  zoom, print/download controls, and optional Drive-save callbacks.
- `pdf-editor-wiring.txt`: original excerpts from `haysdocuments-2/src/App.tsx`
  showing field-value coercion, record updates, regeneration, and preview props.
  These are wiring references, not a standalone component.
- `scripts/test-pdf-spans.ts` and `scripts/fixtures.ts`: the original span
  verification harness and sample records from `haysdocuments-2`.

All relative imports among these files are preserved. The generator draws the
letterhead in code and embeds standard PDF fonts, so it does not require an
external blank PDF, logo image, or font file. Dependencies are `pdf-lib` for
generation and `react`/`lucide-react` for the reference UI; this app already has
those packages. The preview also uses `pdfjs-dist` version `3.11.174`, which
matches this app. The reference UI uses the source app's Tailwind classes and
will need styling adapted to this app before use.

## How the PDF editor works

Call `generateDocWithSpans(generateChangeOrder, data)` to get PDF bytes and the
rectangles of editable values. Pass those bytes and spans to `PdfPreviewModal`,
along with `getPdfFieldSchema('change_order')`, the current record, and an
`onFieldChange` callback. The preview renders the PDF on a PDF.js canvas and
positions clickable field editors over those rectangles; its drawer also
offers all schema fields.

The parent callback updates the job record, converts numeric and Yes/No values
to the required types, and regenerates bytes and spans after a 300 ms debounce.
Downloads must use the latest record. The original parent wiring is saved in
`pdf-editor-wiring.txt` for reference; adapt its state and financial updates to
this app rather than pasting those excerpts directly.

This edits fields of generated documents. It does not provide arbitrary editing
of text or graphics in an uploaded PDF. Persisting edits and saving to Drive
are parent-app responsibilities supplied through callbacks.

Run the copied verification harness from this project root:

```powershell
node node_modules/tsx/dist/cli.mjs reference/change-order-form/scripts/test-pdf-spans.ts
```

It checks that generated documents have clickable spans for populated schema
fields, that spans use declared field keys, and that their rectangles stay
within the Letter-size pages. It does not test the preview UI or persistence.

## Field mapping for future integration

Start with `createEmptyJob()` and map the current saved `ChangeRequest`
into the source generator's data structure:

| Current app field | Original form field |
| --- | --- |
| `job.customer` | `customer.customerName` |
| `job.jobNumber` | `customer.jobNumber` |
| `job.address` | `customer.lossAddress` |
| `job.customerPhone` | `customer.mainPhone` |
| `job.customerEmail` | `customer.email` |
| `job.carrier` | `insurance.carrier` |
| `job.claim` | `insurance.claimNumber` |
| `job.branchName` | `branch.name` |
| `job.branchAddress` | Split into `branch.address` and `branch.cityStateZip` |
| `job.branchPhone` | `branch.phone` |
| `job.branchContact` | `branch.managerName` |
| `job.orderNumber` | `changeOrder.changeOrderNumber` |
| `job.date` | `changeOrder.changeOrderDate` |
| `job.insuranceRelated` | `changeOrder.isInsuranceRelated` |
| `job.originalContract` | `changeOrder.originalContractSum` |
| `job.previousChanges` | `changeOrder.netPreviousChanges` |
| Saved `finalChangeOrder.scope` | `changeOrder.scopeDescription` |
| Absolute saved `finalChangeOrder.amount` | `changeOrder.changeAmount` |
| Sign of saved `finalChangeOrder.amount` | `changeOrder.changeType`: `increase`, `decrease`, or `unchanged` |
| `job.addedDays` | `changeOrder.addedDays` |

The phone and email fields are available in the data model but are not printed
by this change-order generator. Map the finalized customer scope and price;
the submitted `knownChangeAmount` is not the estimator's final price.

Before connecting this code, preserve this app's required-field validation and
exact-cent money calculations. The original generator uses JavaScript numbers
and defaults missing prices to zero, and its scope box is limited to nine lines.
Those behaviors need adaptation so unknown prices remain unknown and longer
scopes are preserved. Importing `pdfService.ts` also patches `pdf-lib` prototypes
globally for text sanitization and field capture; extract the needed generator
and helpers deliberately before loading it alongside this app's current PDF
service.

The form includes insurance/non-insurance selections, payment wording, prior
and revised contract amounts, added days, and owner/contractor signature and
date lines. Existing text is preserved exactly in this reference copy.
