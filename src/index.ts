type SwapStrategy = 'inner' | 'outer' | 'before' | 'after' | 'prepend' | 'append' | 'none' | 'morph'
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

interface HConfig {
  trigger: Event
  action: string
  method: HttpMethod
  target: Element
  swap: SwapStrategy
  body: FormData | null
  headers: Record<string, string>
}

interface HState {
  h: true
  url: string
  target: string | null
  swap: SwapStrategy
  select: string | null
}

const emit = (el: Element, type: string, detail: object = {}): boolean =>
  el.dispatchEvent(new CustomEvent(`h:${type}`, { detail, bubbles: true, cancelable: true }))

const doScroll = (el: Element, scroll: string): void => {
  if (scroll === 'top') window.scrollTo({ top: 0, behavior: 'smooth' })
  else if (scroll === 'bottom') window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })
  else (scroll === 'target' ? el : document.querySelector(scroll))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

const attr = (el: Element, name: string, fallback = ''): string =>
  el.getAttribute(name) ?? fallback

const selectFragment = (html: string, selector: string): string => {
  const el = new DOMParser().parseFromString(html, 'text/html').querySelector(selector)
  return el ? el.innerHTML : html
}

const ignore = (el: Element): boolean => !!el.closest('[h-ignore]')

const parseTrigger = (str: string): { event: string; mods: Map<string, string> } => {
  const parts = str.trim().split(/\s+/), mods = new Map<string, string>()
  for (let i = 1; i < parts.length; i++) { const [k, v] = parts[i].split(':'); mods.set(k, v ?? 'true') }
  return { event: parts[0], mods }
}

const debounce = (fn: (e: Event) => void, ms: number) => {
  let t: any; return (e: Event) => { clearTimeout(t); t = setTimeout(() => fn(e), ms) }
}

const throttle = (fn: (e: Event) => void, ms: number) => {
  let last = 0; return (e: Event) => { const now = Date.now(); if (now - last >= ms) { last = now; fn(e) } }
}

const processOOB = (html: string): string => {
  if (!html.includes('h-oob')) return html
  const t = document.createElement('template')
  t.innerHTML = html
  for (const oob of t.content.querySelectorAll('[h-oob]')) {
    const swap = (oob.getAttribute('h-oob') || 'true') as SwapStrategy
    oob.removeAttribute('h-oob')
    const target = oob.id ? document.getElementById(oob.id) : null
    if (target) doSwap(target, oob.outerHTML, swap === 'true' as any ? 'outer' : swap)
    oob.remove()
  }
  return t.innerHTML
}

const doSwap = (target: Element, html: string, s: SwapStrategy): void => {
  if (s === 'inner') target.innerHTML = html
  else if (s === 'outer') target.outerHTML = html
  else if (s === 'before') target.insertAdjacentHTML('beforebegin', html)
  else if (s === 'after') target.insertAdjacentHTML('afterend', html)
  else if (s === 'prepend') target.insertAdjacentHTML('afterbegin', html)
  else if (s === 'append') target.insertAdjacentHTML('beforeend', html)
  else if (s === 'morph') morph(target, html)
}

const morph = (target: Element, html: string): void => {
  const t = document.createElement('template')
  t.innerHTML = html.trim()
  morphChildren(target, t.content)
}

const morphChildren = (parent: Element | DocumentFragment, newParent: Element | DocumentFragment): void => {
  const old = [...parent.children], next = [...newParent.children]
  const byId = new Map<string, Element>()
  for (const c of old) if (c.id) byId.set(c.id, c)
  const used = new Set<Element>()
  let i = 0
  for (const n of next) {
    let m: Element | undefined
    if (n.id && byId.has(n.id)) m = byId.get(n.id)
    else if (i < old.length && old[i].tagName === n.tagName && !old[i].id && !used.has(old[i])) m = old[i]
    const ref = parent.children[i] || null
    if (m) { used.add(m); if (ref !== m) parent.insertBefore(m, ref); morphNodes(m, n) }
    else parent.insertBefore(n.cloneNode(true), ref)
    i++
  }
  for (const c of old) if (!used.has(c)) c.remove()
}

const morphNodes = (old: Element, next: Element): void => {
  if (old.tagName !== next.tagName) { old.replaceWith(next.cloneNode(true)); return }

  const isIn = old instanceof HTMLInputElement, isTa = old instanceof HTMLTextAreaElement
  for (const { name } of old.attributes) if (!next.hasAttribute(name)) old.removeAttribute(name)
  for (const { name, value } of next.attributes) {
    if ((isIn || isTa) && name === 'value') continue
    if (old.getAttribute(name) !== value) old.setAttribute(name, value)
  }

  if (isIn && next instanceof HTMLInputElement) {
    const v = next.getAttribute('value')
    if (v && old.value !== v) old.value = v
    if (old.checked !== next.checked) old.checked = next.checked
    return
  }
  if (isTa && next instanceof HTMLTextAreaElement) {
    const v = next.textContent
    if (v && old.value !== v) old.value = v
    return
  }
  if (!next.children.length && !old.children.length) {
    if (old.textContent !== next.textContent) old.textContent = next.textContent
    return
  }
  morphChildren(old, next)
}

const findMethod = (el: Element): { method: HttpMethod; action: string } | null => {
  if (el.hasAttribute('h-get')) {
    if (el.tagName !== 'A') return null
    const href = el.getAttribute('href')
    return href ? { method: 'GET', action: href } : null
  }
  if (el.tagName === 'FORM') {
    const action = el.getAttribute('action')
    if (!action) return null
    for (const m of ['post', 'put', 'patch', 'delete'] as const)
      if (el.hasAttribute(`h-${m}`)) return { method: m.toUpperCase() as HttpMethod, action }
  }
  return null
}

const init = (el: Element): void => {
  if ((el as any).__h || ignore(el)) return
  const methodInfo = findMethod(el)
  if (!methodInfo || !emit(el, 'init', {})) return

  const { event, mods } = parseTrigger(attr(el, 'h-trigger', el.tagName === 'FORM' ? 'submit' : 'click'))

  let handler: (evt: Event) => void = async (evt: Event): Promise<void> => {
    const confirmMsg = attr(el, 'h-confirm')
    if (confirmMsg && !confirm(confirmMsg)) return

    const form = el instanceof HTMLFormElement ? el : null
    const body = form ? new FormData(form) : null
    if (form && evt instanceof SubmitEvent && evt.submitter?.hasAttribute('name'))
      body!.append(evt.submitter.getAttribute('name')!, (evt.submitter as HTMLButtonElement).value)

    const tgtSel = attr(el, 'h-target')
    const target = tgtSel ? document.querySelector(tgtSel) ?? el : el
    const swap = attr(el, 'h-swap', 'morph') as SwapStrategy
    const hdrAttr = attr(el, 'h-headers')
    let headers: Record<string, string> = { 'H-Request': 'true' }
    if (hdrAttr) try { headers = { ...headers, ...JSON.parse(hdrAttr) } } catch {}

    const cfg: HConfig = {
      trigger: evt, action: methodInfo.action, method: methodInfo.method,
      target, swap, body: methodInfo.method[0] === 'G' || methodInfo.method[0] === 'D' ? null : body, headers
    }

    evt.preventDefault()
    if (!emit(el, 'before', { cfg })) return

    const isMut = cfg.method !== 'GET', noDisable = el.hasAttribute('h-no-disable')
    const disEls: Element[] = []
    if ((isMut && !noDisable) || el.hasAttribute('h-disabled')) {
      if (el.tagName === 'FORM') disEls.push(...el.querySelectorAll('button, input[type="submit"]'))
      else disEls.push(el)
    }
    const disSel = attr(el, 'h-disabled')
    if (disSel) disEls.push(...document.querySelectorAll(disSel))
    for (const d of disEls) {
      if (d.tagName === 'A') { d.classList.add('h-disabled'); d.setAttribute('aria-disabled', 'true') }
      else d.setAttribute('disabled', '')
    }

    const indSel = attr(el, 'h-indicator')
    const ind = indSel ? document.querySelector(indSel) : null
    if (ind) ind.classList.add('h-loading')

    let url = cfg.action
    if (form && body && cfg.method === 'GET') {
      const p = new URLSearchParams(body as any)
      if (p.toString()) url += (url.includes('?') ? '&' : '?') + p
    }

    try {
      const res = await fetch(url, { method: cfg.method, headers: cfg.headers, body: cfg.body })
      let html = await res.text()
      const selSel = attr(el, 'h-select')
      if (selSel) html = selectFragment(html, selSel)

      if (res.status >= 400) {
        const errSel = attr(el, 'h-error-target')
        const errTgt = errSel ? document.querySelector(errSel) : null
        if (errTgt) doSwap(errTgt, html, 'inner')
        emit(el, 'error', { cfg, response: res, html })
      } else if (emit(el, 'after', { cfg, response: res, html })) {
        html = processOOB(html)
        const scrollAttr = attr(el, 'h-scroll')
        const scrollEl = scrollAttr === 'target' ? cfg.target : null
        const doIt = () => doSwap(cfg.target, html, cfg.swap)
        if (document.startViewTransition) await document.startViewTransition(doIt).finished
        else doIt()

        emit(el, 'swapped', { cfg })
        if (!document.contains(el)) emit(document.documentElement, 'swapped', { cfg })

        if (scrollAttr) {
          if (scrollAttr === 'target' && cfg.swap === 'outer') {
            const newEl = scrollEl?.id ? document.getElementById(scrollEl.id) : null
            if (newEl) newEl.scrollIntoView({ behavior: 'smooth', block: 'start' })
          } else doScroll(cfg.target, scrollAttr)
        }

        const push = el.hasAttribute('h-push-url'), replace = el.hasAttribute('h-replace-url')
        if (push || replace) {
          const st: HState = { h: true, url, target: tgtSel || null, swap: cfg.swap, select: selSel || null }
          if (push) history.pushState(st, '', url)
          else history.replaceState(st, '', url)
        }
      }
    } catch (error) {
      emit(el, 'error', { cfg, error })
    } finally {
      for (const d of disEls) {
        if (d.tagName === 'A') { d.classList.remove('h-disabled'); d.removeAttribute('aria-disabled') }
        else d.removeAttribute('disabled')
      }
      if (ind) ind.classList.remove('h-loading')
    }
  }

  if (mods.has('debounce')) handler = debounce(handler, parseInt(mods.get('debounce')!) || 300)
  if (mods.has('throttle')) handler = throttle(handler, parseInt(mods.get('throttle')!) || 300)

  if (event === 'intersect') {
    const threshold = parseFloat(mods.get('threshold') ?? '0')
    const rootMargin = mods.get('rootMargin') ?? '0px'
    const obs = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          handler(new CustomEvent('intersect', { detail: entry }))
          if (mods.has('once')) obs.disconnect()
        }
      }
    }, { threshold, rootMargin })
    obs.observe(el)
  } else {
    el.addEventListener(event, handler, { once: mods.has('once'), capture: mods.has('capture'), passive: mods.has('passive') })
  }
  ;(el as any).__h = 1
  emit(el, 'inited', {})
}

const initSSE = (el: Element): void => {
  if ((el as any).__hsse || ignore(el)) return
  const url = attr(el, 'h-sse')
  if (!url) return

  const routes = new Map<string, { target: string; swap: SwapStrategy }>()
  el.querySelectorAll('template[h-sse-on]').forEach(tmpl => {
    const ev = attr(tmpl, 'h-sse-on'), tgt = attr(tmpl, 'h-target')
    if (ev && tgt) routes.set(ev, { target: tgt, swap: attr(tmpl, 'h-swap', 'append') as SwapStrategy })
  })

  const defTarget = attr(el, 'h-target'), defSwap = attr(el, 'h-swap', 'append') as SwapStrategy
  const es = new EventSource(url)
  ;(el as any).__hsse = es
  emit(el, 'sse-connect', { url })

  routes.forEach((r, ev) => {
    es.addEventListener(ev, (e: MessageEvent) => {
      const t = document.querySelector(r.target)
      if (t) { doSwap(t, processOOB(e.data), r.swap); emit(el, 'sse-message', { event: ev, data: e.data }) }
    })
  })

  es.onmessage = (e: MessageEvent) => {
    if (defTarget) {
      const t = document.querySelector(defTarget)
      if (t) { doSwap(t, processOOB(e.data), defSwap); emit(el, 'sse-message', { data: e.data }) }
    }
  }
  es.onerror = () => emit(el, 'sse-error', { url })
}

const initPoll = (el: Element): void => {
  if ((el as any).__hpoll || ignore(el)) return
  const val = attr(el, 'h-poll')
  if (!val) return

  const parts = val.trim().split(/\s+/)
  const url = parts[0]
  const intervalStr = parts[1] || '30s'
  const m = intervalStr.match(/^(\d+)(ms|s|m)?$/)
  const interval = m ? (m[2] === 'ms' ? +m[1] : m[2] === 'm' ? +m[1] * 60000 : +m[1] * 1000) : 30000
  const swap = attr(el, 'h-swap', 'inner') as SwapStrategy
  const tgtSel = attr(el, 'h-target')
  const selSel = attr(el, 'h-select')

  const poll = async () => {
    if (!document.contains(el)) { clearInterval(id); return }
    const target = tgtSel ? document.querySelector(tgtSel) ?? el : el
    try {
      const res = await fetch(url, { headers: { 'H-Request': 'true' } })
      if (res.ok) {
        let html = await res.text()
        if (selSel) html = selectFragment(html, selSel)
        html = processOOB(html)
        doSwap(target, html, swap)
        emit(el, 'poll', { url, html })
      }
    } catch {}
  }

  const id = setInterval(poll, interval)
  ;(el as any).__hpoll = id
  emit(el, 'poll-start', { url, interval })
}

const process = (node: Node): void => {
  if (!(node instanceof Element) || ignore(node)) return
  if (findMethod(node)) init(node)
  if (node.hasAttribute('h-sse')) initSSE(node)
  if (node.hasAttribute('h-poll')) initPoll(node)
  node.querySelectorAll('a[h-get][href], form[h-post][action], form[h-put][action], form[h-patch][action], form[h-delete][action], [h-sse], [h-poll]').forEach(el => {
    if (findMethod(el)) init(el)
    else if (el.hasAttribute('h-sse')) initSSE(el)
    else if (el.hasAttribute('h-poll')) initPoll(el)
  })
}

const observer = new MutationObserver(recs => { for (const r of recs) r.addedNodes.forEach(process) })

const start = () => { observer.observe(document.documentElement, { childList: true, subtree: true }); process(document.body) }
document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', start) : start()

document.addEventListener('h:process', (e) => process(e.target as Node))

history.replaceState({ h: true, url: location.href, target: null, swap: 'morph', select: null } as HState, '')

window.addEventListener('popstate', async (e) => {
  const s = e.state as HState | null
  if (!s?.h) return
  if (!s.target) { location.reload(); return }
  const t = document.querySelector(s.target)
  if (!t) { location.reload(); return }
  try {
    let html = await (await fetch(s.url, { headers: { 'H-Request': 'true' } })).text()
    if (s.select) html = selectFragment(html, s.select)
    doSwap(t, html, s.swap)
  } catch { location.reload() }
})
