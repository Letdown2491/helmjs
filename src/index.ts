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
  title: string
}

interface ElState { init?: true; abort?: AbortController; sse?: EventSource; poll?: number }

interface PrefetchEntry { promise: Promise<{ response: Response; text: string }>; expires: number }
const prefetchCache = new Map<string, PrefetchEntry>()

const elState = new WeakMap<Element, ElState>()
const state = (el: Element): ElState => elState.get(el) || (elState.set(el, {}), elState.get(el)!)
const $ = (s: string) => document.querySelector(s)
const has = (el: Element, a: string) => el.hasAttribute(a)

const toggleDisabled = (els: Element[], on: boolean) => {
  for (const e of els) e.tagName === 'A'
    ? (e.classList.toggle('h-disabled', on), on ? e.setAttribute('aria-disabled', 'true') : e.removeAttribute('aria-disabled'))
    : on ? e.setAttribute('disabled', '') : e.removeAttribute('disabled')
}

const emit = (el: Element, type: string, detail: object = {}): boolean =>
  el.dispatchEvent(new CustomEvent(`h:${type}`, { detail, bubbles: true, cancelable: true }))

// Fire a raw (un-prefixed) event, e.g. for server-driven H-Trigger.
const fire = (el: Element, type: string, detail: unknown = {}): void =>
  void el.dispatchEvent(new CustomEvent(type, { detail, bubbles: true }))

const doScroll = (el: Element, scroll: string): void => {
  if (scroll === 'top') window.scrollTo({ top: 0, behavior: 'smooth' })
  else if (scroll === 'bottom') window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })
  else (scroll === 'target' ? el : $(scroll))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

const attr = (el: Element, name: string, fallback = ''): string =>
  el.getAttribute(name) ?? fallback

const selectFragment = (html: string, selector: string): string => {
  const el = new DOMParser().parseFromString(html, 'text/html').querySelector(selector)
  return el ? el.innerHTML : html
}

const ignore = (el: Element): boolean => !!el.closest('[h-ignore]')

// Valid swap strategies, used to validate server-supplied H-Reswap values.
const SWAP_RE = /^(inner|outer|before|after|prepend|append|none|morph)$/

// True when a (possibly relative) URL resolves to the current origin.
const sameOrigin = (u: string): boolean => {
  try { return new URL(u, location.href).origin === location.origin } catch { return false }
}

// An element is boosted when an ancestor (or itself) carries h-boost (not "false").
const boosted = (el: Element): boolean => {
  const b = el.closest('[h-boost]')
  return !!b && b.getAttribute('h-boost') !== 'false'
}

// Fire one or many server-driven events from an H-Trigger header value.
// Accepts a JSON object {"name": detail, ...} or a comma-separated list of names.
const fireTriggers = (el: Element, spec: string): void => {
  let map: Record<string, unknown> | undefined
  try { const j = JSON.parse(spec); if (j && typeof j === 'object') map = j } catch {}
  if (map) for (const k in map) fire(el, k, map[k])
  else for (const n of spec.split(',')) { const t = n.trim(); if (t) fire(el, t) }
}

const hdrs = (tgt?: string | null): Record<string, string> =>
  tgt ? { 'H-Request': 'true', 'H-Target': tgt } : { 'H-Request': 'true' }

const extractTitle = (html: string): string => {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (m) document.title = m[1].trim()
  return html.replace(/<title[^>]*>[\s\S]*?<\/title>/gi, '')
}

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

const parseTTL = (s?: string): number => {
  if (!s) return 0
  const m = s.match(/^(\d+)(ms|s|m)?$/)
  return m ? (m[2] === 'ms' ? +m[1] : m[2] === 'm' ? +m[1] * 60000 : +m[1] * 1000) : 0
}

const processOOB = (html: string): string => {
  if (!html.includes('h-oob')) return html
  const t = document.createElement('template')
  t.innerHTML = html
  for (const o of t.content.querySelectorAll('[h-oob]')) {
    const s = o.getAttribute('h-oob') || 'true'
    o.removeAttribute('h-oob')
    const tgt = o.id ? document.getElementById(o.id) : null
    // The OOB element's id names the target; only outer/true replaces the element
    // itself (outerHTML), every other strategy uses the OOB element's contents.
    const strat = s === 'true' ? 'outer' : s as SwapStrategy
    if (tgt) doSwap(tgt, strat === 'outer' ? o.outerHTML : o.innerHTML, strat)
    o.remove()
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
  const oldNodes = [...parent.childNodes], nextNodes = [...newParent.childNodes]
  const oldEls = oldNodes.filter((n): n is Element => n.nodeType === 1)
  const nextEls = nextNodes.filter((n): n is Element => n.nodeType === 1)

  const hasText = (nodes: Node[]) => nodes.some(n => n.nodeType === 3 && n.textContent?.trim())
  if (hasText(oldNodes) || hasText(nextNodes)) {
    if (parent instanceof Element) parent.innerHTML = newParent instanceof Element ? newParent.innerHTML : (newParent as DocumentFragment).children[0]?.outerHTML || ''
    return
  }

  const byId = new Map<string, Element>()
  for (const c of oldEls) if (c.id) byId.set(c.id, c)
  const used = new Set<Element>()
  let i = 0
  for (const n of nextEls) {
    let m: Element | undefined
    if (n.id && byId.has(n.id)) m = byId.get(n.id)
    else if (i < oldEls.length && oldEls[i].tagName === n.tagName && !oldEls[i].id && !used.has(oldEls[i])) m = oldEls[i]
    const ref = parent.children[i] || null
    if (m) { used.add(m); if (ref !== m) parent.insertBefore(m, ref); morphNodes(m, n) }
    else parent.insertBefore(n.cloneNode(true), ref)
    i++
  }
  for (const c of oldEls) if (!used.has(c)) c.remove()
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

// Client-side navigation to a server-provided URL (H-Location / boosted history
// restore): fetch HTML, swap the <body>, and record a re-derivable history entry.
const navigate = async (url: string): Promise<void> => {
  try {
    const html = extractTitle(await (await fetch(url, { headers: hdrs('body') })).text())
    doSwap(document.body, selectFragment(html, 'body'), 'inner')
    history.pushState({ h: true, url, target: 'body', swap: 'inner', select: 'body', title: document.title } as HState, '', url)
  } catch { location.href = url }
}

const findMethod = (el: Element): { method: HttpMethod; action: string } | null => {
  const tag = el.tagName
  const boost = boosted(el)
  if (has(el, 'h-get') || (boost && tag === 'A')) {
    const url = el.getAttribute(tag === 'A' ? 'href' : tag === 'FORM' ? 'action' : '')
    if (!url) return null
    // Don't boost links the browser should handle natively (new tab, download,
    // in-page anchors, cross-origin) — they must stay plain navigations.
    if (boost && tag === 'A' && !has(el, 'h-get') &&
      (el.hasAttribute('target') || el.hasAttribute('download') ||
        url.startsWith('#') || new URL(url, location.href).origin !== location.origin))
      return null
    return { method: 'GET', action: url }
  }
  if (tag === 'FORM') {
    const action = el.getAttribute('action')
    if (!action) return null
    for (const m of ['post', 'put', 'patch', 'delete'] as const)
      if (has(el, `h-${m}`)) return { method: m.toUpperCase() as HttpMethod, action }
    // Boosted form: derive the method from the native form (GET or POST only).
    if (boost) return { method: (el.getAttribute('method') || 'get').toUpperCase() === 'POST' ? 'POST' : 'GET', action }
  }
  return null
}

const init = (el: Element): void => {
  if (state(el).init || ignore(el)) return
  const methodInfo = findMethod(el)
  if (!methodInfo || !emit(el, 'init', {})) return

  const defaultTrigger = el.tagName === 'FORM' ? 'submit' : 'click'
  const triggers = attr(el, 'h-trigger', defaultTrigger).split(',').map(t => t.trim()).filter(Boolean)

  const sync = attr(el, 'h-sync')

  const baseHandler = async (evt: Event): Promise<void> => {
    const confirmMsg = attr(el, 'h-confirm')
    if (confirmMsg && !confirm(confirmMsg)) return

    const st = state(el)
    if (sync === 'abort' && st.abort) st.abort.abort()
    else if (sync === 'drop' && st.abort) return
    const controller = sync ? new AbortController() : undefined
    if (controller) st.abort = controller

    const form = el instanceof HTMLFormElement ? el : null
    let body = form ? new FormData(form) : null
    if (form && evt instanceof SubmitEvent && evt.submitter?.hasAttribute('name'))
      body!.append(evt.submitter.getAttribute('name')!, (evt.submitter as HTMLButtonElement).value)
    const incSel = attr(el, 'h-include')
    if (incSel) {
      if (!body) body = new FormData()
      for (const inc of document.querySelectorAll(incSel))
        if ((inc instanceof HTMLInputElement || inc instanceof HTMLTextAreaElement || inc instanceof HTMLSelectElement) && inc.name)
          body.append(inc.name, inc.value)
    }

    // Boosted controls upgrade plain links/forms to whole-page partial navigation:
    // default to replacing <body>'s contents, matching a full page load JS-off.
    const boost = boosted(el)
    const tgtSel = attr(el, 'h-target') || (boost ? 'body' : '')
    const target = tgtSel ? $(tgtSel) ?? el : el
    const swap = attr(el, 'h-swap', 'inner') as SwapStrategy
    const hdrAttr = attr(el, 'h-headers')
    let headers = hdrs(tgtSel)
    if (hdrAttr) try { headers = { ...headers, ...JSON.parse(hdrAttr) } } catch {}
    const isGet = methodInfo.method === 'GET'

    const cfg: HConfig = {
      trigger: evt, action: methodInfo.action, method: methodInfo.method,
      target, swap, body: isGet || methodInfo.method === 'DELETE' ? null : body, headers
    }

    evt.preventDefault()
    if (!emit(el, 'before', { cfg })) return

    // h-disable: absent => auto-disable submit controls during mutations only;
    // "" (present) or a selector => disable on any method; "false" => opt out.
    // A selector value also disables the matched elements.
    const isMut = !isGet, disVal = el.getAttribute('h-disable')
    const force = disVal !== null && disVal !== 'false'
    const disEls: Element[] = []
    if (disVal !== 'false' && (isMut || force)) {
      if (el.tagName === 'FORM') disEls.push(...el.querySelectorAll('button, input[type="submit"]'))
      else disEls.push(el)
    }
    if (disVal && disVal !== 'false') disEls.push(...document.querySelectorAll(disVal))
    toggleDisabled(disEls, true)

    const indSel = attr(el, 'h-indicator')
    const ind = indSel ? $(indSel) : null
    if (ind) ind.classList.add('h-loading')

    let url = cfg.action
    if (body && cfg.method === 'GET') {
      const p = new URLSearchParams(body as any)
      if (p.toString()) url += (url.includes('?') ? '&' : '?') + p
    }

    try {
      let res: Response
      let html: string
      const cached = isGet ? prefetchCache.get(url) : null

      if (cached && cached.expires > Date.now()) {
        const { response, text } = await cached.promise
        res = response
        html = extractTitle(text)
        prefetchCache.delete(url)
      } else {
        res = await fetch(url, { method: cfg.method, headers: cfg.headers, body: cfg.body, signal: controller?.signal })
        html = extractTitle(await res.text())
      }
      // Server-driven navigation (works on any status): the response is the
      // engine of state transitions and may redirect/refresh the whole client.
      // Response-driven navigation is same-origin by default to avoid being an
      // open-redirect surface; cross-origin redirects need an explicit opt-in.
      const H = (n: string) => res.headers.get(n)
      if (H('H-Refresh') === 'true') { location.reload(); return }
      const redirect = H('H-Redirect')
      if (redirect) {
        if (sameOrigin(redirect) || document.documentElement.hasAttribute('h-allow-cross-origin')) location.href = redirect
        else emit(el, 'error', { cfg, error: Error('cross-origin H-Redirect blocked') })
        return
      }
      const location_ = H('H-Location')
      if (location_) {
        if (sameOrigin(location_)) await navigate(location_)
        else emit(el, 'error', { cfg, error: Error('cross-origin H-Location blocked') })
        return
      }
      // H-Trigger fires on receive (pre-swap, htmx parity); H-Trigger-After-Swap
      // fires once the swap is applied so handlers can see the new DOM.
      const trig = H('H-Trigger')
      if (trig) fireTriggers(el, trig)
      const trigAfter = H('H-Trigger-After-Swap')

      // The response may override the client's pre-declared placement/selection,
      // so the requesting element needn't carry out-of-band layout knowledge.
      const reSelect = H('H-Reselect')
      const selSel = reSelect ?? (attr(el, 'h-select') || (boost ? 'body' : ''))
      if (selSel) html = selectFragment(html, selSel)
      const reTarget = H('H-Retarget')
      if (reTarget) { const t = $(reTarget); if (t) cfg.target = t }
      const reSwap = H('H-Reswap')
      const validReSwap: SwapStrategy | null = reSwap && SWAP_RE.test(reSwap) ? reSwap as SwapStrategy : null
      if (validReSwap) cfg.swap = validReSwap
      const histTarget = reTarget || tgtSel || null

      if (res.status >= 400) {
        // Error placement: server-driven via H-Retarget, else a conventional
        // [h-error] region if the page provides one; always fire h:error.
        const errTgt = reTarget ? cfg.target : $('[h-error]')
        if (errTgt) doSwap(errTgt, html, validReSwap || 'inner')
        emit(el, 'error', { cfg, response: res, html })
      } else if (emit(el, 'before-swap', { cfg, response: res, html })) {
        html = processOOB(html)
        const scrollAttr = attr(el, 'h-scroll')
        const scrollEl = scrollAttr === 'target' ? cfg.target : null
        const doIt = () => doSwap(cfg.target, html, cfg.swap)
        if (document.startViewTransition) await document.startViewTransition(doIt).finished
        else doIt()

        emit(el, 'swapped', { cfg, response: res, html })
        if (!document.contains(el)) emit(document.documentElement, 'swapped', { cfg, response: res, html })
        if (trigAfter) fireTriggers(el, trigAfter)

        if (scrollAttr) {
          if (scrollAttr === 'target' && cfg.swap === 'outer') {
            const newEl = scrollEl?.id ? document.getElementById(scrollEl.id) : null
            if (newEl) newEl.scrollIntoView({ behavior: 'smooth', block: 'start' })
          } else doScroll(cfg.target, scrollAttr)
        }

        const focusSel = attr(el, 'h-focus')
        if (focusSel) ($(focusSel) as HTMLElement | null)?.focus?.()

        // URL changes: server headers (H-Push-Url / H-Replace-Url) win over
        // attributes; boosted GET navigation pushes by default. A header value
        // of "false" suppresses; any other value is the URL to write.
        const pushAttr = el.getAttribute('h-push-url'), replAttr = el.getAttribute('h-replace-url')
        const pushHdr = H('H-Push-Url'), replHdr = H('H-Replace-Url')
        let pushUrl: string | null = pushHdr ? (pushHdr === 'false' ? null : pushHdr)
          : (pushAttr === 'false' ? null : (pushAttr !== null || (boost && isGet)) ? url : null)
        let replUrl: string | null = replHdr ? (replHdr === 'false' ? null : replHdr)
          : (replAttr === 'false' ? null : replAttr !== null ? url : null)
        if (pushUrl || replUrl) {
          const navUrl = (pushUrl || replUrl)!
          const hist: HState = { h: true, url: navUrl, target: histTarget, swap: cfg.swap, select: selSel || null, title: document.title }
          if (pushUrl) history.pushState(hist, '', navUrl)
          else history.replaceState(hist, '', navUrl)
        }
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') return
      emit(el, 'error', { cfg, error })
    } finally {
      if (controller) st.abort = undefined
      toggleDisabled(disEls, false)
      if (ind) ind.classList.remove('h-loading')
    }
  }

  for (const triggerSpec of triggers) {
    const { event, mods } = parseTrigger(triggerSpec)
    let handler: (evt: Event) => void = baseHandler

    if (mods.has('debounce')) handler = debounce(handler, parseInt(mods.get('debounce')!) || 300)
    if (mods.has('throttle')) handler = throttle(handler, parseInt(mods.get('throttle')!) || 300)

    const fromSel = mods.get('from')
    const listenTarget = fromSel ? $(fromSel) : el

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
    } else if (listenTarget) {
      listenTarget.addEventListener(event, handler, { once: mods.has('once'), capture: mods.has('capture'), passive: mods.has('passive') })
    }
  }
  state(el).init = true
  emit(el, 'inited', {})
}

const initSSE = (el: Element): void => {
  if (state(el).sse || ignore(el)) return
  const url = attr(el, 'h-sse')
  if (!url) return

  const routes = new Map<string, { target: string; swap: SwapStrategy }>()
  el.querySelectorAll('template[h-sse-on]').forEach(tmpl => {
    const ev = attr(tmpl, 'h-sse-on'), tgt = attr(tmpl, 'h-target')
    if (ev && tgt) routes.set(ev, { target: tgt, swap: attr(tmpl, 'h-swap', 'append') as SwapStrategy })
  })

  const defTarget = attr(el, 'h-target'), defSwap = attr(el, 'h-swap', 'append') as SwapStrategy
  const es = new EventSource(url)
  state(el).sse = es
  emit(el, 'sse-connect', { url })

  routes.forEach((r, ev) => {
    es.addEventListener(ev, (e: MessageEvent) => {
      const target = $(r.target)
      if (target) { doSwap(target, processOOB(e.data), r.swap); emit(el, 'sse-message', { event: ev, data: e.data }) }
    })
  })

  es.onmessage = (e: MessageEvent) => {
    if (defTarget) {
      const target = $(defTarget)
      if (target) { doSwap(target, processOOB(e.data), defSwap); emit(el, 'sse-message', { data: e.data }) }
    }
  }
  es.onerror = () => emit(el, 'sse-error', { url })
}

const initPoll = (el: Element): void => {
  if (state(el).poll || ignore(el)) return
  const val = attr(el, 'h-poll')
  if (!val) return

  const parts = val.trim().split(/\s+/)
  const url = parts[0]
  const interval = parseTTL(parts[1]) || 30000
  const swap = attr(el, 'h-swap', 'inner') as SwapStrategy
  const tgtSel = attr(el, 'h-target')
  const selSel = attr(el, 'h-select')

  const poll = async () => {
    if (!document.contains(el)) { clearInterval(id); return }
    const target = tgtSel ? $(tgtSel) ?? el : el
    try {
      const res = await fetch(url, { headers: hdrs(tgtSel) })
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
  state(el).poll = id
  emit(el, 'poll-start', { url, interval })
}

const initPrefetch = (el: Element): void => {
  if (el.tagName !== 'A' || !has(el, 'h-get') || ignore(el)) return
  const url = el.getAttribute('href')
  if (!url) return

  const val = attr(el, 'h-prefetch', 'hover')
  const parts = val.trim().split(/\s+/)
  const trigger = parts[0] || 'hover'
  const ttl = parseTTL(parts[1]) || 30000

  const doPrefetch = () => {
    const cached = prefetchCache.get(url)
    if (cached && cached.expires > Date.now()) return
    let headers = hdrs(attr(el, 'h-target'))
    const hdrAttr = attr(el, 'h-headers')
    if (hdrAttr) try { headers = { ...headers, ...JSON.parse(hdrAttr) } } catch {}
    const promise = fetch(url, { headers }).then(async response => ({ response, text: await response.text() }))
    prefetchCache.set(url, { promise, expires: Date.now() + ttl })
  }

  if (trigger === 'intersect') {
    const obs = new IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) { doPrefetch(); obs.disconnect() }
    })
    obs.observe(el)
  } else {
    el.addEventListener('mouseenter', doPrefetch, { once: true })
    el.addEventListener('focus', doPrefetch, { once: true })
  }
}

const initEl = (el: Element): void => {
  if (findMethod(el)) init(el)
  if (has(el, 'h-sse')) initSSE(el)
  if (has(el, 'h-poll')) initPoll(el)
  if (has(el, 'h-prefetch')) initPrefetch(el)
}

const process = (node: Node): void => {
  if (!(node instanceof Element) || ignore(node)) return
  initEl(node)
  node.querySelectorAll('a[h-get][href], form[h-get][action], form[h-post][action], form[h-put][action], form[h-patch][action], form[h-delete][action], [h-sse], [h-poll], [h-prefetch]').forEach(initEl)
  // Boosted plain controls: upgrade native <a href>/<form action> with no h-* attrs.
  if (node.closest('[h-boost]')) node.querySelectorAll('a[href], form[action]').forEach(initEl)
  node.querySelectorAll('[h-boost] a[href], [h-boost] form[action]').forEach(initEl)
}

const observer = new MutationObserver(recs => { for (const r of recs) r.addedNodes.forEach(process) })

const start = () => { observer.observe(document.documentElement, { childList: true, subtree: true }); process(document.body) }
document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', start) : start()

document.addEventListener('h:process', (e) => process(e.target as Node))

history.replaceState({ h: true, url: location.href, target: null, swap: 'inner', select: null, title: document.title } as HState, '')

window.addEventListener('popstate', async (e) => {
  const s = e.state as HState | null
  if (!s?.h) return
  if (s.title) document.title = s.title
  if (!s.target) { location.reload(); return }
  const target = $(s.target)
  if (!target) { location.reload(); return }
  try {
    let html = extractTitle(await (await fetch(s.url, { headers: hdrs(s.target) })).text())
    if (s.select) html = selectFragment(html, s.select)
    doSwap(target, html, s.swap)
  } catch { location.reload() }
})
