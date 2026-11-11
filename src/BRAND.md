# Brand & UI Reference

**Hays + Sons — Restoration Document Suite**
Applies to the web app (`src/`), the generated PDF packet (`src/services/pdfService.ts`) and the
Google Sheets database header (`apps-script/Code.gs`).

---

## 1. Logo

The identity is a **red bar paired with a heavy black plus** — the "H+" mark — followed by the tight
`Hays+Sons` wordmark. It is vector geometry, so the app, the print packet and the icons all render
the same artwork.

| Element | Specification | Source |
| --- | --- | --- |
| Mark | Red bar `0,0 14x42` + black plus (stem `36,0 14x42`, crossbar `14,14 51x14`) on a 65x42 canvas | `src/components/BrandLogo.tsx` |
| Bar fill | Brand red `#DC2626` | |
| Plus fill | Logo ink `#1A1A1A` — white on dark surfaces | |
| Crossbar joint | Crossbar starts at `x=14`, exactly where the bar ends — **flush, no gap** | |
| Wordmark | `Hays+Sons` — 0.44x the mark height, `font-extrabold`, `tracking-tight` | |
| Sub-label | "Restoration Document Suite" — 0.31x the mark height, `slate-500` | |
| Favicon / icon source | Mark centred on a square, transparent field | `public/logo.svg` |

Rules that keep the mark coherent:

- The bar and the plus are **exactly the same height** and share one stroke width (14 units).
- The plus crossbar runs **flush into the bar** — separate them and the "H" reading is lost.
- The mark is **never** wrapped in a rounded square and **never** inverted to white-on-red.
- The wordmark has **no spaces** around the `+`.

The lockup is exported from `BrandLogo.tsx` (props: `size`, `withWordmark`, `sublabel`, `tone`). No
webfont is loaded, so the wordmark renders in the system sans and varies slightly per OS; the supplied
artwork uses a geometric face, so a licensed font swap is a change here plus the PDF font embed.

`drawHeaderLogo()` in `services/pdfService.ts` draws the identical geometry scaled to a 22pt height,
using the position by position rectangle coordinates, so the packet header and the app header match.

### Icon variants

`npm run icons` generates the favicon, PWA and desktop icons from `public/logo.svg` (see
`pwa-assets.config.ts`). Every raster variant sits on a **white** field: the mark's plus is near-black
and its bar is red, so a transparent icon would lose the plus on a dark wallpaper or taskbar and the
mark would read as a lone red bar. The in-app mark (`BrandLogo.tsx`) and the SVG favicon stay
transparent, because they sit on surfaces the app controls.

---

## 2. Colour

Deliberately narrow: **one brand red plus the neutral `slate` ramp**, with three semantic signals.

### Core palette

| Role | Token | Hex | Used for |
| --- | --- | --- | --- |
| Brand primary | `red-600` | `#DC2626` | Logo mark, Save, primary CTAs, active tab |
| Brand hover | `red-700` | `#B91C1C` | Button hover states |
| Focus | `red-500` | `#EF4444` | Input focus border and ring |
| Brand tint | `red-50` | `#FEF2F2` | Icon chips, file badges |
| Page canvas | `slate-50` | `#F8FAFC` | App background |
| Surface | `white` | `#FFFFFF` | Cards, header |
| Border | `slate-200` | `#E2E8F0` | All card and control borders |
| Text primary | `slate-900` | `#0F172A` | Headings, values |
| Text secondary | `slate-500` | `#64748B` | Labels, hints |
| Text tertiary | `slate-400` | `#94A3B8` | Placeholders, decorative icons |

### Semantic signals

| State | Token | Hex | Applied to |
| --- | --- | --- | --- |
| Saved / connected | `emerald-500` | `#10B981` | Header status dot |
| Unsaved / caution | `amber-500` | `#F59E0B` | Unsaved dot, developer-mode warning |
| Error | `rose-700` | `#BE123C` | Error copy |

### Brand red — unified

| Surface | Red | Source |
| --- | --- | --- |
| Web app | `#DC2626` | `--color-brand` in `src/index.css` |
| Generated PDFs | `#DC2626` | `COLOR_RED` in `pdfService.ts` |
| Google Sheet header | `#DC2626` | `applySheetFormatting_` in `Code.gs` |

These were previously three different reds (`red-600`, `#D91A1A`, `#B91C1C`), which is why printed
collateral never matched the app. They are now one token. `--color-brand` is deliberately equal to
Tailwind's `red-600`, so existing `bg-red-600` call sites are already correct and need no migration.

Logo ink is `#1A1A1A` (`--color-ink`), shared by the plus and the wordmark so the mark reads as one
unit. `COLOR_DARK` in `pdfService.ts` now uses the same value.

---

## 3. Typography

**Family:** no webfont is loaded. The stack is Tailwind's default `font-sans`
(`ui-sans-serif`, `system-ui`, `"Segoe UI"`, `Roboto`, ...), applied on the app root. Rendering
therefore varies by operating system.

| Role | Size | Weight | Notes |
| --- | --- | --- | --- |
| Headline figure | 24px | 600 | `tabular-nums` |
| Card / section title | 15px | 600 | `tracking-tight` on the wordmark |
| Body, inputs, buttons | 13px | 400-600 | |
| Labels, hints | 12px | 500 | |
| Micro (badges, filenames) | 11px | 500 | |
| Mono | 11px | | Filenames, job numbers |

All financial numerals use `tabular-nums` so columns do not shift as values change.

**Recommendation:** promote these sizes to named theme tokens (`text-body`, `text-title`) instead of
inline arbitrary values such as `text-[13px]`, which is how drift starts.

---

## 4. Surfaces, radius and elevation

| Layer | Radius | Elevation |
| --- | --- | --- |
| Controls (inputs, buttons) | `rounded-lg` — 8px | none; `shadow-sm` on primary only |
| Cards and panels | `rounded-xl` — 12px | none — **borders carry the structure** |
| Modals | `rounded-2xl` — 16px | `shadow-lg` / `shadow-2xl` |
| Toast | `rounded-xl` | `shadow-lg` |

Cards use a 1px `slate-200` border rather than drop shadows. Shadows are reserved for genuinely
floating layers, which is what keeps the interface from reading as decorative.

---

## 5. Layout and navigation

- **Canvas** — max-width 1400px, 20px gutters, `slate-50` background
- **Header** — sticky, 64px tall, white at 95% opacity with backdrop blur, 1px bottom border
- **Header order** — brand, job-context chip, Jobs, New job, primary Save job, account menu
- **Navigation** — grouped side menu for Workspace, Job details, Production, and Documents, with a
  red-tinted active item and counts for missing required fields. Tablets use a scrollable strip;
  phones use a grouped section picker. Team and Mortgage have separate pages.
- **Intake** — the dedicated Intake page shows upload, paste, and analysis controls. Other sections
  show a compact source summary when an intake exists. Navigation preserves in-progress analysis.
- **Job library** — searchable jobs with recent, customer, and job-number sorting. Continue editing
  opens the current workspace without replacing its draft with an older saved copy.
- **Content** — single column of cards on a 24px vertical rhythm
- **Control heights** — 44px for navigation and header actions, 40px for desktop form inputs

---

## 6. Component conventions

- **Icons** — `lucide-react`; 16px inline, 20px inside tiles. Icon tiles are `bg-slate-100` with
  `slate-500` glyphs. Colour is never used purely for decoration.
- **Inputs** — `slate-50` fill, white on focus; `slate-300` border, `red-500` plus a soft ring on focus.
- **Status** — always a coloured dot *plus* text, never colour alone.
- **Buttons** — one primary (red) action per view; everything else is a white bordered or ghost button.

---

## 7. Motion

Restrained and functional: `transition-colors` on interactive elements, `animate-spin` on loaders,
a 200ms slide-in for the toast, and a rotating chevron on the account menu. No spring, bounce or
parallax effects.

---

## 8. Accessibility

Contrast ratios measured against white:

| Pair | Ratio | Verdict |
| --- | --- | --- |
| `slate-900` text | 17.9:1 | Passes AAA |
| `slate-500` text | 4.76:1 | Passes AA |
| White on `red-600` | approx. 4.4:1 | Just under the 4.5:1 AA threshold for normal text |
| `slate-400` text | 2.56:1 | Fails AA — also below the 3:1 minimum for UI components |

**Actions:**

1. Darken placeholder and tertiary text from `slate-400` to `slate-500` (4.76:1).
2. Use `red-700` behind white button text (approx. 5.9:1).

---

## 9. Outstanding gaps

1. **Type scale is approximately 85% unified.** The legacy section components (`SectionInsurance`,
   `SectionTeam`, `SectionMortgage`, `SectionChangeOrder`, `SectionChecklist`) still use `text-sm`
   (14px) inputs and a few `text-[10px]` labels, while `Navbar`, `FinancialSummaryCard`,
   `SectionCustomer` and `DocumentGenerationPanel` use the 13px / 12px scale.
2. **No named type tokens** — sizes are inline arbitrary values.
3. **System font only** — Windows and macOS render the product differently. Consider a licensed or
   open typeface such as Inter if cross-platform consistency matters.
4. **White on red** is the only place brand red carries small text; verify in print, where `#DC2626`
   can shift noticeably.
