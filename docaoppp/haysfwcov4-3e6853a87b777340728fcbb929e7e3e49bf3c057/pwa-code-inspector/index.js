/**
 * PWA Code Inspector — Host half.
 *
 * A professional PWA web app developer, installed as a DSH plugin:
 *  - serves one inspection operation through three entry points:
 *      GET /pwa-inspector/inspect?url=…   (the panel's data route)
 *      tool `webapp_inspect`              (agent-facing)
 *      command `/pwa-inspect <url>`       (chat shortcut)
 *  - registers the `pwa-webapp-inspector` skill so the assistant can adopt
 *    the expert persona: PWA architecture, smartphone formatting, and
 *    logic-flow debugging.
 *
 * Zero runtime dependencies; Node 20+ globals only (fetch, AbortController).
 */

export const inject = ['tools', 'skills', 'commands', 'webServer']

const PKG = '@local/pwa-code-inspector'
const SKILL_NAME = 'pwa-webapp-inspector'

const MAX_DOC_BYTES = 2 * 1024 * 1024
const MAX_MANIFEST_BYTES = 256 * 1024
const MAX_SCRIPT_BYTES = 512 * 1024
const MAX_EXTERNAL_SCRIPTS = 3
const FETCH_TIMEOUT_MS = 15000

/* ------------------------------------------------------------------ */
/* Fetch helpers                                                       */
/* ------------------------------------------------------------------ */

function safeUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null
  let url
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  return url
}

/** Fetch a URL with a timeout and a byte cap; follows redirects. */
async function fetchCapped(rawUrl, limit) {
  const url = safeUrl(rawUrl)
  if (!url) return { ok: false, error: 'invalid-url' }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url.href, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        accept: '*/*',
        'user-agent': 'PWA-Code-Inspector/1.0',
      },
    })
    const status = res.status
    const statusText = res.statusText
    const chunks = []
    let received = 0
    let truncated = false
    if (res.body) {
      const reader = res.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        received += value.byteLength
        if (received > limit) {
          const keep = limit - (received - value.byteLength)
          if (keep > 0) chunks.push(value.subarray(0, keep))
          truncated = true
          break
        }
        chunks.push(value)
      }
    }
    const text = Buffer.concat(chunks).toString('utf8')
    return {
      ok: status >= 200 && status < 400,
      status,
      statusText,
      text,
      truncated,
      finalUrl: res.url || url.href,
      error: status >= 200 && status < 400 ? null : `http-${status}`,
    }
  } catch (err) {
    const aborted = err && err.name === 'AbortError'
    return { ok: false, error: aborted ? 'timeout' : 'network', detail: aborted ? null : String(err && err.message) }
  } finally {
    clearTimeout(timer)
  }
}

function attrValue(tag, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
  const m = re.exec(tag)
  if (!m) return null
  return (m[2] ?? m[3] ?? m[4] ?? '').trim()
}

/* ------------------------------------------------------------------ */
/* Logic-flow static scan                                              */
/* ------------------------------------------------------------------ */

function assignmentInCondition(line) {
  // A bare `=` inside an if/while/for condition that is not part of
  // ==, ===, !=, !==, <=, >=, =>, =~ or a default assignment.
  const open = /(?:if|while|for)\s*\(/.exec(line)
  if (!open) return false
  const cond = line.slice(open.index + open[0].length)
  const close = cond.indexOf(')')
  if (close < 0) return false
  const body = cond.slice(0, close)
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== '=') continue
    const before = body[i - 1]
    const after = body[i + 1]
    if (before === '=' || after === '=') continue // == ===
    if (before === '!' || before === '<' || before === '>' || after === '>') continue // != <= >= =>
    if (before === '~') continue
    return true
  }
  return false
}

function scanLogic(source, label) {
  const findings = []
  const lines = source.split(/\r?\n/)
  let thenCount = 0
  let catchCount = 0
  let forInCount = 0
  let hasOwnGuard = /\bhasOwnProperty\s*\(/.test(source)
  let switchOpen = -1

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNo = i + 1
    const push = (severity, category, title, detail) => findings.push({
      severity, category: 'logic', title, detail, location: `${label}:${lineNo}`,
      snippet: line.trim().slice(0, 160),
    })

    if (assignmentInCondition(line)) {
      push('error', 'Assignment in condition', `\`if/while (x = y)\` assigns instead of comparing. Use \`===\`.`)
    }
    if (/[^=!<>]==[^=]/.test(line) && /(?:if|while|for)\s*\(/.test(line)) {
      push('warning', 'Loose equality in condition', `\`==\` coerces types. Prefer \`===\` to avoid surprising control flow.`)
    }
    if (/set(?:Timeout|Interval)\s*\(\s*['"`]/.test(line)) {
      push('error', 'String timer callback', `Passing a string to setTimeout/setInterval is eval-like and breaks bundlers and CSP. Pass a function.`)
    }
    if (/\bdocument\.write\s*\(/.test(line)) {
      push('warning', 'document.write', `Blocks parsing and delays first paint on mobile networks. Replace with DOM APIs.`)
    }
    if (/\b(?:alert|confirm|prompt)\s*\(/.test(line)) {
      push('warning', 'Blocking dialog', `alert/confirm/prompt block the main thread and are poor UX on smartphones. Use inline UI.`)
    }
    if (/\bthen\s*\(/.test(line)) thenCount++
    if (/\bcatch\s*\(/.test(line)) catchCount++
    if (/for\s*\(\s*(?:var|let|const)?\s*[\w$]+\s+in\s+/.test(line)) forInCount++

    if (switchOpen < 0 && /\bswitch\s*\(/.test(line)) {
      switchOpen = i
      if (!/\{/.test(line)) switchOpen = i // brace likely on next line; scan from here
    }
    if (switchOpen >= 0 && /\bdefault\s*:/.test(line)) {
      switchOpen = -2 // found
    }
  }

  if (switchOpen >= 0) {
    findings.push({
      severity: 'error', category: 'logic', title: 'switch without default',
      detail: `A switch with no default branch silently ignores unexpected values. Add a default arm.`,
      location: `${label}:${switchOpen + 1}`,
      snippet: lines[switchOpen]?.trim().slice(0, 160) ?? '',
    })
  }
  if (thenCount > 0 && catchCount === 0) {
    findings.push({
      severity: 'warning', category: 'logic', title: 'Promise chain without catch',
      detail: `${thenCount} .then() call(s) and no .catch(): rejections can pass silently. Handle errors or add .catch().`,
      location: label, snippet: '',
    })
  }
  if (forInCount > 0 && !hasOwnGuard) {
    findings.push({
      severity: 'info', category: 'logic', title: 'for…in over object',
      detail: `for…in walks the prototype chain. Iterate Object.keys/entries or guard with hasOwnProperty.`,
      location: label, snippet: '',
    })
  }
  return findings
}

/* ------------------------------------------------------------------ */
/* HTML / CSS parsing                                                  */
/* ------------------------------------------------------------------ */

function parseDocument(html, finalUrl) {
  const base = new URL(finalUrl)
  const get = (re, group = 1) => {
    const m = re.exec(html)
    return m ? (m[group] ?? '').trim() : null
  }
  const title = get(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const charset = get(/<meta[^>]+charset\s*=\s*["']?([\w-]+)/i)
  const viewportTag = get(/<meta[^>]+name\s*=\s*["']?viewport["']?[^>]*>/i, 0)
  const viewportContent = viewportTag ? attrValue(viewportTag, 'content') : null
  const themeColor = get(/<meta[^>]+name\s*=\s*["']?theme-color["']?[^>]*>/i, 0)
  const themeColorValue = themeColor ? attrValue(themeColor, 'content') : null
  const appleTouchTag = get(/<link[^>]+rel\s*=\s*["'][^"']*apple-touch-icon[^"']*["'][^>]*>/i, 0)
  const manifestTag = get(/<link[^>]+rel\s*=\s*["'][^"']*\bmanifest\b[^"']*["'][^>]*>/i, 0)
  const manifestHref = manifestTag ? attrValue(manifestTag, 'href') : null

  const inlineScripts = []
  const externalScripts = []
  const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi
  let sm
  while ((sm = scriptRe.exec(html))) {
    const attrs = sm[1] || ''
    const src = attrValue(attrs, 'src')
    if (src) externalScripts.push(src)
    else if (sm[2] && sm[2].trim()) inlineScripts.push(sm[2])
  }
  const stylesheetHrefs = []
  const linkRe = /<link\b([^>]*)>/gi
  let lm
  while ((lm = linkRe.exec(html))) {
    const attrs = lm[1] || ''
    const rel = attrValue(attrs, 'rel') || ''
    if (/\bstylesheet\b/i.test(rel)) {
      const href = attrValue(attrs, 'href')
      if (href) stylesheetHrefs.push(href)
    }
  }
  const styleBlocks = []
  const styleRe = /<style\b[^>]*>([\s\S]*?)<\/style>/gi
  let stm
  while ((stm = styleRe.exec(html))) {
    if (stm[1] && stm[1].trim()) styleBlocks.push(stm[1])
  }
  const inlineStyleAttrs = []
  const styleAttrRe = /\sstyle\s*=\s*("([^"]*)"|'([^']*)')/gi
  let sam
  while ((sam = styleAttrRe.exec(html))) inlineStyleAttrs.push(sam[2] ?? sam[3] ?? '')

  return {
    title, charset, viewportContent, themeColorValue, appleTouchTag: !!appleTouchTag,
    manifestHref: manifestHref ? new URL(manifestHref, base).href : null,
    inlineScripts, externalScripts, stylesheetHrefs, styleBlocks, inlineStyleAttrs,
  }
}

function scanMobileCss(cssPieces) {
  const findings = []
  let mediaQueryCount = 0
  const seenSmall = new Set()
  const seenWide = new Set()
  for (const css of cssPieces) {
    mediaQueryCount += (css.match(/@media/g) || []).length
    for (const m of css.matchAll(/font-size\s*:\s*(1[01]|\d)(?:\.\d+)?px/gi)) {
      const key = m[0].toLowerCase()
      if (!seenSmall.has(key)) {
        seenSmall.add(key)
        findings.push({
          severity: 'warning', category: 'smartphone', title: 'Small font size',
          detail: `\`${m[0].trim()}\` is hard to read on phones; 16px is the recommended base.`,
          location: 'CSS', snippet: m[0].trim(),
        })
      }
    }
    for (const m of css.matchAll(/width\s*:\s*(?:[4-9]\d{2,}|\d{4,})px/gi)) {
      const key = m[0].toLowerCase()
      if (!seenWide.has(key)) {
        seenWide.add(key)
        findings.push({
          severity: 'warning', category: 'smartphone', title: 'Fixed pixel width wider than a phone',
          detail: `\`${m[0].trim()}\` overflows most phone viewports. Use max-width: 100% with fluid units.`,
          location: 'CSS', snippet: m[0].trim(),
        })
      }
    }
  }
  return { findings, mediaQueryCount }
}

/* ------------------------------------------------------------------ */
/* Inspection                                                          */
/* ------------------------------------------------------------------ */

async function inspectWebApp(rawUrl) {
  const url = safeUrl(rawUrl)
  if (!url) return { ok: false, error: 'invalid-url' }
  const page = await fetchCapped(url.href, MAX_DOC_BYTES)
  if (!page.ok) {
    return { ok: false, error: page.error, status: page.status, statusText: page.statusText, detail: page.detail, url: url.href }
  }

  const doc = parseDocument(page.text, page.finalUrl)
  const findings = []

  /* — Smartphone formatting — */
  const viewport = doc.viewportContent || ''
  const userScalableNo = /user-scalable\s*=\s*no/i.test(viewport)
  const widthDevice = /width\s*=\s*device-width/i.test(viewport)
  const initialScale = /initial-scale\s*=\s*(1|1\.0)\b/.test(viewport)
  const cssPieces = [...doc.styleBlocks, ...doc.inlineStyleAttrs]
  const mobile = scanMobileCss(cssPieces)
  if (!doc.viewportContent) {
    findings.push({
      severity: 'error', category: 'smartphone', title: 'Missing viewport meta tag',
      detail: `Without \`<meta name="viewport">\` phones render at a 980px desktop width. Add \`<meta name="viewport" content="width=device-width, initial-scale=1">\`.`,
      location: 'HTML <head>', snippet: '',
    })
  } else {
    if (!widthDevice) findings.push({
      severity: 'error', category: 'smartphone', title: 'Viewport is not device-width',
      detail: `\`content="${viewport}"\` does not use \`width=device-width\`, so the page scales instead of adapting.`,
      location: 'HTML <head>', snippet: `<meta name="viewport" content="${viewport}">`,
    })
    if (!initialScale) findings.push({
      severity: 'warning', category: 'smartphone', title: 'Missing initial-scale',
      detail: `Add \`initial-scale=1\` so the first paint matches the phone exactly.`,
      location: 'HTML <head>', snippet: `<meta name="viewport" content="${viewport}">`,
    })
    if (userScalableNo) findings.push({
      severity: 'error', category: 'smartphone', title: 'Zoom is disabled (user-scalable=no)',
      detail: `Blocks pinch-zoom and fails WCAG 1.4.4. Remove \`user-scalable=no\`. Text size controls and zoom must stay available.`,
      location: 'HTML <head>', snippet: `<meta name="viewport" content="${viewport}">`,
    })
  }
  if (mobile.mediaQueryCount === 0 && (doc.styleBlocks.length > 0 || doc.inlineStyleAttrs.length > 0)) {
    findings.push({
      severity: 'info', category: 'smartphone', title: 'No media queries found',
      detail: `The page has CSS but no \`@media\` rules; verify the layout actually adapts at 360px and 768px widths.`,
      location: 'CSS', snippet: '',
    })
  }
  findings.push(...mobile.findings)

  /* — PWA readiness — */
  const manifest = { href: doc.manifestHref, ok: false }
  if (doc.manifestHref) {
    const mf = await fetchCapped(doc.manifestHref, MAX_MANIFEST_BYTES)
    if (mf.ok && mf.text) {
      try {
        const data = JSON.parse(mf.text)
        manifest.data = data
        manifest.ok = true
        manifest.name = data.name ?? data.short_name ?? null
        manifest.shortName = data.short_name ?? null
        manifest.display = data.display ?? null
        manifest.startUrl = data.start_url ?? null
        manifest.icons = Array.isArray(data.icons) ? data.icons : []
        manifest.has192 = manifest.icons.some((i) => /192/.test(String(i.sizes ?? '')) || i.size === 192)
        manifest.has512 = manifest.icons.some((i) => /512/.test(String(i.sizes ?? '')) || i.size === 512)
        manifest.hasMaskable = manifest.icons.some((i) => String(i.purpose ?? '').includes('maskable'))
      } catch {
        manifest.parseError = true
      }
    } else {
      manifest.fetchError = mf.error
    }
  }
  if (!doc.manifestHref) {
    findings.push({
      severity: 'error', category: 'pwa', title: 'No web app manifest',
      detail: `Add \`<link rel="manifest" href="/manifest.webmanifest">\` with name, icons, start_url, and display so the app is installable and opens standalone.`,
      location: 'HTML <head>', snippet: '',
    })
  } else if (!manifest.ok) {
    findings.push({
      severity: 'error', category: 'pwa', title: 'Manifest is unreachable or invalid',
      detail: manifest.parseError ? 'The manifest is not valid JSON.' : `Could not fetch the manifest (${manifest.fetchError ?? 'network error'}).`,
      location: doc.manifestHref, snippet: '',
    })
  } else {
    if (!manifest.name) findings.push({
      severity: 'error', category: 'pwa', title: 'Manifest has no app name',
      detail: `Set \`name\` (and \`short_name\`) so the install prompt and home screen label the app.`,
      location: doc.manifestHref, snippet: '',
    })
    if (!manifest.startUrl) findings.push({
      severity: 'warning', category: 'pwa', title: 'Manifest has no start_url',
      detail: `Without \`start_url\` the app may launch at the wrong page after install.`,
      location: doc.manifestHref, snippet: '',
    })
    if (!manifest.display || manifest.display === 'browser') findings.push({
      severity: 'warning', category: 'pwa', title: 'Not standalone',
      detail: `Set \`"display": "standalone"\` (or fullscreen/minimal-ui) so the app opens without browser chrome on phones.`,
      location: doc.manifestHref, snippet: `"display": ${JSON.stringify(manifest.display)}`,
    })
    if (!manifest.has192 || !manifest.has512) findings.push({
      severity: 'error', category: 'pwa', title: 'Missing install icons',
      detail: `Provide 192px and 512px PNG icons (a maskable one too) or the install prompt will not appear on phones.`,
      location: doc.manifestHref, snippet: '',
    })
    if (manifest.icons.length > 0 && !manifest.hasMaskable) findings.push({
      severity: 'info', category: 'pwa', title: 'No maskable icon',
      detail: `A \`"purpose": "maskable"\` icon keeps the app looking right when Android shapes it.`,
      location: doc.manifestHref, snippet: '',
    })
  }
  if (url.protocol !== 'https:') {
    findings.push({
      severity: 'error', category: 'pwa', title: 'Not served over HTTPS',
      detail: `Service workers and installability require HTTPS (localhost is exempt for development).`,
      location: url.href, snippet: '',
    })
  }
  if (!doc.themeColorValue) {
    findings.push({
      severity: 'info', category: 'pwa', title: 'No theme-color',
      detail: `Add \`<meta name="theme-color">\` (and manifest \`theme_color\`) so the status bar and splash match the app.`,
      location: 'HTML <head>', snippet: '',
    })
  }
  if (!doc.appleTouchTag) {
    findings.push({
      severity: 'info', category: 'pwa', title: 'No Apple touch icon',
      detail: `Add \`<link rel="apple-touch-icon" href="icon-180.png">\` for iOS home-screen icons.`,
      location: 'HTML <head>', snippet: '',
    })
  }

  /* — Service worker — */
  const swRefs = []
  for (const src of doc.inlineScripts) {
    const m = /navigator\.serviceWorker\s*\.\s*register\s*\(\s*['"]([^'"]+)['"]/.exec(src)
    if (m) swRefs.push(m[1])
  }
  const serviceWorker = { detected: swRefs.length > 0, hrefs: swRefs, reachable: null }
  if (swRefs.length > 0) {
    const swHref = new URL(swRefs[0], page.finalUrl).href
    const sw = await fetchCapped(swHref, 64 * 1024)
    serviceWorker.reachable = sw.ok
    if (!sw.ok) findings.push({
      severity: 'error', category: 'pwa', title: 'Service worker does not respond',
      detail: `The registered service worker could not be fetched (${sw.error ?? sw.status}). It must exist at its URL and serve 200.`,
      location: swHref, snippet: '',
    })
  } else {
    findings.push({
      severity: 'error', category: 'pwa', title: 'No service worker',
      detail: `Register one to make the app work offline and earn the install prompt: \`navigator.serviceWorker.register('/sw.js')\`.`,
      location: 'JS', snippet: '',
    })
  }

  /* — Logic flow — */
  let scannedFiles = 0
  for (const src of doc.inlineScripts) scannedFiles += 1, findings.push(...scanLogic(src, `inline#${scannedFiles}`))
  const external = doc.externalScripts.slice(0, MAX_EXTERNAL_SCRIPTS)
  for (const src of external) {
    const abs = new URL(src, page.finalUrl).href
    const js = await fetchCapped(abs, MAX_SCRIPT_BYTES)
    if (js.ok) findings.push(...scanLogic(js.text, new URL(abs).pathname.split('/').pop() || abs))
  }
  if (doc.externalScripts.length > MAX_EXTERNAL_SCRIPTS) {
    findings.push({
      severity: 'info', category: 'logic', title: 'Script scan limited',
      detail: `${doc.externalScripts.length - MAX_EXTERNAL_SCRIPTS} more script files were not scanned; ask the PWA expert for a deep review.`,
      location: '', snippet: '',
    })
  }

  return {
    ok: true,
    url: page.finalUrl,
    status: page.status,
    title: doc.title,
    truncated: page.truncated,
    protocol: url.protocol.replace(':', ''),
    meta: {
      viewport: doc.viewportContent,
      themeColor: doc.themeColorValue,
      charset: doc.charset,
      appleTouchIcon: doc.appleTouchTag,
    },
    pwa: { manifest, serviceWorker },
    smartphone: {
      viewportOk: !!doc.viewportContent,
      widthDeviceWidth: widthDevice,
      initialScale,
      userScalable: !userScalableNo,
      mediaQueryCount: mobile.mediaQueryCount,
    },
    stats: {
      htmlBytes: Buffer.byteLength(page.text),
      inlineScripts: doc.inlineScripts.length,
      externalScripts: doc.externalScripts.length,
      stylesheets: doc.stylesheetHrefs.length,
    },
    findings,
    html: page.truncated ? `${page.text}\n<!-- truncated -->` : page.text,
  }
}

/* ------------------------------------------------------------------ */
/* Report formatting for text surfaces (tool / command)                */
/* ------------------------------------------------------------------ */

function summarize(report) {
  if (!report.ok) return { ok: false, error: report.error, detail: report.detail, status: report.status }
  const byCat = { smartphone: [], pwa: [], logic: [] }
  for (const f of report.findings) (byCat[f.category] ?? byCat.logic).push(f)
  const counts = { error: 0, warning: 0, info: 0 }
  for (const f of report.findings) counts[f.severity]++
  const { html, ...rest } = report
  return { ok: true, url: report.url, title: report.title, protocol: report.protocol, smartphone: report.smartphone, pwa: report.pwa, stats: report.stats, counts, findings: report.findings }
}

function prettyReport(summary) {
  if (!summary.ok) return `PWA inspection failed: ${summary.error}${summary.detail ? ` (${summary.detail})` : ''}${summary.status ? ` — HTTP ${summary.status}` : ''}`
  const lines = []
  lines.push(`# PWA Code Inspector — ${summary.title || summary.url}`)
  lines.push(`URL: ${summary.url} (${summary.protocol.toUpperCase()})`)
  lines.push('')
  lines.push(`Smartphone formatting: viewport ${summary.smartphone.viewportOk ? 'present' : 'MISSING'}, device-width ${summary.smartphone.widthDeviceWidth ? 'yes' : 'no'}, zoom ${summary.smartphone.userScalable ? 'allowed' : 'BLOCKED'}, media queries: ${summary.smartphone.mediaQueryCount}`)
  lines.push(`PWA: manifest ${summary.pwa.manifest.ok ? 'valid' : summary.pwa.manifest.href ? 'INVALID/UNREACHABLE' : 'MISSING'}, service worker ${summary.pwa.serviceWorker.detected ? (summary.pwa.serviceWorker.reachable ? 'reachable' : 'UNREACHABLE') : 'MISSING'}`)
  lines.push(`Scripts: ${summary.stats.inlineScripts} inline, ${summary.stats.externalScripts} external (top 3 scanned)`)
  lines.push('')
  if (!summary.findings.length) lines.push('No issues found. The app looks clean on these checks.')
  const order = { error: 0, warning: 1, info: 2 }
  for (const f of [...summary.findings].sort((a, b) => order[a.severity] - order[b.severity])) {
    lines.push(`- [${f.severity}] (${f.category}) ${f.title}${f.location ? ` — ${f.location}` : ''}`)
    lines.push(`  ${f.detail}`)
  }
  lines.push('')
  lines.push(`Totals: ${summary.counts.error} errors, ${summary.counts.warning} warnings, ${summary.counts.info} info.`)
  return lines.join('\n')
}

/* ------------------------------------------------------------------ */
/* The expert persona skill                                            */
/* ------------------------------------------------------------------ */

const EXPERT_SKILL_CONTENT = `# PWA Web App Developer — Code Inspection Expert

You are a professional Progressive Web App developer. You inspect web
applications, format them for smartphones, and fix issues with logic flows.
Treat every review as a professional code inspection: evidence first, minimal
diffs, verified fixes.

## Expertise

1. **PWA architecture.** Web app manifests (name, icons 192/512 + maskable,
   start_url, display standalone, theme_color), service workers with correct
   scope and lifecycle, HTTPS, offline fallbacks, installability criteria.
2. **Smartphone formatting.** Viewport meta (\`width=device-width,
   initial-scale=1\`, never \`user-scalable=no\`), fluid layouts, safe areas
   and notches, touch targets ≥ 44px, legible base font (16px), orientation
   and keyboard behavior, no blocking dialogs, no fixed widths wider than a
   phone.
3. **Logic-flow debugging.** Control flow (conditions, switches, loops),
   async flows (promises, await, race conditions, error handling), state
   transitions, event ordering, and early returns. Prefer \`===\`, add default
   switch arms, never pass strings to timers, and always handle rejections.

## Method

1. Run the \`webapp_inspect\` tool with the page URL (or read the local web
   app's files when the user points at a workspace).
2. Read the report in order: smartphone formatting, PWA readiness, logic.
   Fix **errors** before **warnings**; explain each **info** briefly.
3. For every fix, show the exact change (before/after) and why the flow was
   broken. Keep diffs minimal; preserve behavior the app relies on.
4. Verify: re-run the inspection, then check the page at 360px and 768px
   widths, test the install prompt criteria, and trace the fixed flow end to
   end.

## When reviewing smartphone formatting

- The page must adapt at 360px, 390px, 412px, and 768px.
- No horizontal scrolling; images and media are fluid (\`max-width: 100%\`).
- Tap targets are comfortable, forms use the right input types and inputmode.
- Zoom stays available; text stays legible without pinch-zoom.

## When fixing logic flows

- Identify the actual flow first (entry → state changes → exit conditions).
- A bug is a flow bug, not a line bug: describe the broken path, then patch it.
- Guard against: assignment-in-condition, loose equality coercions, missing
  default arms, unhandled rejections, and timer/string misuse.

## Communication

Be professional and specific. Lead with the diagnosis, then the fix, then the
verification. When the report is clean, say what was checked and what still
needs a human (real-device testing, offline flight, performance profiling).`

/* ------------------------------------------------------------------ */
/* Plugin apply                                                        */
/* ------------------------------------------------------------------ */

export function apply(ctx) {
  /* 1. Data route for the Web panel (same-origin, no CORS). */
  ctx.webServer.register({
    kind: 'exact',
    path: '/pwa-inspector/inspect',
    handler: async (req, res) => {
      try {
        const url = new URL(req.url, 'http://localhost').searchParams.get('url')
        if (!url) {
          res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, error: 'missing-url' }))
          return
        }
        const report = await inspectWebApp(url)
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify(report))
      } catch (err) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, error: 'internal', detail: String(err && err.message) }))
      }
    },
  })

  /* 2. Agent-facing tool. */
  ctx.tools.register({
    name: 'webapp_inspect',
    description: 'Inspect a live web app like a professional PWA developer: audit smartphone formatting (viewport, fluid layout, touch UX), PWA readiness (manifest, icons, service worker, HTTPS), and static logic-flow issues in its scripts. Returns a structured report with findings, severities, and fix guidance.',
    parameters: {
      url: { type: 'string', required: true, description: 'The http(s) URL of the web app to inspect.' },
    },
    output: {
      schema: { type: 'object' },
      render: (args, value) => [{ type: 'text', text: prettyReport(value) }],
    },
    timeoutMs: 60000,
    isConcurrencySafe: () => true,
    async execute(args) {
      const url = typeof args?.url === 'string' ? args.url : ''
      const report = await inspectWebApp(url)
      return summarize(report)
    },
  })

  /* 3. Chat shortcut: /pwa-inspect https://… */
  ctx.commands.register({
    name: 'pwa-inspect',
    description: 'Run the PWA Code Inspector on a web app URL and print the audit.',
    input: { hint: 'https://example.com' },
    async handler({ rawInput, signal }) {
      const report = await inspectWebApp(rawInput)
      const text = prettyReport(summarize(report))
      return { kind: 'success', text }
    },
  })

  /* 4. The expert persona, available in the skill catalog. */
  ctx.skills.register({
    name: SKILL_NAME,
    description: 'Act as a professional PWA web app developer: inspect web app code, format web apps for smartphones, and fix logic-flow issues using the webapp_inspect tool and professional review discipline.',
    whenToUse: 'When the user asks to inspect, audit, review, or fix a web app — PWA readiness, smartphone/mobile formatting, responsive layout, installability, offline support, or logic-flow bugs.',
    content: EXPERT_SKILL_CONTENT,
  })
}
