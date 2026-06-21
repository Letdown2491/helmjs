type SwapStrategy = 'inner' | 'outer' | 'before' | 'after' | 'prepend' | 'append' | 'none' | 'morph'
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

interface HConfig {
  trigger: Event
  action: string
  method: HttpMethod
  target: Element
  swap: SwapStrategy
  // Wrap this swap in a View Transition. Off by default (whole-viewport
  // cross-fades ghost on rapid/concurrent partial swaps); opt in per-swap with
  // `h-swap="… transition"`/`h-transition`, or globally with <html
  // h-view-transitions>. A before-request listener can also toggle it.
  transition: boolean
  body: FormData | null
  headers: Record<string, string>
}

// Detail carried by the cancelable h:before-swap event. `swap` is the re-entry
// seam: a listener that calls preventDefault() (taking over the swap) may do
// async work and then call swap(html, response?) to feed replacement content
// back through helmjs's normal swap pipeline. A given response supplies the
// placement headers (H-Reselect/Retarget/Reswap/Push-Url/Trigger); omit it to
// reuse the original response's headers. Resolves when the swap completes.
interface BeforeSwapDetail {
  cfg: HConfig
  response: Response
  html: string
  swap: (html: string, response?: Response, url?: string) => Promise<void>
}

interface HState {
  h: true
  url: string
  target: string | null
  swap: SwapStrategy
  select: string | null
  title: string
}

interface ElState { init?: true; abort?: AbortController; sse?: EventSource; insert?: true; combobox?: true; opt?: { el: Element; cls: string; had: boolean } }

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

// data-h-busy: a reference-counted "helm is doing something" flag on <html>,
// for site-wide loaders (progress bar, busy cursor, dimmed shell) in pure CSS
// with no per-element plumbing. Counts overlapping requests so concurrent swaps
// don't clear it early, toggling the attribute only on the 0<->1 edge and firing
// document-level h:busy / h:idle there for JS reactors. Background triggers
// (every/load/intersect) and prefetch are excluded (see the call sites) so
// polling and lazy-loading don't flash the global loader.
const BUSY_ATTR = 'data-h-busy'
let busyCount = 0
const setBusy = (delta: number): void => {
  const was = busyCount > 0
  busyCount = Math.max(0, busyCount + delta)
  const now = busyCount > 0
  if (was === now) return
  const root = document.documentElement
  if (now) root.setAttribute(BUSY_ATTR, '')
  else root.removeAttribute(BUSY_ATTR)
  fire(root, now ? 'h:busy' : 'h:idle')
}

// Resolve the scroll animation for an h-scroll behavior modifier. An explicit
// `instant`/`auto`/`smooth` token always wins; otherwise we default to `smooth`,
// but honor prefers-reduced-motion by falling back to an instant jump.
const scrollBehavior = (token: string | undefined): ScrollBehavior =>
  (token === 'instant' || token === 'auto') ? 'auto'
  : token === 'smooth' ? 'smooth'
  : (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) ? 'auto'
  : 'smooth'

const doScroll = (el: Element, scroll: string, behavior: ScrollBehavior): void => {
  if (scroll === 'top') window.scrollTo({ top: 0, behavior })
  else if (scroll === 'bottom') window.scrollTo({ top: document.body.scrollHeight, behavior })
  else (scroll === 'target' ? el : $(scroll))?.scrollIntoView({ behavior, block: 'start' })
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
  if (s === 'outer') target.outerHTML = html
  else if (s === 'before') target.insertAdjacentHTML('beforebegin', html)
  else if (s === 'after') target.insertAdjacentHTML('afterend', html)
  else if (s === 'prepend') target.insertAdjacentHTML('afterbegin', html)
  else if (s === 'append') target.insertAdjacentHTML('beforeend', html)
  else if (s === 'morph') morph(target, html)
  else if (s !== 'none') target.innerHTML = html // inner (default) + unknown values
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

// Apply a fetched response: honor its placement headers (reselect/retarget/
// reswap/trigger), then place 4xx/5xx errors or run the swap pipeline (OOB,
// view-transition-wrapped swap, h:swapped, scroll/focus, push/replace URL).
// `gate` true is the normal path: it emits the cancelable h:before-swap. A
// canceled listener can re-enter via detail.swap, which calls this again with
// gate false so the default swap never double-fires.
const applyResponse = async (
  el: Element, cfg: HConfig, res: Response, html: string,
  autoPush: boolean, tgtSel: string, selDefault: string, url: string, gate: boolean,
): Promise<void> => {
  const H = (n: string) => res.headers.get(n)
  // H-Trigger fires on receive (pre-swap, htmx parity); H-Trigger-After-Swap
  // fires once the swap is applied so handlers can see the new DOM.
  const trig = H('H-Trigger')
  if (trig) fireTriggers(el, trig)
  const trigAfter = H('H-Trigger-After-Swap')

  // The response may override the client's pre-declared placement/selection,
  // so the requesting element needn't carry out-of-band layout knowledge.
  const reSelect = H('H-Reselect')
  const selSel = reSelect ?? selDefault
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
    return
  }
  // The seam: bind a closure over (el, cfg) and re-enter with gate false so a
  // listener can defer the swap. Omitting the response reuses the original's;
  // an optional url overrides the auto push/replace URL default. `taken` makes
  // it self-correcting: invoking swap suppresses the default swap even if the
  // listener forgot preventDefault(), so the two can't both run (no double-swap).
  let taken = false
  const detail: BeforeSwapDetail = {
    cfg, response: res, html,
    swap: (h, r = res, u = url) => (taken = true, applyResponse(el, cfg, r, h, autoPush, tgtSel, selDefault, u, false)),
  }
  if (gate && (!emit(el, 'before-swap', detail) || taken)) return

  html = processOOB(html)
  // h-scroll value is "<target> [behavior]", e.g. "top instant" or "#anchor smooth".
  const scrollTok = attr(el, 'h-scroll').split(/\s+/).filter(Boolean)
  const scrollTarget = scrollTok[0] || ''
  const scrollBeh = scrollBehavior(scrollTok[1])
  const scrollEl = scrollTarget === 'target' ? cfg.target : null
  const doIt = () => doSwap(cfg.target, html, cfg.swap)
  // View Transitions are opt-in: instant by default (whole-viewport cross-fades
  // ghost on rapid/concurrent partial swaps), enabled per-swap via cfg.transition
  // or globally with <html h-view-transitions>.
  const useVT = typeof document.startViewTransition === 'function' &&
    (cfg.transition || document.documentElement.hasAttribute('h-view-transitions'))
  if (useVT) {
    const vt = document.startViewTransition(doIt)
    // A near-simultaneous swap skips this transition (only one runs at a time);
    // its `ready`/`finished` reject with a benign "Skipped ViewTransition", but
    // the update callback still ran, so the DOM is already swapped. Swallow those
    // and await `updateCallbackDone` instead, so a genuine error thrown by the
    // swap callback still propagates (and surfaces as h:error).
    vt.ready?.catch(() => {})
    vt.finished?.catch(() => {})
    await vt.updateCallbackDone
  } else doIt()

  // Reconcile any pending h-optimistic state: the authoritative fragment is now
  // swapped in (if the optimistic element WAS the target, it's been replaced
  // outright), so drop the bookkeeping. We only get here on a real swap; a
  // swap-less finish (the deferred sign flow) leaves it pending until its
  // continuation re-enters here and reconciles, or h:error reverts.
  const elOpt = elState.get(el)
  if (elOpt?.opt) elOpt.opt = undefined

  emit(el, 'swapped', { cfg, response: res, html })
  if (!document.contains(el)) emit(document.documentElement, 'swapped', { cfg, response: res, html })
  if (trigAfter) fireTriggers(el, trigAfter)

  if (scrollTarget) {
    if (scrollTarget === 'target' && cfg.swap === 'outer') {
      const newEl = scrollEl?.id ? document.getElementById(scrollEl.id) : null
      if (newEl) newEl.scrollIntoView({ behavior: scrollBeh, block: 'start' })
    } else doScroll(cfg.target, scrollTarget, scrollBeh)
  }

  const focusSel = attr(el, 'h-focus')
  if (focusSel) ($(focusSel) as HTMLElement | null)?.focus?.()

  // URL changes: server headers (H-Push-Url / H-Replace-Url) win over
  // attributes; a genuine boosted GET navigation pushes by default (see autoPush).
  // A header value of "false" suppresses; any other value is the URL to write.
  const pushAttr = el.getAttribute('h-push-url'), replAttr = el.getAttribute('h-replace-url')
  const pushHdr = H('H-Push-Url'), replHdr = H('H-Replace-Url')
  let pushUrl: string | null = pushHdr ? (pushHdr === 'false' ? null : pushHdr)
    : (pushAttr === 'false' ? null : (pushAttr !== null || autoPush) ? url : null)
  let replUrl: string | null = replHdr ? (replHdr === 'false' ? null : replHdr)
    : (replAttr === 'false' ? null : replAttr !== null ? url : null)
  if (pushUrl || replUrl) {
    const navUrl = (pushUrl || replUrl)!
    const hist: HState = { h: true, url: navUrl, target: histTarget, swap: cfg.swap, select: selSel || null, title: document.title }
    if (pushUrl) history.pushState(hist, '', navUrl)
    else history.replaceState(hist, '', navUrl)
  }
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
    // URL source: href (links) / action (forms), both of which degrade with JS off,
    // or h-get's own value on any other element (JS-only; e.g. polling live regions).
    const url = el.getAttribute(tag === 'A' ? 'href' : tag === 'FORM' ? 'action' : 'h-get')
    if (!url) return null
    // Don't boost links the browser should handle natively (new tab, download,
    // in-page anchors, cross-origin); they must stay plain navigations.
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

// Triggers that fire without a user gesture (polling, lazy hydration, scroll
// sentinels). Their synthetic events carry these type names, which the busy
// counter uses to keep background work out of the global data-h-busy flag.
const BACKGROUND_TRIGGERS = new Set(['every', 'load', 'intersect'])

const init = (el: Element): void => {
  if (state(el).init || ignore(el)) return
  const methodInfo = findMethod(el)
  if (!methodInfo || !emit(el, 'init', {})) return

  const defaultTrigger = el.tagName === 'FORM' ? 'submit' : 'click'
  const triggers = attr(el, 'h-trigger', defaultTrigger).split(',').map(t => t.trim()).filter(Boolean)

  // Polling defaults to aborting an in-flight request so slow responses can't
  // stack or apply out of order; override with an explicit h-sync.
  const sync = attr(el, 'h-sync') || (triggers.some(t => t.split(/\s+/)[0] === 'every') ? 'abort' : '')

  const baseHandler = async (evt: Event): Promise<void> => {
    const confirmMsg = attr(el, 'h-confirm')
    if (confirmMsg && !confirm(confirmMsg)) return

    const st = state(el)
    if (sync === 'abort' && st.abort) st.abort.abort()
    else if (sync === 'drop' && st.abort) return
    const controller = sync ? new AbortController() : undefined
    if (controller) st.abort = controller

    const form = el instanceof HTMLFormElement ? el : null
    // A submit button overrides the form's request config (native formaction/
    // formmethod and h-* attributes), falling back to the form when it doesn't
    // carry the attribute. Reads via src() pick the submitter then the form.
    const submitter = form && evt instanceof SubmitEvent && evt.submitter instanceof HTMLElement
      ? evt.submitter : null
    const src = (name: string, fallback = ''): string =>
      (submitter?.hasAttribute(name) ? submitter.getAttribute(name) : el.getAttribute(name)) ?? fallback
    let body = form ? new FormData(form) : null
    if (submitter?.hasAttribute('name'))
      body!.append(submitter.getAttribute('name')!, (submitter as HTMLButtonElement).value)
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
    const tgtSel = src('h-target') || (boost ? 'body' : '')
    const target = tgtSel ? $(tgtSel) ?? el : el
    // h-swap is "<strategy> [transition]"; the optional `transition` modifier (or
    // a standalone h-transition attribute) opts this swap into a View Transition.
    const swapParts = src('h-swap', 'inner').split(/\s+/)
    const swap = (swapParts[0] || 'inner') as SwapStrategy
    const transition = swapParts.includes('transition') || el.hasAttribute('h-transition')
    const selDefault = src('h-select') || (boost ? 'body' : '')
    const hdrAttr = src('h-headers')
    let headers = hdrs(tgtSel)
    if (hdrAttr) try { headers = { ...headers, ...JSON.parse(hdrAttr) } } catch {}

    // h-selection: send a field's caret as H-Selection-Start/End so the server can
    // detect the active token exactly (value.slice(0, start)) instead of assuming
    // it's at the end of the value, which is wrong when editing mid-text. Absent =>
    // off; "" => the requesting element itself; a selector => that field.
    const selnAttr = el.getAttribute('h-selection')
    if (selnAttr !== null) {
      const field = selnAttr ? $(selnAttr) : el
      if ((field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) && field.selectionStart != null) {
        headers['H-Selection-Start'] = String(field.selectionStart)
        headers['H-Selection-End'] = String(field.selectionEnd ?? field.selectionStart)
      }
    }

    // Resolve the request line, letting the submitter override the form: native
    // formaction/formmethod first (standard HTML), then h-* method attributes.
    let { method, action } = methodInfo
    if (submitter) {
      const fa = submitter.getAttribute('formaction')
      if (fa) action = fa
      const fm = submitter.getAttribute('formmethod')
      if (fm) method = fm.toUpperCase() === 'POST' ? 'POST' : 'GET'
      if (submitter.hasAttribute('h-get')) {
        method = 'GET'
        const u = submitter.getAttribute('h-get'); if (u) action = u
      } else for (const m of ['post', 'put', 'patch', 'delete'] as const)
        if (submitter.hasAttribute(`h-${m}`)) { method = m.toUpperCase() as HttpMethod; break }
    }
    const isGet = method === 'GET'

    // Auto-push the URL only for a genuine boosted navigation: the trigger is the
    // element's default interaction (a click/submit, not every/load/intersect or
    // a custom/from: event) AND the swap targets the boost default (the whole
    // body), not a sub-region. In-place GET loaders (pollers, lazy hydration,
    // infinite-scroll sentinels, region updates) must not rewrite the address bar
    // and break reload; authors force history either way with h-push-url.
    const autoPush = boost && isGet && evt.type === defaultTrigger && tgtSel === 'body'

    const cfg: HConfig = {
      trigger: evt, action, method,
      target, swap, transition, body: isGet || method === 'DELETE' ? null : body, headers
    }

    evt.preventDefault()
    if (!emit(el, 'before-request', { cfg })) return

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
    const indSel = attr(el, 'h-indicator')
    const ind = indSel ? $(indSel) : null

    // Decide whether this request feeds the global data-h-busy counter (the
    // attribute is flipped inside the try below). Background triggers
    // (every/load/intersect) and prefetch are quiet by default so they don't
    // flash a site-wide loader; h-busy is the explicit override either way
    // ("false" opts a foreground request out, "true" opts a background one in).
    const busyAttr = el.getAttribute('h-busy')
    const busy = busyAttr === 'false' ? false
      : busyAttr === 'true' ? true
      : !BACKGROUND_TRIGGERS.has(evt.type)

    try {
      // Activate the in-flight affordances inside the try so that a throw during
      // request setup (an invalid optimistic selector, query-string building)
      // can't strand them: the finally below always pairs with these.
      toggleDisabled(disEls, true)
      if (ind) ind.classList.add('h-loading')
      if (busy) setBusy(1)

      // h-optimistic="class:NAME": flip a local class instantly so the control
      // reflects its new state before the round-trip completes. The optimistic
      // element is h-optimistic-target, else the resolved swap target, else el.
      // Record the pre-toggle state so an h:error can revert; the normal response
      // swap reconciles it (if it WAS the target, the swap replaces it outright).
      // The pending state must survive a swap-less finish (the nip07 sign deferral)
      // until its continuation swaps or errors, so only a real swap (reconcile) or
      // h:error (revert) clears it. Only the class: op exists; grammar stays open.
      const optSpec = el.getAttribute('h-optimistic')
      if (optSpec?.startsWith('class:')) {
        const cls = optSpec.slice(6)
        const optSel = el.getAttribute('h-optimistic-target')
        const optEl = (optSel ? $(optSel) : cfg.target) ?? el
        if (cls) {
          state(el).opt = { el: optEl, cls, had: optEl.classList.contains(cls) }
          optEl.classList.toggle(cls)
        }
      }

      let url = cfg.action
      if (body && cfg.method === 'GET') {
        const p = new URLSearchParams(body as any)
        if (p.toString()) url += (url.includes('?') ? '&' : '?') + p
      }

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
      // Hand off to the shared "apply response" pipeline (gate true emits the
      // cancelable h:before-swap; a canceled listener can re-enter via
      // detail.swap). H-Trigger fires inside on receive, before the swap.
      await applyResponse(el, cfg, res, html, autoPush, tgtSel, selDefault, url, true)
    } catch (error) {
      if ((error as Error).name === 'AbortError') return
      emit(el, 'error', { cfg, error })
    } finally {
      if (controller) st.abort = undefined
      toggleDisabled(disEls, false)
      if (ind) ind.classList.remove('h-loading')
      if (busy) setBusy(-1)
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
      const rootMargin = mods.get('root-margin') ?? '0px'
      const obs = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            handler(new CustomEvent('intersect', { detail: entry }))
            if (mods.has('once')) obs.disconnect()
          }
        }
      }, { threshold, rootMargin })
      obs.observe(el)
    } else if (event === 'every') {
      // Polling: re-run the request on an interval, stopping when detached.
      let ms = 0
      for (const k of mods.keys()) { const t = parseTTL(k); if (t) { ms = t; break } }
      const id = setInterval(() => document.contains(el) ? handler(new CustomEvent('every')) : clearInterval(id), ms || 30000)
    } else if (event === 'load') {
      // Fire once as soon as the element is wired into the DOM (htmx parity):
      // the lazy-hydration trigger. The native `load` event never fires on an
      // arbitrary element, so binding it would be a silent no-op. A microtask
      // lets the surrounding DOM settle first; delay:Ns staggers it. `once` is
      // implicit. Skip if the element was detached before a delayed fire.
      const ms = parseTTL(mods.get('delay'))
      const fire = () => { if (document.contains(el)) handler(new CustomEvent('load')) }
      ms ? setTimeout(fire, ms) : queueMicrotask(fire)
    } else if (listenTarget) {
      listenTarget.addEventListener(event, handler, { once: mods.has('once'), capture: mods.has('capture'), passive: mods.has('passive') })
    }
  }
  state(el).init = true
  emit(el, 'ready', {})
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

const initPrefetch = (el: Element): void => {
  if (el.tagName !== 'A' || !has(el, 'h-get') || ignore(el)) return
  const url = el.getAttribute('href')
  // Prefetch only same-origin URLs: a speculative hover/scroll fetch should never
  // fire a cross-origin GET (which can't be read back under CORS anyway, but would
  // still hit a third party with the H-Request headers before the user commits).
  if (!url || !sameOrigin(url)) return

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

// Client-side text insertion: the one swap-less primitive, since caret editing
// can't be expressed as a DOM swap. On click, splice h-insert's text into the
// h-insert-target input/textarea at the live caret, optionally replacing a
// trailing token (h-insert-replace, a regex matched against the value up to the
// caret), then restore caret + focus and fire a bubbling `input` so anything
// bound to the field re-runs (preview, validity, an h-trigger="input" suggest
// request, which now sees no active token and closes its dropdown).
const initInsert = (el: Element): void => {
  const st = state(el)
  if (st.insert || ignore(el)) return
  st.insert = true
  el.addEventListener('click', (evt) => {
    const sel = attr(el, 'h-insert-target')
    const tgt = sel ? $(sel) : null
    if (!(tgt instanceof HTMLInputElement || tgt instanceof HTMLTextAreaElement)) return
    evt.preventDefault()
    const text = attr(el, 'h-insert'), val = tgt.value
    const caret = tgt.selectionStart ?? val.length, end = tgt.selectionEnd ?? caret
    // Plain insert replaces any selection at [caret, end); replace mode extends
    // the start back to the regex match (its match is anchored to the caret).
    let from = caret
    const reSrc = el.getAttribute('h-insert-replace')
    if (reSrc) try { const m = new RegExp(reSrc).exec(val.slice(0, caret)); if (m) from = m.index } catch {}
    tgt.value = val.slice(0, from) + text + val.slice(end)
    const pos = from + text.length
    try { tgt.setSelectionRange(pos, pos) } catch {}
    tgt.focus()
    tgt.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

// Keyboard navigation for a suggestion dropdown (the combobox half of typeahead).
// h-combobox on the field points at the popup container; its `[role=option]`
// children are the items (server-rendered, so they re-render freely). The active
// item lives in the DOM as the `h-active` class, so this stays stateless across
// re-renders: a fresh dropdown starts with nothing active (or the server can
// pre-highlight one by rendering it with class="h-active"). Arrow keys move the
// highlight, Enter clicks the active item (firing its h-insert), Escape closes.
// Keys are only intercepted while the popup has options, so an empty/closed
// dropdown leaves normal caret movement and Enter (newline/submit) untouched.
const initCombobox = (el: Element): void => {
  const st = state(el)
  if (st.combobox || ignore(el)) return
  st.combobox = true
  const setActive = (opts: Element[], i: number) => {
    el.removeAttribute('aria-activedescendant')
    opts.forEach((o, j) => {
      const on = j === i
      o.classList.toggle('h-active', on)
      o.setAttribute('aria-selected', String(on))
      if (on) { o.scrollIntoView?.({ block: 'nearest' }); if (o.id) el.setAttribute('aria-activedescendant', o.id) }
    })
  }
  el.addEventListener('keydown', (evt) => {
    const e = evt as KeyboardEvent
    const sel = attr(el, 'h-combobox')
    const popup = sel ? $(sel) : null
    if (!popup) return
    const opts = [...popup.querySelectorAll('[role="option"]')]
    if (e.key === 'Escape') { if (!opts.length) return; popup.innerHTML = ''; el.removeAttribute('aria-activedescendant'); e.preventDefault(); return }
    if (!opts.length) return
    const idx = opts.findIndex(o => o.classList.contains('h-active')), last = opts.length - 1
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(opts, idx < 0 || idx === last ? 0 : idx + 1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(opts, idx <= 0 ? last : idx - 1) }
    else if (e.key === 'Enter' && idx >= 0) { e.preventDefault(); (opts[idx] as HTMLElement).click() }
  })
}

const initEl = (el: Element): void => {
  if (findMethod(el)) init(el)
  if (has(el, 'h-sse')) initSSE(el)
  if (has(el, 'h-prefetch')) initPrefetch(el)
  if (has(el, 'h-insert')) initInsert(el)
  if (has(el, 'h-combobox')) initCombobox(el)
}

const process = (node: Node): void => {
  if (!(node instanceof Element) || ignore(node)) return
  initEl(node)
  node.querySelectorAll('[h-get], form[h-post][action], form[h-put][action], form[h-patch][action], form[h-delete][action], [h-sse], [h-prefetch], [h-insert], [h-combobox]').forEach(initEl)
  // Boosted plain controls: upgrade native <a href>/<form action> with no h-* attrs.
  if (node.closest('[h-boost]')) node.querySelectorAll('a[href], form[action]').forEach(initEl)
  node.querySelectorAll('[h-boost] a[href], [h-boost] form[action]').forEach(initEl)
}

const observer = new MutationObserver(recs => { for (const r of recs) r.addedNodes.forEach(process) })

const start = () => { observer.observe(document.documentElement, { childList: true, subtree: true }); process(document.body) }
document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', start) : start()

document.addEventListener('h:process', (e) => process(e.target as Node))

// h-optimistic revert: an h:error on (or under) an element with pending
// optimistic state rolls the class back to its pre-toggle value and clears the
// state. helmjs's request catch emits h:error for network errors and 4xx/5xx,
// and the nip07 sign bridge emits it on the originating element when signing is
// rejected, so this one listener covers them all. A swap-less success (the
// deferred sign flow) never fires h:error, so the class correctly persists.
document.addEventListener('h:error', (e) => {
  for (let n = e.target as Element | null; n; n = n.parentElement) {
    const st = elState.get(n)
    if (st?.opt) { st.opt.el.classList.toggle(st.opt.cls, st.opt.had); st.opt = undefined; return }
  }
})

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
