import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { reset, mount, setRouter, captured, tick, $, window } from './harness.mjs'

const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
const submit = (form) => form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
const submitBy = (form, submitter) => form.dispatchEvent(new window.SubmitEvent('submit', { submitter, bubbles: true, cancelable: true }))

beforeEach(() => { reset(); setRouter(() => ({ body: '' })) })

// ---------------------------------------------------------------------------
// Graceful degradation: every requesting element resolves to a working native
// control, and we never hijack a control that lacks a real href/action.
// ---------------------------------------------------------------------------

test('degradation: h-get anchor keeps its real href after init', () => {
  const root = mount('<a id="a" href="/page" h-get h-target="#out">Go</a><div id="out"></div>')
  assert.equal($('#a').getAttribute('href'), '/page')
})

test('degradation: h-post form keeps real action + method for JS-off submit', () => {
  mount('<form id="f" action="/subscribe" method="post" h-post><button>Go</button></form>')
  assert.equal($('#f').getAttribute('action'), '/subscribe')
  assert.equal($('#f').getAttribute('method'), 'post')
})

test('degradation: anchor with no href is never hijacked (no fetch)', async () => {
  const root = mount('<a id="a" h-get>Broken</a>')
  click($('#a'))
  await tick(10)
  assert.equal(captured.fetches.length, 0)
})

test('degradation: anchor with href IS enhanced (fetch fires, no native nav)', async () => {
  setRouter(() => ({ body: '<p>hi</p>' }))
  mount('<a id="a" href="/page" h-get h-target="#out">Go</a><div id="out"></div>')
  click($('#a'))
  await tick(10)
  assert.equal(captured.fetches.length, 1)
  assert.equal($('#out').innerHTML, '<p>hi</p>')
})

// ---------------------------------------------------------------------------
// Server-driven control via response headers.
// ---------------------------------------------------------------------------

test('H-Retarget: response overrides client h-target', async () => {
  setRouter(() => ({ headers: { 'H-Retarget': '#other' }, body: '<p>moved</p>' }))
  mount('<a id="a" href="/x" h-get h-target="#out" h-swap="inner">Go</a><div id="out"></div><div id="other"></div>')
  click($('#a'))
  await tick(10)
  assert.equal($('#out').innerHTML, '')
  assert.equal($('#other').innerHTML, '<p>moved</p>')
})

test('H-Reswap: response overrides client h-swap', async () => {
  setRouter(() => ({ headers: { 'H-Reswap': 'append' }, body: '<p>added</p>' }))
  mount('<a id="a" href="/x" h-get h-target="#out" h-swap="inner">Go</a><div id="out"><span>keep</span></div>')
  click($('#a'))
  await tick(10)
  assert.equal($('#out').innerHTML, '<span>keep</span><p>added</p>')
})

test('H-Reselect: response chooses the fragment to extract', async () => {
  setRouter(() => ({ headers: { 'H-Reselect': '#frag' }, body: '<div id="frag"><b>x</b></div><div>ignore</div>' }))
  mount('<a id="a" href="/x" h-get h-target="#out" h-swap="inner">Go</a><div id="out"></div>')
  click($('#a'))
  await tick(10)
  assert.equal($('#out').innerHTML, '<b>x</b>')
})

test('H-Push-Url: response sets the history URL', async () => {
  setRouter(() => ({ headers: { 'H-Push-Url': '/canonical' }, body: '<p>ok</p>' }))
  mount('<a id="a" href="/x" h-get h-target="#out" h-swap="inner">Go</a><div id="out"></div>')
  click($('#a'))
  await tick(10)
  assert.equal(captured.pushed.at(-1).url, '/canonical')
})

test('H-Push-Url:false suppresses push even when h-push-url is set', async () => {
  setRouter(() => ({ headers: { 'H-Push-Url': 'false' }, body: '<p>ok</p>' }))
  mount('<a id="a" href="/x" h-get h-push-url h-target="#out" h-swap="inner">Go</a><div id="out"></div>')
  click($('#a'))
  await tick(10)
  assert.equal(captured.pushed.length, 0)
})

test('H-Redirect: full client navigation', async () => {
  setRouter(() => ({ headers: { 'H-Redirect': '/login' }, body: '' }))
  mount('<a id="a" href="/x" h-get h-target="#out">Go</a><div id="out"></div>')
  click($('#a'))
  await tick(10)
  assert.equal(captured.redirect, '/login')
})

test('H-Location: client-side AJAX navigation swaps body + pushes URL', async () => {
  setRouter((url) =>
    url.endsWith('/dest')
      ? { body: '<html><body><h2>Dest</h2></body></html>' }
      : { headers: { 'H-Location': '/dest' }, body: '' })
  mount('<a id="a" href="/x" h-get h-target="#out">Go</a><div id="out"></div>')
  click($('#a'))
  await tick(20)
  assert.match(window.document.body.innerHTML, /<h2>Dest<\/h2>/)
  assert.equal(captured.pushed.at(-1).url, '/dest')
})

test('H-Refresh: reloads the page', async () => {
  setRouter(() => ({ headers: { 'H-Refresh': 'true' }, body: '' }))
  mount('<a id="a" href="/x" h-get h-target="#out">Go</a><div id="out"></div>')
  click($('#a'))
  await tick(10)
  assert.equal(captured.reloaded, true)
})

test('H-Trigger: fires a raw client event named by the server', async () => {
  setRouter(() => ({ headers: { 'H-Trigger': 'cart:updated' }, body: '<p>ok</p>' }))
  let fired = null
  window.document.addEventListener('cart:updated', () => { fired = true })
  mount('<a id="a" href="/x" h-get h-target="#out" h-swap="inner">Go</a><div id="out"></div>')
  click($('#a'))
  await tick(10)
  assert.equal(fired, true)
})

test('H-Trigger: JSON form fires events with detail', async () => {
  setRouter(() => ({ headers: { 'H-Trigger': '{"notify":{"msg":"hi"}}' }, body: '<p>ok</p>' }))
  let detail = null
  window.document.addEventListener('notify', (e) => { detail = e.detail })
  mount('<a id="a" href="/x" h-get h-target="#out" h-swap="inner">Go</a><div id="out"></div>')
  click($('#a'))
  await tick(10)
  assert.deepEqual(detail, { msg: 'hi' })
})

test('H-Retarget places 4xx error responses server-side', async () => {
  setRouter(() => ({ status: 422, headers: { 'H-Retarget': '#err' }, body: '<p>bad</p>' }))
  mount('<form id="f" action="/x" method="post" h-post h-target="#out"><button>Go</button></form><div id="out"></div><div id="err"></div>')
  submit($('#f'))
  await tick(10)
  assert.equal($('#err').innerHTML, '<p>bad</p>')
})

// ---------------------------------------------------------------------------
// Security: response-driven navigation is same-origin by default.
// ---------------------------------------------------------------------------

// Helper: capture h:error events for the duration of one test.
function withErrors(fn) {
  const errs = []
  const h = (e) => errs.push(e.detail)
  window.document.addEventListener('h:error', h)
  return fn(errs).finally(() => window.document.removeEventListener('h:error', h))
}

test('security: cross-origin H-Redirect is blocked and emits an error', () =>
  withErrors(async (errs) => {
    setRouter(() => ({ headers: { 'H-Redirect': 'https://evil.example/steal' }, body: '' }))
    mount('<a id="a" href="/x" h-get h-target="#out">Go</a><div id="out"></div>')
    click($('#a'))
    await tick(10)
    assert.equal(captured.redirect, null)
    assert.ok(errs.some((d) => String(d.error).includes('cross-origin')))
  }))

test('security: same-origin H-Redirect is allowed', async () => {
  setRouter(() => ({ headers: { 'H-Redirect': '/login' }, body: '' }))
  mount('<a id="a" href="/x" h-get h-target="#out">Go</a><div id="out"></div>')
  click($('#a'))
  await tick(10)
  assert.equal(captured.redirect, '/login')
})

test('security: cross-origin H-Redirect allowed with explicit opt-in', async () => {
  window.document.documentElement.setAttribute('h-allow-cross-origin', '')
  setRouter(() => ({ headers: { 'H-Redirect': 'https://auth.example/sso' }, body: '' }))
  mount('<a id="a" href="/x" h-get h-target="#out">Go</a><div id="out"></div>')
  click($('#a'))
  await tick(10)
  window.document.documentElement.removeAttribute('h-allow-cross-origin')
  assert.equal(captured.redirect, 'https://auth.example/sso')
})

test('security: cross-origin H-Location is blocked (no fetch, no swap)', () =>
  withErrors(async (errs) => {
    setRouter(() => ({ headers: { 'H-Location': 'https://evil.example/page' }, body: '' }))
    mount('<a id="a" href="/x" h-get h-target="#out">Go</a><div id="out"></div>')
    const before = captured.fetches.length
    click($('#a'))
    await tick(10)
    // Only the original request fired; navigate() never fetched the evil URL.
    assert.equal(captured.fetches.length, before + 1)
    assert.ok(errs.some((d) => String(d.error).includes('cross-origin')))
  }))

// ---------------------------------------------------------------------------
// H-Trigger timing: pre-swap (on receive) vs after-swap.
// ---------------------------------------------------------------------------

test('H-Trigger fires pre-swap (sees old DOM); H-Trigger-After-Swap sees new DOM', async () => {
  setRouter(() => ({
    headers: { 'H-Trigger': 'pre', 'H-Trigger-After-Swap': 'post' },
    body: '<span>new</span>',
  }))
  let preSaw = null, postSaw = null
  const onPre = () => { preSaw = $('#out').innerHTML }
  const onPost = () => { postSaw = $('#out').innerHTML }
  window.document.addEventListener('pre', onPre)
  window.document.addEventListener('post', onPost)
  mount('<a id="a" href="/x" h-get h-target="#out" h-swap="inner">Go</a><div id="out"><span>old</span></div>')
  click($('#a'))
  await tick(10)
  window.document.removeEventListener('pre', onPre)
  window.document.removeEventListener('post', onPost)
  assert.equal(preSaw, '<span>old</span>')
  assert.equal(postSaw, '<span>new</span>')
})

test('H-Trigger-After-Swap is skipped on a redirect short-circuit', () =>
  withErrors(async () => {
    setRouter(() => ({ headers: { 'H-Redirect': '/login', 'H-Trigger-After-Swap': 'post' }, body: '' }))
    let fired = false
    const onPost = () => { fired = true }
    window.document.addEventListener('post', onPost)
    mount('<a id="a" href="/x" h-get h-target="#out">Go</a><div id="out"></div>')
    click($('#a'))
    await tick(10)
    window.document.removeEventListener('post', onPost)
    assert.equal(fired, false)
  }))

// ---------------------------------------------------------------------------
// Defensive header validation.
// ---------------------------------------------------------------------------

test('invalid H-Reswap falls back to the element h-swap', async () => {
  setRouter(() => ({ headers: { 'H-Reswap': 'bogus; rm -rf' }, body: '<p>x</p>' }))
  mount('<a id="a" href="/x" h-get h-target="#out" h-swap="inner">Go</a><div id="out"><b>keep?</b></div>')
  click($('#a'))
  await tick(10)
  // Falls back to inner (not silently dropped, not a broken swap).
  assert.equal($('#out').innerHTML, '<p>x</p>')
})

test('H-Retarget with no match falls back to the original target', async () => {
  setRouter(() => ({ headers: { 'H-Retarget': '#does-not-exist' }, body: '<p>here</p>' }))
  mount('<a id="a" href="/x" h-get h-target="#out" h-swap="inner">Go</a><div id="out"></div>')
  click($('#a'))
  await tick(10)
  assert.equal($('#out').innerHTML, '<p>here</p>')
})

test('H-Reselect with no match swaps the full response', async () => {
  setRouter(() => ({ headers: { 'H-Reselect': '#nope' }, body: '<p>full</p>' }))
  mount('<a id="a" href="/x" h-get h-target="#out" h-swap="inner">Go</a><div id="out"></div>')
  click($('#a'))
  await tick(10)
  assert.equal($('#out').innerHTML, '<p>full</p>')
})

// ---------------------------------------------------------------------------
// Error placement: H-Retarget, else the [h-error] convention region.
// ---------------------------------------------------------------------------

test('error with no H-Retarget swaps into the [h-error] region', async () => {
  setRouter(() => ({ status: 500, body: '<p>boom</p>' }))
  mount('<a id="a" href="/x" h-get h-target="#out">Go</a><div id="out"></div><div h-error></div>')
  click($('#a'))
  await tick(10)
  assert.equal($('[h-error]').innerHTML, '<p>boom</p>')
  assert.equal($('#out').innerHTML, '') // normal target untouched
})

test('error with no H-Retarget and no [h-error] region only fires h:error', async () => {
  const errs = []
  const h = (e) => errs.push(e.detail)
  window.document.addEventListener('h:error', h)
  setRouter(() => ({ status: 500, body: '<p>boom</p>' }))
  mount('<a id="a" href="/x" h-get h-target="#out">Go</a><div id="out"></div>')
  click($('#a'))
  await tick(10)
  window.document.removeEventListener('h:error', h)
  assert.equal($('#out').innerHTML, '')
  assert.equal(errs.length, 1)
})

// ---------------------------------------------------------------------------
// Out-of-band: a returned element self-declares its own target by id.
// ---------------------------------------------------------------------------

test('OOB element swaps into the element with the matching id', async () => {
  setRouter(() => ({ body: '<p>main</p><span id="badge" h-oob="inner">9</span>' }))
  mount('<a id="a" href="/x" h-get h-target="#out" h-swap="inner">Go</a><div id="out"></div><span id="badge">0</span>')
  click($('#a'))
  await tick(10)
  assert.equal($('#out').innerHTML, '<p>main</p>') // OOB stripped from main swap
  assert.equal($('#badge').innerHTML, '9')
})

// ---------------------------------------------------------------------------
// Default swap is `inner` (morph is opt-in).
// ---------------------------------------------------------------------------

test('default swap replaces innerHTML (inner), not append/morph', async () => {
  setRouter(() => ({ body: '<p>new</p>' }))
  mount('<a id="a" href="/x" h-get h-target="#out">Go</a><div id="out"><p>old</p></div>')
  click($('#a'))
  await tick(10)
  assert.equal($('#out').innerHTML, '<p>new</p>')
})

test('unknown h-swap value falls back to inner (not a silent no-op)', async () => {
  setRouter(() => ({ body: '<p>new</p>' }))
  mount('<a id="a" href="/x" h-get h-target="#out" h-swap="anter">Go</a><div id="out"><p>old</p></div>')
  click($('#a'))
  await tick(10)
  assert.equal($('#out').innerHTML, '<p>new</p>')
})

test('h-swap="none" still performs no swap', async () => {
  setRouter(() => ({ body: '<p>new</p>' }))
  mount('<a id="a" href="/x" h-get h-target="#out" h-swap="none">Go</a><div id="out"><p>old</p></div>')
  click($('#a'))
  await tick(10)
  assert.equal($('#out').innerHTML, '<p>old</p>')
})

// ---------------------------------------------------------------------------
// h-disable: one attribute (absent / "" / "false" / selector).
// ---------------------------------------------------------------------------

test('mutation form auto-disables its submit button during the request', async () => {
  setRouter(() => ({ body: '<p>ok</p>' }))
  mount('<form id="f" action="/x" method="post" h-post h-target="#out"><button id="b">Go</button></form><div id="out"></div>')
  submit($('#f'))
  assert.equal($('#b').hasAttribute('disabled'), true) // in-flight
  await tick(10)
  assert.equal($('#b').hasAttribute('disabled'), false) // re-enabled
})

test('h-disable="false" opts out of auto-disable', async () => {
  setRouter(() => ({ body: '<p>ok</p>' }))
  mount('<form id="f" action="/x" method="post" h-post h-disable="false" h-target="#out"><button id="b">Go</button></form><div id="out"></div>')
  submit($('#f'))
  assert.equal($('#b').hasAttribute('disabled'), false)
  await tick(10)
})

test('h-disable (present) disables a GET anchor during the request', async () => {
  setRouter(() => ({ body: '<p>ok</p>' }))
  mount('<a id="a" href="/x" h-get h-disable h-target="#out">Go</a><div id="out"></div>')
  click($('#a'))
  assert.equal($('#a').classList.contains('h-disabled'), true)
  await tick(10)
  assert.equal($('#a').classList.contains('h-disabled'), false)
})

test('h-disable="<selector>" also disables matched elements', async () => {
  setRouter(() => ({ body: '<p>ok</p>' }))
  mount('<a id="a" href="/x" h-get h-disable="#extra" h-target="#out">Go</a><button id="extra">x</button><div id="out"></div>')
  click($('#a'))
  assert.equal($('#extra').hasAttribute('disabled'), true)
  await tick(10)
  assert.equal($('#extra').hasAttribute('disabled'), false)
})

// ---------------------------------------------------------------------------
// h:before-swap (renamed from h:after): fires after response, before swap.
// ---------------------------------------------------------------------------

test('h:before-request is cancelable and can mutate the request', async () => {
  setRouter(() => ({ body: '<p>ok</p>' }))
  let seen = false
  const h = (e) => { seen = !!e.detail.cfg; e.preventDefault() }
  window.document.addEventListener('h:before-request', h)
  mount('<a id="a" href="/x" h-get h-target="#out" h-swap="inner">Go</a><div id="out"><p>old</p></div>')
  click($('#a'))
  await tick(10)
  window.document.removeEventListener('h:before-request', h)
  assert.equal(seen, true)
  assert.equal(captured.fetches.length, 0) // canceling h:before-request blocks the request
  assert.equal($('#out').innerHTML, '<p>old</p>')
})

test('h:before-swap is cancelable and fires before the swap', async () => {
  setRouter(() => ({ body: '<p>new</p>' }))
  let sawAtFire = null
  const h = (e) => { sawAtFire = $('#out').innerHTML; e.preventDefault() }
  window.document.addEventListener('h:before-swap', h)
  mount('<a id="a" href="/x" h-get h-target="#out">Go</a><div id="out"><p>old</p></div>')
  click($('#a'))
  await tick(10)
  window.document.removeEventListener('h:before-swap', h)
  assert.equal(sawAtFire, '<p>old</p>') // fired before the swap (saw old DOM)
  assert.equal($('#out').innerHTML, '<p>old</p>') // canceling prevented the swap
})

// ---------------------------------------------------------------------------
// Deferred / async swaps: a before-swap listener cancels, does async work, then
// re-enters the pipeline via e.detail.swap(html, response?).
// ---------------------------------------------------------------------------

test('before-swap seam: detail.swap re-enters the pipeline with overridden placement', async () => {
  // Build a synthetic Response-like object carrying its own placement headers.
  const reHeaders = { 'H-Retarget': '#other', 'H-Reswap': 'append' }
  const fakeResponse = {
    status: 200,
    ok: true,
    headers: { get: (n) => reHeaders[Object.keys(reHeaders).find((k) => k.toLowerCase() === n.toLowerCase())] ?? null },
    text: async () => '<p>deferred</p>',
  }

  setRouter(() => ({ body: '<p>original</p>' }))
  let swappedHtml = null, defaultRan = false
  const onSwapped = (e) => { swappedHtml = e.detail.html }
  // A listener takes over: cancel the default swap, then (async) hand back new content.
  const onBeforeSwap = (e) => {
    e.preventDefault()
    Promise.resolve().then(() => e.detail.swap('<p>deferred</p>', fakeResponse))
  }
  window.document.addEventListener('h:swapped', onSwapped)
  window.document.addEventListener('h:before-swap', onBeforeSwap)
  mount('<a id="a" href="/x" h-get h-target="#out" h-swap="inner">Go</a><div id="out"><span>keep</span></div><div id="other"><span>keep2</span></div>')
  click($('#a'))
  await tick(20)
  window.document.removeEventListener('h:swapped', onSwapped)
  window.document.removeEventListener('h:before-swap', onBeforeSwap)

  // Default swap did NOT run (original target untouched, original html never swapped).
  assert.equal($('#out').innerHTML, '<span>keep</span>')
  assert.notEqual(swappedHtml, '<p>original</p>')
  // Re-entry honored the new response: retargeted to #other with append strategy.
  assert.equal($('#other').innerHTML, '<span>keep2</span><p>deferred</p>')
  // h:swapped fired with the new html.
  assert.equal(swappedHtml, '<p>deferred</p>')
})

test('before-swap seam: detail.swap without a response reuses the original headers', async () => {
  setRouter(() => ({ headers: { 'H-Retarget': '#other' }, body: '<p>orig</p>' }))
  const onBeforeSwap = (e) => { e.preventDefault(); e.detail.swap('<p>transformed</p>') }
  window.document.addEventListener('h:before-swap', onBeforeSwap)
  mount('<a id="a" href="/x" h-get h-target="#out" h-swap="inner">Go</a><div id="out"></div><div id="other"></div>')
  click($('#a'))
  await tick(20)
  window.document.removeEventListener('h:before-swap', onBeforeSwap)
  // Original response's H-Retarget still applied; only the html was replaced.
  assert.equal($('#out').innerHTML, '')
  assert.equal($('#other').innerHTML, '<p>transformed</p>')
})

test('before-swap seam: detail.swap suppresses the default swap even without preventDefault', async () => {
  // Contract violation: listener calls swap() but forgets preventDefault().
  // The one-shot guard must still prevent the default swap from also running.
  setRouter(() => ({ body: '<p>original</p>' }))
  let swaps = 0
  const onSwapped = () => { swaps++ }
  const onBeforeSwap = (e) => { e.detail.swap('<p>taken</p>') } // no preventDefault()
  window.document.addEventListener('h:swapped', onSwapped)
  window.document.addEventListener('h:before-swap', onBeforeSwap)
  mount('<a id="a" href="/x" h-get h-target="#out" h-swap="inner">Go</a><div id="out"></div>')
  click($('#a'))
  await tick(20)
  window.document.removeEventListener('h:swapped', onSwapped)
  window.document.removeEventListener('h:before-swap', onBeforeSwap)
  // Exactly one swap ran, and it was the re-entry's content (not the original).
  assert.equal(swaps, 1)
  assert.equal($('#out').innerHTML, '<p>taken</p>')
})

test('before-swap seam: detail.swap url override drives the boosted auto push-url', async () => {
  setRouter(() => ({ body: '<html><body><h1>Cont</h1></body></html>' }))
  const onBeforeSwap = (e) => { e.preventDefault(); e.detail.swap('<h1>Cont</h1>', undefined, '/continuation') }
  window.document.addEventListener('h:before-swap', onBeforeSwap)
  // Boosted GET auto-pushes; the override should set the pushed URL.
  mount('<div h-boost><a id="a" href="/orig">Go</a></div>')
  click($('#a'))
  await tick(20)
  window.document.removeEventListener('h:before-swap', onBeforeSwap)
  assert.equal(captured.pushed.at(-1).url, '/continuation')
})

// ---------------------------------------------------------------------------
// Polling via h-trigger="every Ns" + generalized h-get URL source.
// ---------------------------------------------------------------------------

test('h-trigger="every" polls on an interval and stops when detached', async () => {
  setRouter(() => ({ body: '<p>tick</p>' }))
  const root = mount('<a id="a" href="/poll" h-get h-trigger="every 30ms" h-target="#out" h-swap="inner">P</a><div id="out"></div>')
  await tick(100)
  const n = captured.fetches.length
  assert.ok(n >= 2, `expected >=2 polls, got ${n}`)
  assert.equal($('#out').innerHTML, '<p>tick</p>')
  root.remove() // detach -> next tick clears the interval
  await tick(80)
  assert.ok(captured.fetches.length <= n + 1, 'polling stopped after detach')
})

test('polling defaults to h-sync="abort" (requests carry an abort signal)', async () => {
  setRouter(() => ({ body: '<p>x</p>' }))
  const root = mount('<a id="a" href="/poll" h-get h-trigger="every 30ms" h-target="#out">P</a><div id="out"></div>')
  await tick(50)
  root.remove()
  await tick(40)
  assert.ok(captured.fetches.length >= 1)
  assert.ok(captured.fetches.every((f) => f.signal === true), 'every poll used an abort controller')
})

test('a plain click request has no abort signal by default', async () => {
  setRouter(() => ({ body: '<p>x</p>' }))
  mount('<a id="a" href="/x" h-get h-target="#out">Go</a><div id="out"></div>')
  click($('#a'))
  await tick(10)
  assert.equal(captured.fetches[0].signal, false)
})

test('h-get value is the URL source on a non-anchor/form element (div polling)', async () => {
  setRouter((url) => ({ body: `<p>${url}</p>` }))
  mount('<div h-get="/live" h-trigger="every 30ms" h-target="#out" h-swap="inner"></div><div id="out"></div>')
  await tick(70)
  assert.ok(captured.fetches.some((f) => f.url === '/live'))
  assert.equal($('#out').innerHTML, '<p>/live</p>')
})

test('h-get value enables click-to-load on a plain element', async () => {
  setRouter(() => ({ body: '<p>loaded</p>' }))
  mount('<button id="b" h-get="/x" h-target="#out" h-swap="inner">Load</button><div id="out"></div>')
  click($('#b'))
  await tick(10)
  assert.equal(captured.fetches.length, 1)
  assert.equal($('#out').innerHTML, '<p>loaded</p>')
})

test('polling flows through the full pipeline (server H-Retarget honored)', async () => {
  setRouter(() => ({ headers: { 'H-Retarget': '#other' }, body: '<p>moved</p>' }))
  const root = mount('<a id="a" href="/poll" h-get h-trigger="every 30ms" h-target="#out" h-swap="inner">P</a><div id="out"></div><div id="other"></div>')
  await tick(60)
  assert.equal($('#other').innerHTML, '<p>moved</p>')
  root.remove()
  await tick(40)
})

// ---------------------------------------------------------------------------
// h-boost: progressive enhancement of plain hypermedia.
// ---------------------------------------------------------------------------

test('boost: plain <a href> is upgraded to partial swap + push-url', async () => {
  setRouter(() => ({ body: '<html><head><title>About</title></head><body><h1>About</h1></body></html>' }))
  mount('<div h-boost><a id="a" href="/about">About</a></div>')
  click($('#a'))
  await tick(10)
  assert.equal(captured.fetches.length, 1)
  // <body> contents swapped in, full document body extracted.
  assert.match(window.document.body.innerHTML, /<h1>About<\/h1>/)
  // boosted GET pushes the URL by default.
  assert.equal(captured.pushed.at(-1).url, '/about')
})

test('boost: cross-origin link is NOT hijacked', async () => {
  mount('<div h-boost><a id="a" href="https://example.com/x">External</a></div>')
  click($('#a'))
  await tick(10)
  assert.equal(captured.fetches.length, 0)
})

test('boost: target=_blank link is NOT hijacked', async () => {
  mount('<div h-boost><a id="a" href="/x" target="_blank">New tab</a></div>')
  click($('#a'))
  await tick(10)
  assert.equal(captured.fetches.length, 0)
})

test('boost: in-page #anchor is NOT hijacked', async () => {
  mount('<div h-boost><a id="a" href="#section">Jump</a></div>')
  click($('#a'))
  await tick(10)
  assert.equal(captured.fetches.length, 0)
})

test('boost: opt-out with h-boost="false" on descendant', async () => {
  mount('<div h-boost><span h-boost="false"><a id="a" href="/x">No</a></span></div>')
  click($('#a'))
  await tick(10)
  assert.equal(captured.fetches.length, 0)
})

// Auto-push only fires for genuine boosted navigations: the trigger is the
// element's default interaction AND the swap targets the boost default (body).
// In-place / background GET loaders must not rewrite the address bar.

const fireEvent = (el, type) => el.dispatchEvent(new window.CustomEvent(type, { bubbles: true, cancelable: true }))

test('boost: non-default trigger (poller-style) does NOT auto push-url', async () => {
  setRouter(() => ({ body: '<p>tick</p>' }))
  // Custom-event trigger stands in for every/load/intersect: not a navigation.
  mount('<div h-boost><span id="p" h-get="/feed/new" h-trigger="refresh"></span></div>')
  fireEvent($('#p'), 'refresh')
  await tick(10)
  assert.equal(captured.fetches.length, 1)
  assert.equal(captured.pushed.length, 0)
})

test('boost: explicit sub-region target does NOT auto push-url', async () => {
  setRouter(() => ({ body: '<p>added</p>' }))
  mount('<div h-boost><button id="b" h-get="/rows/new" h-target="#region" h-swap="append">Add</button></div><div id="region"></div>')
  click($('#b'))
  await tick(10)
  assert.equal($('#region').innerHTML, '<p>added</p>')
  assert.equal(captured.pushed.length, 0)
})

test('boost: default trigger targeting the body still auto pushes', async () => {
  setRouter(() => ({ body: '<p>page</p>' }))
  // No h-target, so it falls back to the boost default (body): a navigation.
  mount('<div h-boost><button id="b" h-get="/next">Next</button></div>')
  click($('#b'))
  await tick(10)
  assert.equal(captured.pushed.at(-1).url, '/next')
})

test('boost: h-push-url forces history even for a non-navigation trigger', async () => {
  setRouter(() => ({ body: '<p>tick</p>' }))
  mount('<div h-boost><span id="p" h-get="/feed/new" h-trigger="refresh" h-push-url h-target="#out"></span></div><div id="out"></div>')
  fireEvent($('#p'), 'refresh')
  await tick(10)
  assert.equal(captured.pushed.at(-1).url, '/feed/new')
})

// ---------------------------------------------------------------------------
// Stateless history: back/forward re-derives view state from the server.
// ---------------------------------------------------------------------------

test('history: popstate re-fetches from the server, not a client cache', async () => {
  setRouter(() => ({ body: '<p>server</p>' }))
  mount('<div id="out"></div>')
  const stateEntry = { h: true, url: '/page/about', target: '#out', swap: 'inner', select: null, title: 'About' }
  window.dispatchEvent(new window.PopStateEvent('popstate', { state: stateEntry }))
  await tick(10)
  assert.equal(captured.fetches.at(-1)?.url, '/page/about')
  assert.equal($('#out').innerHTML, '<p>server</p>')
})

// ---------------------------------------------------------------------------
// Submitter override: the clicked submit button overrides the form's request
// config (native formaction/formmethod + h-* attrs), falling back to the form.
// ---------------------------------------------------------------------------

test('submitter: native formaction overrides the form action', async () => {
  setRouter(() => ({ body: '<p>ok</p>' }))
  mount('<form id="f" action="/save" method="post" h-post h-target="#out"><button id="b" formaction="/delete">Delete</button></form><div id="out"></div>')
  submitBy($('#f'), $('#b'))
  await tick(10)
  assert.equal(captured.fetches.at(-1).url, '/delete')
  assert.equal(captured.fetches.at(-1).method, 'POST')
})

test('submitter: native formmethod overrides the form method', async () => {
  setRouter(() => ({ body: '<p>ok</p>' }))
  mount('<form id="f" action="/x" method="post" h-post h-target="#out"><input name="q" value="hi"><button id="b" formmethod="get">Search</button></form><div id="out"></div>')
  submitBy($('#f'), $('#b'))
  await tick(10)
  // GET serializes the form into the query string and sends no body.
  assert.equal(captured.fetches.at(-1).method, 'GET')
  assert.ok(captured.fetches.at(-1).url.startsWith('/x?q=hi'), captured.fetches.at(-1).url)
})

test('submitter: h-* method attr on the button overrides the form', async () => {
  setRouter(() => ({ body: '<p>ok</p>' }))
  mount('<form id="f" action="/x" method="post" h-post h-target="#out"><button id="b" h-delete>Remove</button></form><div id="out"></div>')
  submitBy($('#f'), $('#b'))
  await tick(10)
  assert.equal(captured.fetches.at(-1).method, 'DELETE')
})

test('submitter: h-get value on the button is the URL and forces GET', async () => {
  setRouter(() => ({ body: '<p>ok</p>' }))
  mount('<form id="f" action="/x" method="post" h-post h-target="#out"><button id="b" h-get="/peek">Peek</button></form><div id="out"></div>')
  submitBy($('#f'), $('#b'))
  await tick(10)
  assert.equal(captured.fetches.at(-1).method, 'GET')
  assert.ok(captured.fetches.at(-1).url.startsWith('/peek'), captured.fetches.at(-1).url)
})

test('submitter: h-target / h-swap on the button override the form', async () => {
  setRouter(() => ({ body: '<p>via-button</p>' }))
  mount('<form id="f" action="/x" method="post" h-post h-target="#out" h-swap="inner"><button id="b" h-target="#alt" h-swap="append">Go</button></form><div id="out"></div><div id="alt"><span>x</span></div>')
  submitBy($('#f'), $('#b'))
  await tick(10)
  assert.equal($('#out').innerHTML, '')
  assert.equal($('#alt').innerHTML, '<span>x</span><p>via-button</p>')
  assert.equal(captured.fetches.at(-1).headers['H-Target'], '#alt')
})

test('submitter: h-select on the button selects from the response', async () => {
  setRouter(() => ({ body: '<div id="frag"><b>pick-me</b></div><p>ignore</p>' }))
  mount('<form id="f" action="/x" method="post" h-post h-target="#out"><button id="b" h-select="#frag">Go</button></form><div id="out"></div>')
  submitBy($('#f'), $('#b'))
  await tick(10)
  assert.equal($('#out').innerHTML, '<b>pick-me</b>')
})

test('submitter: h-headers on the button override the form headers', async () => {
  setRouter(() => ({ body: '<p>ok</p>' }))
  mount('<form id="f" action="/x" method="post" h-post h-target="#out" h-headers=\'{"X-From":"form"}\'><button id="b" h-headers=\'{"X-From":"button"}\'>Go</button></form><div id="out"></div>')
  submitBy($('#f'), $('#b'))
  await tick(10)
  assert.equal(captured.fetches.at(-1).headers['X-From'], 'button')
})

test('submitter: button without overrides falls back to the form config', async () => {
  setRouter(() => ({ body: '<p>form-wins</p>' }))
  mount('<form id="f" action="/x" method="post" h-post h-target="#out" h-swap="inner"><button id="b">Go</button></form><div id="out"></div>')
  submitBy($('#f'), $('#b'))
  await tick(10)
  assert.equal(captured.fetches.at(-1).url, '/x')
  assert.equal(captured.fetches.at(-1).method, 'POST')
  assert.equal($('#out').innerHTML, '<p>form-wins</p>')
})

// ---------------------------------------------------------------------------
// Uniform interface: controls inside swapped-in fragments become live.
// ---------------------------------------------------------------------------

test('newly swapped-in controls are automatically activated', async () => {
  let calls = 0
  setRouter((url) => {
    calls++
    if (url.endsWith('/step1')) return { body: '<a id="b" href="/step2" h-get h-target="#out" h-swap="inner">Next</a>' }
    return { body: '<p>step2</p>' }
  })
  mount('<a id="a" href="/step1" h-get h-target="#out" h-swap="inner">Start</a><div id="out"></div>')
  click($('#a'))
  await tick(20)
  const b = $('#b')
  assert.ok(b, 'swapped-in control exists')
  click(b)
  await tick(20)
  assert.equal($('#out').innerHTML, '<p>step2</p>')
})

// ---------------------------------------------------------------------------
// h-insert: client-side text insertion into an input/textarea at the caret.
// The one swap-less primitive (caret editing isn't a DOM swap).
// ---------------------------------------------------------------------------

const setCaret = (el, start, end = start) => { el.focus(); el.setSelectionRange(start, end) }

test('insert: plain insert splices text at the caret and places it after', () => {
  mount('<textarea id="t">hello world</textarea><button id="b" h-insert="X" h-insert-target="#t">go</button>')
  setCaret($('#t'), 5)
  click($('#b'))
  assert.equal($('#t').value, 'helloX world')
  assert.equal($('#t').selectionStart, 6)
})

test('insert: plain insert replaces the active selection', () => {
  mount('<input id="t" value="abcdef"><button id="b" h-insert="-" h-insert-target="#t">go</button>')
  setCaret($('#t'), 1, 4) // select "bcd"
  click($('#b'))
  assert.equal($('#t').value, 'a-ef')
})

test('insert: replace mode swaps the trailing token (mention typeahead)', () => {
  mount('<textarea id="t">hi @al</textarea><button id="b" h-insert="nostr:npub1 " h-insert-target="#t" h-insert-replace="[@:]\\S*$">@alice</button>')
  setCaret($('#t'), 6)
  click($('#b'))
  assert.equal($('#t').value, 'hi nostr:npub1 ')
  assert.equal($('#t').selectionStart, 'hi nostr:npub1 '.length)
})

test('insert: replace mode is anchored to the caret, editing mid-text', () => {
  mount('<textarea id="t">a @al b</textarea><button id="b" h-insert="X" h-insert-target="#t" h-insert-replace="[@:]\\S*$">x</button>')
  setCaret($('#t'), 5) // caret right after "@al", before " b"
  click($('#b'))
  assert.equal($('#t').value, 'a X b')
})

test('insert: fires a bubbling input event so bound behavior re-runs', () => {
  mount('<textarea id="t">@al</textarea><button id="b" h-insert="done " h-insert-target="#t">go</button>')
  setCaret($('#t'), 3)
  let fired = 0
  $('#t').addEventListener('input', () => fired++)
  click($('#b'))
  assert.equal(fired, 1)
})

test('insert: the dispatched input re-fires the field\'s own h-trigger="input"', async () => {
  setRouter(() => ({ body: '' }))
  // The textarea asks the server for matches on input; picking a suggestion edits
  // it and the synthetic input event drives a fresh suggest request (now empty).
  mount('<textarea id="t" h-get="/suggest" h-trigger="input" h-target="#box">@al</textarea><button id="b" h-insert="nostr:npub1 " h-insert-target="#t" h-insert-replace="[@:]\\S*$">pick</button><div id="box"></div>')
  setCaret($('#t'), 3)
  click($('#b'))
  await tick(10)
  assert.equal($('#t').value, 'nostr:npub1 ')
  assert.ok(captured.fetches.some((f) => f.url.startsWith('/suggest')), 'pick re-ran the suggest request')
})

test('insert: a suggestion swapped into the page is live', async () => {
  setRouter(() => ({ body: '<button id="pick" h-insert="nostr:npub1 " h-insert-target="#t" h-insert-replace="[@:]\\S*$">@alice</button>' }))
  mount('<textarea id="t">hi @al</textarea><a id="s" href="/suggest" h-get h-target="#box" h-swap="inner">x</a><div id="box"></div>')
  setCaret($('#t'), 6)
  click($('#s'))
  await tick(20)
  const pick = $('#pick')
  assert.ok(pick, 'suggestion is in the DOM')
  click(pick)
  assert.equal($('#t').value, 'hi nostr:npub1 ')
})

test('insert: no-op (no throw, no change) when the target is missing', () => {
  mount('<textarea id="t">keep</textarea><button id="b" h-insert="X" h-insert-target="#nope">go</button>')
  setCaret($('#t'), 2)
  click($('#b'))
  assert.equal($('#t').value, 'keep')
})

// ---------------------------------------------------------------------------
// h-selection: opt in to sending the field's caret as request headers so the
// server can detect the active token exactly, even mid-text.
// ---------------------------------------------------------------------------

test('selection: h-selection sends the requesting field\'s caret as headers', async () => {
  setRouter(() => ({ body: '' }))
  mount('<textarea id="t" h-get="/suggest" h-trigger="input" h-target="#box" h-selection>a @al b</textarea><div id="box"></div>')
  setCaret($('#t'), 5) // caret right after "@al"
  $('#t').dispatchEvent(new window.Event('input', { bubbles: true }))
  await tick(10)
  const h = captured.fetches.at(-1).headers
  assert.equal(h['H-Selection-Start'], '5')
  assert.equal(h['H-Selection-End'], '5')
})

test('selection: a selector value reads the caret from another field', async () => {
  setRouter(() => ({ body: '' }))
  mount('<textarea id="c">hello</textarea><a id="a" href="/suggest" h-get h-target="#box" h-selection="#c">go</a><div id="box"></div>')
  setCaret($('#c'), 1, 4) // selection "ell"
  click($('#a'))
  await tick(10)
  const h = captured.fetches.at(-1).headers
  assert.equal(h['H-Selection-Start'], '1')
  assert.equal(h['H-Selection-End'], '4')
})

test('selection: absent h-selection sends no caret headers', async () => {
  setRouter(() => ({ body: '' }))
  mount('<textarea id="t" h-get="/suggest" h-trigger="input" h-target="#box">a @al</textarea><div id="box"></div>')
  setCaret($('#t'), 5)
  $('#t').dispatchEvent(new window.Event('input', { bubbles: true }))
  await tick(10)
  const h = captured.fetches.at(-1).headers
  assert.equal(h['H-Selection-Start'], undefined)
  assert.equal(h['H-Selection-End'], undefined)
})

// ---------------------------------------------------------------------------
// h-combobox: arrow/Enter/Escape keyboard navigation of a suggestion dropdown.
// Active item is the `h-active` class in the DOM, so it's stateless across the
// server re-rendering the list.
// ---------------------------------------------------------------------------

const keydown = (el, key) => {
  const e = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  el.dispatchEvent(e)
  return e
}
const opts = () => [...$('#box').querySelectorAll('[role="option"]')]
const activeIdx = () => opts().findIndex((o) => o.classList.contains('h-active'))
const POPUP = '<button role="option">a</button><button role="option">b</button><button role="option">c</button>'

test('combobox: ArrowDown highlights the first option, then advances', () => {
  mount('<input id="t" h-combobox="#box"><div id="box">' + POPUP + '</div>')
  keydown($('#t'), 'ArrowDown')
  assert.equal(activeIdx(), 0)
  keydown($('#t'), 'ArrowDown')
  assert.equal(activeIdx(), 1)
})

test('combobox: ArrowDown wraps from the last option to the first', () => {
  mount('<input id="t" h-combobox="#box"><div id="box">' + POPUP + '</div>')
  keydown($('#t'), 'ArrowDown'); keydown($('#t'), 'ArrowDown'); keydown($('#t'), 'ArrowDown') // 0,1,2
  assert.equal(activeIdx(), 2)
  keydown($('#t'), 'ArrowDown')
  assert.equal(activeIdx(), 0)
})

test('combobox: ArrowUp from nothing active selects the last option', () => {
  mount('<input id="t" h-combobox="#box"><div id="box">' + POPUP + '</div>')
  keydown($('#t'), 'ArrowUp')
  assert.equal(activeIdx(), 2)
})

test('combobox: arrow keys set aria-selected and aria-activedescendant', () => {
  mount('<input id="t" h-combobox="#box"><div id="box"><button id="o0" role="option">a</button><button id="o1" role="option">b</button></div>')
  keydown($('#t'), 'ArrowDown')
  assert.equal($('#o0').getAttribute('aria-selected'), 'true')
  assert.equal($('#o1').getAttribute('aria-selected'), 'false')
  assert.equal($('#t').getAttribute('aria-activedescendant'), 'o0')
})

test('combobox: Enter clicks the active option (driving h-insert)', () => {
  mount('<textarea id="c">hi @al</textarea><input id="t" h-combobox="#box"><div id="box"><button role="option" h-insert="nostr:npub1 " h-insert-target="#c" h-insert-replace="[@:]\\S*$">@alice</button></div>')
  setCaret($('#c'), 6)
  keydown($('#t'), 'ArrowDown')
  keydown($('#t'), 'Enter')
  assert.equal($('#c').value, 'hi nostr:npub1 ')
})

test('combobox: Escape closes the dropdown', () => {
  mount('<input id="t" h-combobox="#box"><div id="box">' + POPUP + '</div>')
  const e = keydown($('#t'), 'Escape')
  assert.equal($('#box').innerHTML, '')
  assert.equal(e.defaultPrevented, true)
})

test('combobox: keys pass through when the dropdown is empty', () => {
  mount('<input id="t" h-combobox="#box"><div id="box"></div>')
  const down = keydown($('#t'), 'ArrowDown')
  const esc = keydown($('#t'), 'Escape')
  assert.equal(down.defaultPrevented, false)
  assert.equal(esc.defaultPrevented, false)
})

test('combobox: a server-rendered h-active option makes Enter pick it immediately', () => {
  mount('<textarea id="c">hi @al</textarea><input id="t" h-combobox="#box"><div id="box"><button role="option" class="h-active" h-insert="X " h-insert-target="#c" h-insert-replace="[@:]\\S*$">@alice</button></div>')
  setCaret($('#c'), 6)
  keydown($('#t'), 'Enter') // no arrow first
  assert.equal($('#c').value, 'hi X ')
})
