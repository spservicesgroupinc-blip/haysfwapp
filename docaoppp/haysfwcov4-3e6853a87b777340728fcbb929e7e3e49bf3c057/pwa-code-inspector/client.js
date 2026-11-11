/**
 * PWA Code Inspector — Client half.
 *
 * A sidebar panel that presents the Host inspection service as a
 * professional PWA developer workstation: device preview, smartphone
 * formatting audit, PWA readiness audit, and logic-flow findings.
 *
 * Lazy-CJS factory format for the client module system. React comes from
 * the platform module table; no other Harness packages are imported.
 */
window.__ModuleLoader__.load({
  id: '@local/pwa-code-inspector',
  factory(require) {
    const React = require('react')
    const { createElement: h, useState, useEffect, useRef, useCallback } = React
    const NS = 'pwaInspector'

    /* ------------------------------------------------------------ */
    /* Dictionaries                                                  */
    /* ------------------------------------------------------------ */

    const EN = {
      nav: 'PWA Code Inspector',
      panelTitle: 'PWA Code Inspector',
      panelTagline: 'Professional PWA web app developer — smartphone formatting & logic-flow review',
      urlLabel: 'Web app URL',
      urlPlaceholder: 'https://example.com',
      inspect: 'Inspect',
      deviceLabel: 'Device preview',
      loading: 'Inspecting…',
      missingUrl: 'Enter a URL to inspect.',
      badUrl: 'That is not a valid http(s) URL.',
      fetchFailed: 'Inspection failed.',
      previewTitle: 'Static preview (scripts disabled)',
      previewEmpty: 'Preview appears after an inspection.',
      expertTitle: 'Ask the PWA expert',
      expertBody: 'Hand the audit to the assistant. It loads the PWA web app developer skill and fixes the findings with minimal diffs.',
      expertAction: 'Copy expert prompt',
      expertCopied: 'Prompt copied — paste it into the chat.',
      commandHint: 'Or type /pwa-inspect and a URL right in the chat for a quick audit.',
      findingsTitle: 'Findings',
      findingsEmpty: 'No issues found by the static checks. Still worth a real-device pass.',
      severityError: 'error',
      severityWarning: 'warning',
      severityInfo: 'info',
      catSmartphone: 'Smartphone formatting',
      catPwa: 'PWA readiness',
      catLogic: 'Logic flow',
      chipManifest: 'Manifest',
      chipWorker: 'Service worker',
      chipViewport: 'Viewport',
      chipHttps: 'HTTPS',
      chipOk: 'ok',
      chipMissing: 'missing',
      chipUnknown: 'unknown',
      statsHtml: 'HTML',
      statsScripts: 'scripts',
      statsCss: 'stylesheets',
      previewNote: 'Scripts are blocked; this shows the static layout at device width.',
      copiedDone: 'Copied',
    }

    const ZH = {
      nav: 'PWA 代码检查器',
      panelTitle: 'PWA 代码检查器',
      panelTagline: '专业 PWA 开发工程师 —— 手机端排版与逻辑流程审查',
      urlLabel: 'Web 应用地址',
      urlPlaceholder: 'https://example.com',
      inspect: '开始检查',
      deviceLabel: '设备预览',
      loading: '检查中…',
      missingUrl: '请输入要检查的地址。',
      badUrl: '这不是有效的 http(s) 地址。',
      fetchFailed: '检查失败。',
      previewTitle: '静态预览（脚本已禁用）',
      previewEmpty: '完成一次检查后显示预览。',
      expertTitle: '请教 PWA 专家',
      expertBody: '把审查结果交给助手。它会加载 PWA 开发专家技能，用最小改动修复发现的问题。',
      expertAction: '复制专家提问',
      expertCopied: '已复制提问 —— 请粘贴到对话中。',
      commandHint: '也可以在对话中直接输入 /pwa-inspect 加网址快速审查。',
      findingsTitle: '检查发现',
      findingsEmpty: '静态检查未发现问题，仍建议在真机上再验证一次。',
      severityError: '错误',
      severityWarning: '警告',
      severityInfo: '提示',
      catSmartphone: '手机端排版',
      catPwa: 'PWA 就绪度',
      catLogic: '逻辑流程',
      chipManifest: '清单文件',
      chipWorker: 'Service Worker',
      chipViewport: '视口',
      chipHttps: 'HTTPS',
      chipOk: '正常',
      chipMissing: '缺失',
      chipUnknown: '未知',
      statsHtml: 'HTML',
      statsScripts: '脚本',
      statsCss: '样式表',
      previewNote: '脚本被禁用，这里展示设备宽度下的静态布局。',
      copiedDone: '已复制',
    }

    /* ------------------------------------------------------------ */
    /* Styles (theme tokens only)                                    */
    /* ------------------------------------------------------------ */

    const CSS = [
      '.pci-root { height: 100%; overflow: auto; display: flex; flex-direction: column; gap: 12px; padding: 20px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); box-sizing: border-box; }',
      '.pci-head { display: flex; align-items: center; gap: 12px; }',
      '.pci-head-icon { width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); }',
      '.pci-title { margin: 0; font-size: 18px; font-weight: 600; }',
      '.pci-tagline { margin: 2px 0 0; font-size: 13px; color: var(--dsw-alias-label-secondary); }',
      '.pci-toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-end; }',
      '.pci-field { display: flex; flex-direction: column; gap: 4px; flex: 1 1 260px; min-width: 220px; }',
      '.pci-field-label { font-size: 12px; color: var(--dsw-alias-label-secondary); }',
      '.pci-input, .pci-select { box-sizing: border-box; height: 34px; padding: 0 10px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-size: 13px; outline: none; }',
      '.pci-input:focus, .pci-select:focus { border-color: var(--dsw-alias-brand-primary); }',
      '.pci-button { box-sizing: border-box; height: 34px; padding: 0 16px; border-radius: 8px; border: 1px solid transparent; background: var(--dsw-alias-brand-primary); color: #fff; font-size: 13px; font-weight: 500; cursor: pointer; }',
      '.pci-button:disabled { opacity: 0.55; cursor: default; }',
      '.pci-button-secondary { background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-border-l2); }',
      '.pci-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px; align-items: start; }',
      '.pci-card { background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; padding: 14px; }',
      '.pci-card h3 { margin: 0 0 10px; font-size: 14px; font-weight: 600; }',
      '.pci-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }',
      '.pci-chip { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 999px; font-size: 11px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); }',
      '.pci-chip-dot { width: 6px; height: 6px; border-radius: 50%; }',
      '.pci-dot-ok { background: var(--dsw-alias-state-success-primary); }',
      '.pci-dot-bad { background: var(--dsw-alias-state-error-primary); }',
      '.pci-dot-unknown { background: var(--dsw-alias-state-idle-primary); }',
      '.pci-preview-frame { display: flex; flex-direction: column; gap: 8px; }',
      '.pci-preview-box { position: relative; border: 1px solid var(--dsw-alias-border-l2); border-radius: 18px; overflow: hidden; background: var(--dsw-alias-bg-layer-2); }',
      '.pci-preview-scaler { overflow: hidden; }',
      '.pci-iframe { border: 0; background: #fff; transform-origin: top left; }',
      '.pci-preview-note { font-size: 11px; color: var(--dsw-alias-label-secondary); }',
      '.pci-empty { font-size: 13px; color: var(--dsw-alias-label-secondary); padding: 24px 0; text-align: center; }',
      '.pci-finding { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; padding: 10px; margin-bottom: 8px; background: var(--dsw-alias-bg-layer-2); }',
      '.pci-finding-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }',
      '.pci-finding-title { font-size: 13px; font-weight: 600; }',
      '.pci-badge { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.4px; padding: 1px 6px; border-radius: 6px; border: 1px solid transparent; }',
      '.pci-badge-error { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent); color: var(--dsw-alias-state-error-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 35%, transparent); }',
      '.pci-badge-warning { background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 14%, transparent); color: var(--dsw-alias-state-warn-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 35%, transparent); }',
      '.pci-badge-info { background: color-mix(in srgb, var(--dsw-alias-state-idle-primary) 14%, transparent); color: var(--dsw-alias-state-idle-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-idle-primary) 35%, transparent); }',
      '.pci-finding-detail { font-size: 12px; color: var(--dsw-alias-label-secondary); margin: 6px 0 0; line-height: 1.5; }',
      '.pci-finding-loc { font-size: 11px; color: var(--dsw-alias-label-secondary); margin: 4px 0 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }',
      '.pci-error { color: var(--dsw-alias-state-error-primary); font-size: 13px; }',
      '.pci-expert { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }',
      '.pci-expert-text { flex: 1 1 320px; font-size: 12px; color: var(--dsw-alias-label-secondary); line-height: 1.5; }',
      '.pci-expert-actions { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }',
      '.pci-copied { font-size: 11px; color: var(--dsw-alias-state-success-primary); }',
      '.pci-hint { font-size: 11px; color: var(--dsw-alias-label-secondary); }',
      '.pci-stats { display: flex; gap: 10px; flex-wrap: wrap; font-size: 11px; color: var(--dsw-alias-label-secondary); }',
    ].join('\n')

    /* ------------------------------------------------------------ */
    /* Small components                                              */
    /* ------------------------------------------------------------ */

    function PanelIcon({ size, active }) {
      return h('svg', {
        viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': true,
        style: { display: 'block', color: active ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-secondary)' },
        fill: 'none', stroke: 'currentColor', strokeWidth: 1.7,
        strokeLinecap: 'round', strokeLinejoin: 'round',
      },
        h('rect', { x: 5.5, y: 2.75, width: 13, height: 18.5, rx: 2.4 }),
        h('line', { x1: 10.2, y1: 18.6, x2: 13.8, y2: 18.6 }),
        h('circle', { cx: 15.6, cy: 15.6, r: 3.1 }),
        h('line', { x1: 18.8, y1: 18.8, x2: 20.6, y2: 20.6 }),
        h('path', { d: 'M14.6 15.1l1 1' }))
    }

    function Badge({ severity, t }) {
      return h('span', { className: `pci-badge pci-badge-${severity}` }, t(`severity${severity[0].toUpperCase()}${severity.slice(1)}`))
    }

    function Chip({ ok, label }) {
      const dot = ok === true ? 'pci-dot-ok' : ok === false ? 'pci-dot-bad' : 'pci-dot-unknown'
      return h('span', { className: 'pci-chip' }, h('span', { className: `pci-chip-dot ${dot}` }), label)
    }

    function Finding({ finding, t }) {
      return h('div', { className: 'pci-finding' },
        h('div', { className: 'pci-finding-head' },
          h('span', { className: 'pci-finding-title' }, finding.title),
          h(Badge, { severity: finding.severity, t })),
        h('p', { className: 'pci-finding-detail' }, finding.detail),
        finding.location ? h('p', { className: 'pci-finding-loc' }, finding.location) : null,
        finding.snippet ? h('p', { className: 'pci-finding-loc' }, `“${finding.snippet}”`) : null)
    }

    /* ------------------------------------------------------------ */
    /* The panel                                                     */
    /* ------------------------------------------------------------ */

    function Panel({ t }) {
      const [url, setUrl] = useState('')
      const [deviceId, setDeviceId] = useState('iphone-14')
      const [state, setState] = useState({ phase: 'idle' }) // idle | loading | done | failed
      const boxRef = useRef(null)
      const [scale, setScale] = useState(1)
      const [copied, setCopied] = useState(false)

      const device = DEVICES.find((d) => d.id === deviceId) || DEVICES[1]
      const report = state.phase === 'done' ? state.report : null

      useEffect(() => {
        const box = boxRef.current
        if (!box || !report) return
        const measure = () => {
          const width = box.clientWidth - 2
          setScale(Math.min(1, width > 0 ? width / device.width : 1))
        }
        measure()
        const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
        observer && observer.observe(box)
        window.addEventListener('resize', measure)
        return () => {
          observer && observer.disconnect()
          window.removeEventListener('resize', measure)
        }
      }, [report, device.width])

      const run = useCallback(() => {
        const trimmed = url.trim()
        if (!trimmed) {
          setState({ phase: 'failed', message: 'missingUrl' })
          return
        }
        let parsed = null
        try { parsed = new URL(trimmed) } catch { /* invalid */ }
        if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
          setState({ phase: 'failed', message: 'badUrl' })
          return
        }
        setState({ phase: 'loading' })
        fetch(`${window.location.origin}/pwa-inspector/inspect?url=${encodeURIComponent(trimmed)}`)
          .then((res) => res.json())
          .then((data) => setState({ phase: 'done', report: data }))
          .catch(() => setState({ phase: 'failed', message: 'fetchFailed' }))
      }, [url])

      const copyExpert = useCallback(() => {
        if (!report) return
        const counts = { error: 0, warning: 0, info: 0 }
        for (const f of report.findings) counts[f.severity] = (counts[f.severity] || 0) + 1
        const top = report.findings.filter((f) => f.severity === 'error' || f.severity === 'warning').slice(0, 6)
          .map((f) => `- [${f.severity}] ${f.title} (${f.location || 'n/a'})`)
          .join('\n') || 'none'
        const text = [
          `Act as a professional PWA web app developer and inspect ${report.url}.`,
          `Smartphone formatting: viewport ${report.smartphone.viewportOk ? 'present' : 'missing'}, device-width ${report.smartphone.widthDeviceWidth ? 'yes' : 'no'}, zoom ${report.smartphone.userScalable ? 'allowed' : 'blocked'}.`,
          `PWA: manifest ${report.pwa.manifest.ok ? 'valid' : report.pwa.manifest.href ? 'invalid/unreachable' : 'missing'}, service worker ${report.pwa.serviceWorker.detected ? (report.pwa.serviceWorker.reachable ? 'reachable' : 'unreachable') : 'missing'}.`,
          `Static findings (${counts.error} errors, ${counts.warning} warnings):`,
          top,
          'Fix the issues, then re-inspect and verify at 360px and 768px widths.',
        ].join('\n')
        const done = () => { setCopied(true); window.setTimeout(() => setCopied(false), 2500) }
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done))
        else fallbackCopy(text, done)
      }, [report])

      function fallbackCopy(text, done) {
        try {
          const ta = document.createElement('textarea')
          ta.value = text
          ta.style.position = 'fixed'
          ta.style.opacity = '0'
          document.body.appendChild(ta)
          ta.select()
          document.execCommand('copy')
          ta.remove()
          done()
        } catch { /* ignore */ }
      }

      const findings = report ? report.findings : []
      const groups = {
        smartphone: findings.filter((f) => f.category === 'smartphone'),
        pwa: findings.filter((f) => f.category === 'pwa'),
        logic: findings.filter((f) => f.category === 'logic'),
      }
      const counts = { error: 0, warning: 0, info: 0 }
      for (const f of findings) counts[f.severity] = (counts[f.severity] || 0) + 1

      const chips = report ? [
        h(Chip, { key: 'https', ok: report.protocol === 'https', label: t('chipHttps') }),
        h(Chip, {
          key: 'manifest',
          ok: report.pwa.manifest.ok ? true : false,
          label: t('chipManifest'),
        }),
        h(Chip, {
          key: 'worker',
          ok: report.pwa.serviceWorker.detected ? (report.pwa.serviceWorker.reachable ? true : false) : false,
          label: t('chipWorker'),
        }),
        h(Chip, { key: 'viewport', ok: report.smartphone.viewportOk, label: t('chipViewport') }),
      ] : null

      const preview = report && report.html
        ? h('div', { className: 'pci-preview-box', ref: boxRef },
          h('div', { className: 'pci-preview-scaler', style: { width: device.width * scale, height: device.height * scale } },
            h('iframe', {
              className: 'pci-iframe',
              title: t('previewTitle'),
              sandbox: '',
              width: device.width,
              height: device.height,
              style: { width: device.width, height: device.height, transform: `scale(${scale})` },
              srcDoc: `<!doctype html><base href="${escapeHtmlAttr(report.url)}">${report.html}`,
            })))
        : h('div', { className: 'pci-empty', ref: boxRef }, report ? t('previewEmpty') : t('previewEmpty'))

      const expertBlock = report ? h('div', { className: 'pci-card' },
        h('h3', null, t('expertTitle')),
        h('div', { className: 'pci-expert' },
          h('p', { className: 'pci-expert-text' }, t('expertBody')),
          h('div', { className: 'pci-expert-actions' },
            h('button', { type: 'button', className: 'pci-button pci-button-secondary', onClick: copyExpert },
              copied ? t('copiedDone') : t('expertAction')),
            copied ? h('span', { className: 'pci-copied' }, t('expertCopied')) : null,
            h('span', { className: 'pci-hint' }, t('commandHint'))))) : null

      const summaryChips = report ? h('div', { className: 'pci-chips' }, chips) : null

      const findingsBlock = report ? h('div', { className: 'pci-card' },
        h('h3', null, t('findingsTitle')),
        summaryChips,
        report.stats ? h('div', { className: 'pci-stats' },
          h('span', null, `${t('statsHtml')}: ${formatBytes(report.stats.htmlBytes)}`),
          h('span', null, `${report.stats.inlineScripts + report.stats.externalScripts} ${t('statsScripts')}`),
          h('span', null, `${report.stats.stylesheets} ${t('statsCss')}`)) : null,
        findings.length === 0
          ? h('p', { className: 'pci-empty' }, t('findingsEmpty'))
          : [['smartphone', t('catSmartphone')], ['pwa', t('catPwa')], ['logic', t('catLogic')]].map(([key, label]) => groups[key].length
            ? h('div', { key },
              h('h4', { style: { margin: '12px 0 8px', fontSize: 12, fontWeight: 600, color: 'var(--dsw-alias-label-secondary)' } }, label),
              groups[key].map((f, i) => h(Finding, { key: i, finding: f, t })))
            : null)) : null

      return h('div', { className: 'pci-root' },
        h('div', { className: 'pci-head' },
          h('div', { className: 'pci-head-icon' }, h(PanelIcon, { size: 22, active: true })),
          h('div', null,
            h('h2', { className: 'pci-title' }, t('panelTitle')),
            h('p', { className: 'pci-tagline' }, t('panelTagline')))),
        h('div', { className: 'pci-toolbar' },
          h('div', { className: 'pci-field' },
            h('label', { className: 'pci-field-label' }, t('urlLabel')),
            h('input', {
              className: 'pci-input', type: 'url', inputMode: 'url',
              placeholder: t('urlPlaceholder'), value: url,
              onChange: (e) => setUrl(e.target.value),
              onKeyDown: (e) => { if (e.key === 'Enter') run() },
            })),
          h('div', { className: 'pci-field', style: { flex: '0 1 150px' } },
            h('label', { className: 'pci-field-label' }, t('deviceLabel')),
            h('select', { className: 'pci-select', value: deviceId, onChange: (e) => setDeviceId(e.target.value) },
              DEVICES.map((d) => h('option', { key: d.id, value: d.id }, d.label)))),
          h('button', { type: 'button', className: 'pci-button', onClick: run, disabled: state.phase === 'loading' },
            state.phase === 'loading' ? t('loading') : t('inspect'))),
        state.phase === 'failed' ? h('p', { className: 'pci-error' }, t(state.message)) : null,
        state.phase === 'done' && !report.ok ? h('p', { className: 'pci-error' }, `${t('fetchFailed')} ${report.error || ''}`) : null,
        h('div', { className: 'pci-grid' },
          h('div', { className: 'pci-card' },
            h('h3', null, `${t('previewTitle')} — ${device.label}`),
            preview,
            h('p', { className: 'pci-preview-note' }, t('previewNote'))),
          findingsBlock),
        expertBlock)
    }

    const DEVICES = [
      { id: 'iphone-se', label: 'iPhone SE', width: 375, height: 667 },
      { id: 'iphone-14', label: 'iPhone 14', width: 390, height: 844 },
      { id: 'pixel-7', label: 'Pixel 7', width: 412, height: 915 },
      { id: 'ipad', label: 'iPad', width: 768, height: 1024 },
      { id: 'desktop', label: 'Desktop', width: 1280, height: 800 },
    ]

    function escapeHtmlAttr(value) {
      return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    }

    function formatBytes(n) {
      if (n < 1024) return `${n} B`
      if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
      return `${(n / 1024 / 1024).toFixed(1)} MB`
    }

    /* ------------------------------------------------------------ */
    /* Registration                                                  */
    /* ------------------------------------------------------------ */

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en: EN, zh: ZH }))
        ctx.effect(() => {
          const style = document.createElement('style')
          style.dataset.plugin = '@local/pwa-code-inspector'
          style.textContent = CSS
          document.head.append(style)
          return () => style.remove()
        })

        const t = ctx.locale.bind(NS)

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'pwa-inspector',
          order: 20,
          label: () => t('nav'),
          locale: NS,
        }, ({ size, active }) => h(PanelIcon, { size, active })))

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'pwa-inspector',
          locale: NS,
        }, ({ t }) => h(Panel, { t })))
      },
    }
  },
})
