// Minimal jsdom harness for HelmJS automated tests.
// Sets up a single DOM + globals, mocks fetch, and spies on history/navigation,
// then imports the built bundle (dist/helm.js) once for its side effects.
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
  url: 'http://localhost/',
})
const { window } = dom

// Captured navigation side effects (assert these instead of really navigating).
export const captured = { redirect: null, reloaded: false, pushed: [], replaced: [], fetches: [] }

// fetch router: each test assigns `routes(url, opts) => { status?, headers?, body? }`.
export let router = () => ({ body: '' })
export const setRouter = (fn) => { router = fn }

const makeRes = ({ status = 200, headers = {}, body = '' }) => ({
  status,
  ok: status < 400,
  headers: {
    get: (n) => {
      const k = Object.keys(headers).find((h) => h.toLowerCase() === n.toLowerCase())
      return k ? headers[k] : null
    },
  },
  text: async () => body,
})

globalThis.fetch = async (url, opts = {}) => {
  captured.fetches.push({ url: String(url), method: opts.method || 'GET', headers: opts.headers || {}, signal: !!opts.signal })
  return makeRes(router(String(url), opts))
}

// Location stub: capture redirect / reload without really navigating.
Object.defineProperty(globalThis, 'location', {
  configurable: true,
  value: {
    _href: 'http://localhost/',
    get href() { return this._href },
    set href(v) { captured.redirect = v; this._href = v },
    origin: 'http://localhost',
    reload() { captured.reloaded = true },
  },
})

// History spy that records and delegates to jsdom for same-origin paths.
const realHistory = window.history
globalThis.history = {
  get state() { return realHistory.state },
  pushState(s, t, u) { captured.pushed.push({ state: s, url: u }); try { realHistory.pushState(s, t, u) } catch {} },
  replaceState(s, t, u) { captured.replaced.push({ state: s, url: u }); try { realHistory.replaceState(s, t, u) } catch {} },
}

// Expose the DOM + classes the bundle references via bare globals.
for (const k of [
  'document', 'window', 'MutationObserver', 'DOMParser', 'CustomEvent', 'Event',
  'FormData', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement',
  'HTMLSelectElement', 'HTMLFormElement', 'HTMLButtonElement', 'SubmitEvent', 'URL', 'URLSearchParams',
]) {
  if (window[k]) globalThis[k] = window[k]
}
globalThis.window = window

// Import the built bundle for its side effects (auto-init + listeners).
// `npm test` builds this via the pretest step; falls back to dist if absent.
await import('./.build.mjs').catch(() => import('../dist/helm.js'))

export { window, dom }

// Reset DOM + captured state between tests.
export function reset() {
  window.document.body.innerHTML = ''
  globalThis.location._href = 'http://localhost/'
  captured.redirect = null
  captured.reloaded = false
  captured.pushed.length = 0
  captured.replaced.length = 0
  captured.fetches.length = 0
}

// Insert HTML into <body> and initialize HelmJS on it deterministically.
export function mount(html) {
  const root = window.document.createElement('div')
  root.innerHTML = html
  window.document.body.appendChild(root)
  // Dispatch h:process so the bundle initializes the new subtree synchronously.
  root.dispatchEvent(new window.CustomEvent('h:process', { bubbles: true }))
  return root
}

export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))
export const $ = (s) => window.document.querySelector(s)
