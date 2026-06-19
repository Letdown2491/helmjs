# HelmJS API Reference

Complete API reference and implementation details for HelmJS.

## Table of Contents

- [Philosophy](#philosophy)
- [Build Commands](#build-commands)
- [Architecture](#architecture)
- [Attributes Reference](#attributes-reference)
- [Swap Strategies](#swap-strategies)
- [Trigger System](#trigger-system)
- [Out-of-Band Updates](#out-of-band-updates)
- [Prefetch](#prefetch)
- [Polling](#polling)
- [Server-Sent Events](#server-sent-events)
- [Events](#events)
- [CSS Classes](#css-classes)
- [Request Headers](#request-headers)
- [Response Headers (server-driven control)](#response-headers-server-driven-control)
- [Progressive Enhancement (h-boost)](#progressive-enhancement-h-boost)
- [Graceful Degradation Contract](#graceful-degradation-contract)
- [History Management](#history-management)
- [View Transitions](#view-transitions)

---

## Philosophy

HelmJS is built for developers creating HATEOAS-compliant web applications who want simple HTML-driven enhancements without complex JavaScript frameworks.

### Core Principles

1. **Server is the source of truth** - The server controls application state and sends complete HTML. No client-side state management, routing, or URL generation.

2. **Semantic HTML required** - Use proper HTML elements. `<a href>` for navigation, `<form action>` for submissions. Applications must work without JavaScript.

3. **Strict HATEOAS compliance** - The client never invents URLs. All actions come from server-provided hypermedia controls. The server can drive every transition from the response via [response headers](#response-headers-server-driven-control), and plain hypermedia can be enhanced transparently with [`h-boost`](#progressive-enhancement-h-boost). See the [compliance summary](README.md#compliance-summary) in the README.

4. **Minimal footprint** - Every byte must be justified. No runtime dependencies. Currently ~4.7KB gzipped (see [Size](README.md#size) for what that buys).

5. **Intuitive defaults** - Zero config for common cases. Opinionated defaults enforce good hypermedia practices.

### Semantic Constraints

| Attribute | Allowed Elements | URL Source |
|-----------|------------------|------------|
| `h-get` | any | `href` (`<a>`), `action` (`<form>`), else the `h-get` value |
| `h-post` | `<form>` only | `action` attribute |
| `h-put` | `<form>` only | `action` attribute |
| `h-patch` | `<form>` only | `action` attribute |
| `h-delete` | `<form>` only | `action` attribute |

GET is safe/idempotent, so `h-get` is allowed on any element: `<a>`/`<form>` take the
URL from `href`/`action` (and degrade with JS off), while any other element takes the
URL from `h-get`'s value (JS-only, for live regions and polling, where there is no
native control to degrade to). Mutation methods (POST, PUT, PATCH, DELETE) stay
restricted to `<form>` with a real `action`, for both safety and degradation.

---

## Build Commands

```bash
npm run build      # Production build: minified dist/helm.js + dist/helm.js.gz + .d.ts
npm run dev        # Development build (with sourcemaps)
npm run watch      # Watch mode for development
npm run size       # Check bundle size (raw + gzipped)
npm run typecheck  # Type check without emitting
npm test           # Build + run the jsdom test suite
```

`dist/helm.js` and its reproducible `dist/helm.js.gz` (gzip `-9 -n`, so no embedded
timestamp) are committed. A pre-commit hook (`.githooks/pre-commit`, auto-enabled by
the `prepare` script on `npm install`) rebuilds the bundle and blocks the commit if
either committed artifact is stale relative to `src/`.

---

## Architecture

```
src/
  index.ts    # Main entry point, all library code
dist/
  helm.js     # Bundled output (ESM, minified)
  index.d.ts  # TypeScript declarations
test/
  index.html      # Manual test page (mock server)
  harness.mjs     # jsdom + mock-fetch harness (dev-only)
  helm.test.mjs   # Automated tests (node:test): degradation, headers, boost, history
```

Run `npm test` for the automated suite (builds the bundle, then runs `node --test`).
`jsdom` is a **dev** dependency only; the shipped library has zero runtime dependencies.

- **Build**: esbuild bundles TypeScript to a single minified ESM file
- **Types**: tsc generates declaration files only
- **Target**: ES2022, modern browsers only

---

## Attributes Reference

### Naming conventions

HelmJS uses casing to mark which layer a name belongs to:

- **`h-*` (lowercase)**: HTML attributes you author in markup (`h-get`, `h-target`,
  `h-swap`). HTML attribute names are case-insensitive and lowercase by convention.
- **`H-*` (Title-Case)**: HTTP headers, both request (`H-Request`, `H-Target`) and
  response (`H-Retarget`, `H-Reselect`, …). HTTP header names are case-insensitive on
  the wire, so `h-reselect` also works, but Title-Case is the HTTP convention and
  makes "this is a header, not an attribute" obvious at a glance.
- **`h:*`**: DOM events (`h:before-request`, `h:swapped`).

So `H-Reselect` is the response-header counterpart of the `h-select` attribute: same
intent (pick a fragment), different layer: the server dictating it from the response.

### Request Attributes

| Attribute | Elements | Description |
|-----------|----------|-------------|
| `h-get` | any | AJAX GET request. URL from `href` (`<a>`), `action` (`<form>`), or `h-get`'s own value (any other element). Forms serialize data as query params. The `<a>`/`<form>` forms degrade with JS off; the value form (e.g. on a `<div>`/`<button>`) is JS-only. |
| `h-post` | `<form>` | AJAX POST request. URL from `action` attribute. |
| `h-put` | `<form>` | AJAX PUT request. URL from `action` attribute. |
| `h-patch` | `<form>` | AJAX PATCH request. URL from `action` attribute. |
| `h-delete` | `<form>` | AJAX DELETE request. URL from `action` attribute. |
| `h-boost` | container | Upgrade plain `<a href>` / `<form action>` descendants to AJAX partial-swap + push-url navigation, with no other helmjs attributes required. Set `h-boost="false"` on a descendant to opt out. See [Progressive Enhancement](#progressive-enhancement-h-boost). |

### Response Handling

| Attribute | Elements | Description |
|-----------|----------|-------------|
| `h-target` | any | CSS selector for response destination. Default: the triggering element. **Fallback only**: prefer server-declared placement (`h-oob` or the `H-Retarget` response header), which keeps responses self-descriptive. |
| `h-swap` | any | How to insert the response. Default: `inner`. Use `h-swap="morph"` to opt into DOM-diffing. Overridable per-response with `H-Reswap`. |
| `h-select` | any | CSS selector to extract a fragment from the response before swapping. Overridable per-response with `H-Reselect`. |
| `h-scroll` | any | Scroll behavior after swap: `top`, `bottom`, `target`, or a CSS selector. |
| `h-focus` | any | CSS selector for element to focus after swap. |

### Behavior Modifiers

| Attribute | Elements | Description |
|-----------|----------|-------------|
| `h-trigger` | any | Event that triggers the request. Default: `submit` for forms, `click` for links. Supports multiple comma-separated triggers. |
| `h-sync` | any | Request coordination: `abort` (cancel in-flight), `drop` (ignore if in-flight). |
| `h-confirm` | any | Show a confirmation dialog with this message before sending the request. |
| `h-indicator` | any | CSS selector for element(s) to receive `h-loading` class during request. |
| `h-headers` | any | JSON object of custom headers to include in the request. |
| `h-disable` | any | Control request-time disabling. Absent: auto-disable the form's submit controls during mutations. `h-disable` (present) or a value: disable on any method. `h-disable="false"`: opt out. `h-disable="<selector>"`: also disable the matched elements. |
| `h-prefetch` | `<a>` | Prefetch content on hover/focus. Value: `hover` (default), `intersect`, or with TTL: `hover 60s`. |
| `h-include` | any | CSS selector for elements to include in the request. Their name/value pairs are serialized as query params (GET) or FormData (POST/PUT/PATCH). |
| `h-ignore` | any | Skip HelmJS processing for this element and all descendants. |

### History

| Attribute | Elements | Description |
|-----------|----------|-------------|
| `h-push-url` | any | Push the request URL to browser history after successful swap. |
| `h-replace-url` | any | Replace current URL in browser history after successful swap. |

### Real-time Updates

Polling is a trigger, not a separate attribute; use `h-trigger="every 5s"` (see
[Polling](#polling)).

| Attribute | Elements | Description |
|-----------|----------|-------------|
| `h-sse` | any | URL of Server-Sent Events endpoint to connect to. |
| `h-sse-on` | `<template>` | Route SSE events by name to specific targets. |

### Out-of-Band (Response Elements)

| Attribute | Elements | Description |
|-----------|----------|-------------|
| `h-oob` | response elements | Swap this element out-of-band. Value: `true` (outer swap) or a swap strategy. |

---

## Swap Strategies

The `h-swap` attribute controls how response HTML is inserted into the DOM.

| Strategy | Description |
|----------|-------------|
| `inner` | **Default.** Replace the target's innerHTML. |
| `outer` | Replace the entire target element (outerHTML). |
| `before` | Insert before the target element. |
| `after` | Insert after the target element. |
| `prepend` | Insert at the beginning of the target's children. |
| `append` | Insert at the end of the target's children. |
| `morph` | Smart DOM diffing that preserves focus, input values, and scroll position. Opt-in. |
| `none` | Don't swap. Useful for side-effect-only requests. |

### Morph Algorithm (`h-swap="morph"`)

`inner` is the default because it is predictable and small. Opt into `morph` when you
need to update content *in place* without losing focus, input values, or scroll
position. The `morph` strategy performs intelligent DOM diffing:

1. Matches elements by `id` attribute first
2. Falls back to position + tag name matching
3. Preserves `<input>` values and checked states
4. Preserves `<textarea>` content
5. Updates attributes that changed
6. Recursively morphs children

> **Note:** `morph` is the largest single piece of the bundle (~470 B gzipped). The
> default swap is `inner`, so you only pay for `morph`'s behavior when you opt in with
> `h-swap="morph"`; an unknown swap value also falls back to `inner`.

---

## Trigger System

The `h-trigger` attribute specifies when to send the request.

### Basic Triggers

```html
<a href="/page" h-get h-trigger="click">Click me</a>
<form action="/search" h-get h-trigger="submit">...</form>
```

Default triggers:
- `<form>` elements: `submit`
- `<a>` elements: `click`

### Multiple Triggers

Specify multiple triggers separated by commas. Each trigger can have its own modifiers:

```html
<form action="/search" h-get h-trigger="input debounce:300 from:#q, submit">
  <input id="q" name="q" placeholder="Search...">
  <button>Search</button>
</form>
```

This form triggers on:
- Debounced input events from `#q`
- Form submit (button click or Enter key)

### Modifiers

Modifiers follow the event name, separated by spaces:

```html
h-trigger="input debounce:300"
h-trigger="scroll throttle:200"
h-trigger="click once"
h-trigger="intersect once threshold:0.5"
```

| Modifier | Description |
|----------|-------------|
| `debounce:ms` | Wait for pause in events. Default: 300ms. |
| `throttle:ms` | Limit event frequency. Default: 300ms. |
| `once` | Only trigger once, then remove listener. |
| `capture` | Use capture phase for event listener. |
| `passive` | Mark listener as passive. |
| `from:selector` | Listen for events on another element instead of self. |

### The `from:` Modifier

Listen for events on a different element. Useful for forms that should react to child input events:

```html
<form action="/search" h-get h-target="#results" h-trigger="input debounce:300 from:#search-input">
  <input id="search-input" name="q">
  <button>Search</button>
</form>
<div id="results"></div>
```

The form listens for `input` events on `#search-input`, but the form itself handles the request (using its `action`, `h-target`, etc.).

### Intersection Observer

The special `intersect` trigger fires when the element enters the viewport:

```html
<a href="/more" h-get h-trigger="intersect once" h-swap="append">
  Load more when visible
</a>
```

Intersection-specific modifiers:

| Modifier | Description |
|----------|-------------|
| `threshold:0.5` | Visibility ratio to trigger (0-1). Default: 0. |
| `rootMargin:100px` | Margin around viewport. Default: 0px. |

### Interval (`every`)

The special `every` trigger re-runs the request on an interval; this is how polling
works. See [Polling](#polling).

```html
<a href="/api/status" h-get h-trigger="every 5s" h-target="#status">Status</a>
```

`every <n>[ms|s|m]`; default `30s`. Stops when the element leaves the DOM.

---

## Out-of-Band Updates

Out-of-band (OOB) updates allow a single response to update multiple elements.

### How It Works

1. Server includes elements with `h-oob` attribute in response
2. HelmJS extracts these before the main swap
3. Each OOB element is swapped into its target (determined by `id`)
4. Remaining response is swapped normally

### Server Response Example

```html
<!-- Main content for h-target -->
<div class="timeline-item">New post content</div>

<!-- OOB: Update notification badge -->
<span id="notification-count" h-oob="inner">5</span>

<!-- OOB: Clear the post form -->
<form id="post-form" h-oob="outer">
  <textarea name="content"></textarea>
  <button>Post</button>
</form>
```

### OOB Swap Strategies

The OOB element's `id` identifies the **target** (an existing element with that id).

| Value | Behavior |
|-------|----------|
| `true` | Replace the entire target element with the OOB element (outer). |
| `outer` | Same as `true`. |
| `inner` | Set the target's innerHTML to the OOB element's contents. |
| `prepend` | Insert the OOB element's contents at the start of the target. |
| `append` | Insert the OOB element's contents at the end of the target. |
| `before` / `after` | Insert the OOB element's contents before/after the target. |

Only `true`/`outer` use the OOB element itself; every other strategy uses the OOB
element's *contents*, so the wrapper tag isn't duplicated into the target.

> OOB is for **DOM** updates. Input-value manipulation strategies (`value`,
> `replace`, `merge`) were removed in the slim-down; handle that kind of niche
> client state in an `h:swapped`/`H-Trigger` handler instead.

---

## Prefetch

Pre-fetch content on hover or focus to improve perceived performance.

### Basic Usage

```html
<a href="/page" h-get h-prefetch>View details</a>
```

When the user hovers over or focuses the link, HelmJS fetches the content in the background. When they click, the cached response is used immediately.

### Syntax

```
h-prefetch="[trigger] [ttl]"
```

- **trigger**: `hover` (default) or `intersect`
- **ttl**: Cache duration. Default: `30s`. Supports: `ms`, `s`, `m`.

### Examples

```html
<a href="/page" h-get h-prefetch>Link</a>                    <!-- hover + focus, 30s TTL -->
<a href="/page" h-get h-prefetch="hover">Link</a>            <!-- same as above -->
<a href="/page" h-get h-prefetch="hover 60s">Link</a>        <!-- 60 second TTL -->
<a href="/page" h-get h-prefetch="intersect">Link</a>        <!-- prefetch when visible -->
```

### Behavior

- `hover` trigger also listens for `focus` events (keyboard accessibility)
- Only works on `<a>` elements with `h-get`
- Respects `h-target` and `h-headers` attributes
- If user clicks while prefetch is in-flight, reuses the pending request
- Cache entries are consumed on use (one prefetch per navigation)
- Does not prefetch if a valid cache entry already exists

---

## Polling

Polling is just a trigger: `h-trigger="every <interval>"`. It re-runs the element's
normal request on an interval, so polling gets the **full request pipeline**
(`h-target`/`h-swap`/`h-select`, `h-sync`, OOB, server `H-*` headers, error placement,
indicators, and the standard events) instead of a separate, weaker code path.

### Basic Usage

```html
<!-- refresh a region in place: default target is self, default swap is inner -->
<a href="/api/status" h-get h-trigger="every 5s">Loading…</a>

<!-- poll into a different target -->
<a href="/api/status" h-get h-trigger="every 5s" h-target="#status">Status</a>
```

### Interval

`every <n>[ms|s|m]`; default `30s` if omitted (`every`).

```html
h-trigger="every 500ms"
h-trigger="every 5s"
h-trigger="every 1m"
```

### Polling a non-link region (`<div>`)

When link/form semantics are wrong (e.g. a live dashboard widget), put the URL in
`h-get`'s value on any element:

```html
<div h-get="/api/metrics" h-trigger="every 10s">…</div>
```

`h-get` takes its URL from `href` on `<a>`, `action` on `<form>`, or its own value on
any other element. The first two degrade to native navigation/submission with JS off;
the `<div>` form is JS-only (polling has no no-JS equivalent anyway).

### Behavior

- First request fires after one interval (not immediately).
- Stops automatically when the element is removed from the DOM.
- Combine with `h-sync="abort"` to drop overlapping requests when responses are slow.

---

## Server-Sent Events

Connect to an SSE endpoint for real-time server-pushed updates.

### Basic Usage

```html
<div h-sse="/events" h-target="#messages" h-swap="prepend"></div>
<div id="messages"></div>
```

### Event Routing

Route different SSE event types to different targets using `<template>` elements:

```html
<div h-sse="/events">
  <template h-sse-on="notification" h-target="#notifications" h-swap="prepend"></template>
  <template h-sse-on="message" h-target="#messages" h-swap="append"></template>
</div>
```

### Server Implementation

```
event: notification
data: <div class="notification">New follower!</div>

event: message
data: <div class="message">Hello world</div>
```

### Events

| Event | Detail | Description |
|-------|--------|-------------|
| `h:sse-connect` | `{ url }` | Connection established |
| `h:sse-message` | `{ data }` or `{ event, data }` | Message received |
| `h:sse-error` | `{ url }` | Connection error |

---

## Events

HelmJS dispatches custom events throughout the request lifecycle. All events bubble and are cancelable (where noted).

### Request Lifecycle

| Event | Cancelable | Detail | Description |
|-------|------------|--------|-------------|
| `h:init` | Yes | `{}` | Before element initialization. Cancel to skip. |
| `h:ready` | No | `{}` | After element initialization complete. |
| `h:before-request` | Yes | `{ cfg }` | Before request sent. Modify `cfg` to change request. Cancel to skip. |
| `h:before-swap` | Yes | `{ cfg, response, html, swap }` | After response, before swap. Cancel to skip the swap. `swap(html, response?)` re-enters the pipeline (see [Deferred / async swaps](#deferred--async-swaps)). |
| `h:swapped` | No | `{ cfg, response, html }` | After DOM update complete. |
| `h:error` | No | `{ cfg, response, html }` or `{ cfg, error }` | Request failed or HTTP 4xx/5xx. |

### Configuration Object (cfg)

```typescript
interface HConfig {
  trigger: Event       // The triggering event
  action: string       // Request URL
  method: HttpMethod   // GET, POST, PUT, PATCH, DELETE
  target: Element      // Swap destination
  swap: SwapStrategy   // How to swap
  body: FormData|null  // Request body (forms only)
  headers: Record<string, string>  // Request headers
}
```

### Usage Examples

```javascript
// Add auth header to all requests
document.addEventListener('h:before-request', (e) => {
  e.detail.cfg.headers['Authorization'] = 'Bearer ' + token
})

// Process data after swap (e.g., for autocomplete selection)
document.addEventListener('h:swapped', (e) => {
  const { response, html } = e.detail
  const mentionName = response.headers.get('X-Mention-Name')
  if (mentionName) handleMentionSelect(mentionName)
})

// Log errors
document.addEventListener('h:error', (e) => {
  console.error('Request failed:', e.detail)
})

// Prevent specific request
element.addEventListener('h:before-request', (e) => {
  if (someCondition) e.preventDefault()
})
```

### Deferred / async swaps

`h:before-swap` lets a listener **take over** the swap, do asynchronous work, and
then hand replacement content back to HelmJS so the **normal swap pipeline** still
runs on it (placement headers, OOB, view transitions, `h:swapped`, scroll/focus,
push/replace URL). This avoids hand-rolling a swap and losing those behaviors.

The seam is `e.detail.swap(html, response?, url?)`:

```javascript
document.addEventListener('h:before-swap', (e) => {
  e.preventDefault()                 // take over: the default swap is skipped
  ;(async () => {
    const html = await transform(e.detail.html)   // your async step
    await e.detail.swap(html)        // re-enter the standard swap pipeline
  })()
})
```

- **Call `preventDefault()`.** A listener that calls `swap()` is taking over;
  `preventDefault()` is the idiomatic way to stop the default swap from also
  running. As a safety net, invoking `swap()` is itself self-correcting: it
  suppresses the default swap even if you forget `preventDefault()`, so the two
  can't both run (no double-swap).
- **`html`** is placed exactly as a normal response would be: into `cfg.target`
  with `cfg.swap`, inside the View Transition wrapper when available, followed by
  `h:swapped` and the usual scroll/focus/history effects.
- **`response`** (optional) supplies the placement headers to honor:
  `H-Reselect`, `H-Retarget`, `H-Reswap`, `H-Push-Url`/`H-Replace-Url`, and
  `H-Trigger`/`H-Trigger-After-Swap`. Pass a `Response` (or any object with a
  `headers.get(name)` method) when your async step fetched a follow-up response.
  Omit it to reuse the **original** response's headers.
- **`url`** (optional) overrides the URL used for the automatic push/replace
  default (a boosted GET pushes by default). It only matters when your async
  step navigated to a different URL and you rely on auto-push; an explicit
  `H-Push-Url`/`H-Replace-Url` header still wins. Omit it to reuse the original
  request URL.
- Returns a `Promise` that resolves once the swap (including any view
  transition) completes, so you can `await` it.

> The seam is deliberately domain-agnostic: it only moves HTML through the same
> pipeline. Use cases such as transforming, decrypting, or signing a payload and
> fetching a follow-up response live entirely in your listener.

The early-return navigation headers on the **original** response (`H-Refresh`,
`H-Redirect`, `H-Location`) are handled before `h:before-swap` fires; they are not
re-evaluated for a re-entry via `swap()`.

### Manual Processing

Dispatch `h:process` to initialize dynamically added elements:

```javascript
const newContent = document.getElementById('new-content')
newContent.dispatchEvent(new CustomEvent('h:process', { bubbles: true }))
```

---

## CSS Classes

| Class | Applied To | Description |
|-------|------------|-------------|
| `h-loading` | Indicator element | Added during request, removed after. |
| `h-disabled` | `<a>` elements | Added during mutation requests to indicate disabled state. |

### Styling Example

```css
.h-loading {
  opacity: 0.5;
  pointer-events: none;
}

a.h-disabled {
  pointer-events: none;
  opacity: 0.5;
  cursor: not-allowed;
}
```

---

## Request Headers

HelmJS automatically adds:

```
H-Request: true
H-Target: <selector>   (when h-target is specified)
```

| Header | Value | Description |
|--------|-------|-------------|
| `H-Request` | `true` | Always sent. Indicates this is a HelmJS request. |
| `H-Target` | CSS selector | Sent when `h-target` is specified. Contains the target selector value. |

Use these server-side to detect HelmJS requests and return appropriately scoped HTML fragments. The `H-Target` header allows the server to distinguish between requests targeting different elements and return the most relevant response.

### Custom Headers

```html
<a href="/api" h-get h-headers='{"X-Custom": "value"}'>Link</a>
```

---

## Response Headers (server-driven control)

This is the core of HelmJS's HATEOAS posture: **the server can dictate the
transition from its response**, so the requesting element does not have to
pre-encode layout/routing knowledge. These mirror htmx `HX-*` semantics under the
`H-` prefix.

| Header | Value | Effect |
|--------|-------|--------|
| `H-Retarget` | CSS selector | Swap into this element instead of the client's `h-target`. Also applies to 4xx/5xx responses (server-placed errors). If the selector matches nothing, falls back to the original target. |
| `H-Reswap` | swap strategy | Override the swap strategy for this response. **Validated** against the known strategies; an unknown value falls back to the element's `h-swap`. |
| `H-Reselect` | CSS selector | Extract this fragment from the response before swapping. If it matches nothing, the full response is swapped. |
| `H-Push-Url` | URL or `false` | Push this URL to history (server chooses the canonical URL). `false` suppresses an otherwise-configured push. |
| `H-Replace-Url` | URL or `false` | Replace the current history entry instead of pushing. |
| `H-Trigger` | name(s) or JSON | Fire client event(s) **on receive, before the swap** (htmx `HX-Trigger` parity). `"a,b"` fires two named events; `{"evt":{...}}` fires `evt` with `event.detail`. Names are **un-prefixed** (no `h:`), so you can trigger app events. |
| `H-Trigger-After-Swap` | name(s) or JSON | Same syntax as `H-Trigger`, but fired **after the swap is applied**, so handlers see the new DOM. Skipped when the response short-circuits via redirect/refresh/location. |
| `H-Redirect` | URL | Full client-side redirect via `location.href`. **Same-origin only** by default; see [security](#security-same-origin-navigation). |
| `H-Location` | URL | Client-side (AJAX) navigation: fetch the URL, swap `<body>`, push history. No full reload. **Same-origin only.** |
| `H-Refresh` | `true` | Reload the current page. |

`H-Refresh`, `H-Redirect`, `H-Location`, and `H-Trigger` are processed on **any**
status code. `H-Retarget`/`H-Reswap`/`H-Reselect`, `H-Trigger-After-Swap`, and the
URL headers apply to the swap (success path), and `H-Retarget`/`H-Reswap`
additionally redirect error placement.

### Error placement

For a 4xx/5xx response the order is:

1. If the server sent `H-Retarget`, the error is swapped into that element
   (with `H-Reswap` if provided, else `inner`).
2. Otherwise, if the page contains an element with the `[h-error]` attribute, the
   error is swapped into it (`inner`). This is a zero-config convention for a shared
   error region; no per-element wiring.
3. Either way, the `h:error` event fires (`detail` = `{ cfg, response, html }`), so
   you can handle errors in script regardless of placement.

```html
<!-- one conventional error region for the page -->
<div h-error role="alert"></div>
```

Successful (2xx) responses never swap into `[h-error]`.

### Security: same-origin navigation

Response-driven navigation is restricted to the current origin so a compromised or
malicious upstream response cannot turn HelmJS into an open redirect:

- **`H-Location`** must be same-origin. A cross-origin URL is ignored and an
  `h:error` event is emitted (`detail.error` explains why); nothing is fetched.
- **`H-Redirect`** is same-origin by default. Cross-origin redirects require an
  explicit, page-level opt-in: add `h-allow-cross-origin` to the `<html>` element:

  ```html
  <html h-allow-cross-origin> <!-- enables cross-origin H-Redirect for this page -->
  ```

  Without the opt-in, a cross-origin `H-Redirect` is ignored and emits `h:error`.

URLs are resolved against `location.href` before the origin comparison, so relative
URLs (`/login`, `../x`) always pass.

### H-Trigger timing

`H-Trigger` fires **before** the swap (matching htmx's `HX-Trigger`), so its handlers
observe the DOM *before* the response is applied. When a handler needs to act on the
newly inserted content (measure it, focus it, initialize a widget), use
`H-Trigger-After-Swap`, which fires immediately after the swap and the `h:swapped`
event. On a redirect/refresh/location short-circuit there is no swap, so
`H-Trigger-After-Swap` does not fire.

### Example: server places the response wherever it wants

```python
# Flask-style handler: the client used h-target="#form", but the server decides
# the validation error belongs in #form-errors and should not change the URL.
resp = make_response(render_template("errors.html"), 422)
resp.headers["H-Retarget"] = "#form-errors"
resp.headers["H-Reswap"]   = "inner"
return resp
```

```python
# After a successful create, send the user to the canonical resource URL and
# notify the rest of the page, all without any client-side routing.
resp = make_response(render_template("item.html"))
resp.headers["H-Push-Url"] = f"/items/{item.id}"
resp.headers["H-Trigger"]  = '{"item:created":{"id": %d}}' % item.id
return resp
```

---

## Progressive Enhancement (`h-boost`)

`h-boost` is the most HATEOAS-pure usage: the server emits plain hypermedia and the
client adds no API-specific attributes.

```html
<body h-boost>
  <nav><a href="/about">About</a></nav>
  <form action="/search" method="get"><input name="q"><button>Search</button></form>
</body>
```

Within an `h-boost` container:

- Plain `<a href>` and `<form action>` are upgraded to fetch + swap the `<body>`
  contents (`h-target` defaults to `body`, `h-swap` to `inner`, response `<body>`
  auto-extracted) and **push the URL** by default (GET).
- Boosted `<form>` derives its method from the native `method` attribute (GET/POST).
- Links the browser should handle natively are **not** boosted: `target` (e.g.
  `_blank`), `download`, in-page `#fragment` links, and cross-origin URLs.
- Any subtree can opt out with `h-boost="false"`.
- Explicit `h-*` attributes still win: you can boost a region but override
  `h-target`/`h-swap`/`h-push-url` on individual elements.

**Degradation:** with JavaScript disabled, every boosted element is just a normal
link/form, so the browser performs a full page load to the same destination.

---

## Graceful Degradation Contract

Every requesting element must resolve to a working **native** control with JS off:

| Control | No-JS requirement |
|---------|-------------------|
| `h-get` on `<a>` | real `href` (the native navigation) |
| `h-get` on `<form>` | real `action` (native GET submission) |
| `h-post` on `<form>` | real `action` **and** `method="post"` |
| `h-put`/`h-patch`/`h-delete` on `<form>` | real `action`; native forms only do GET/POST, so provide a server-side fallback (e.g. `method="post"` + `_method` override) |
| boosted `<a>`/`<form>` | already plain native controls |

HelmJS never strips `href`/`action`/`method`. A control whose URL is missing is
**not** hijacked; it remains a plain element. These guarantees are covered by the
automated tests in `test/helm.test.mjs` (the "degradation" group).

---

## History Management

### Push URL

```html
<a href="/page" h-get h-push-url>Navigate</a>
```

After successful swap, pushes the URL to browser history. Back/forward navigation will refetch and swap.

### Replace URL

```html
<a href="/page" h-get h-replace-url>Navigate</a>
```

Same as push, but replaces current history entry instead of adding new one.

### Behavior

- HelmJS stores state needed to restore the page on back/forward
- On popstate, refetches the URL and swaps into the original target
- Falls back to full page reload if target element no longer exists

### Page Title

When a response contains a `<title>` element, HelmJS automatically updates `document.title`. This happens before `h-select` processing, so the title is extracted from the full response.

The title is also stored in history state, ensuring back/forward navigation shows the correct title immediately.

---

## View Transitions

HelmJS automatically uses the View Transitions API when available:

```javascript
if (document.startViewTransition) {
  await document.startViewTransition(() => doSwap(...)).finished
}
```

Add CSS to define transitions:

```css
::view-transition-old(root),
::view-transition-new(root) {
  animation-duration: 200ms;
}
```

---

## Request Coordination

The `h-sync` attribute controls how concurrent requests from the same element are handled.

### Abort Mode

Cancel any in-flight request when a new one starts. Ideal for live search where only the latest results matter:

```html
<form action="/search" h-get h-target="#results"
      h-trigger="input debounce:300 from:#q, submit"
      h-sync="abort">
  <input id="q" name="q">
</form>
```

Without `h-sync="abort"`, fast typing could cause race conditions where an older, slower request overwrites newer results.

### Drop Mode

Ignore new requests while one is in-flight. Useful when you want to prevent duplicate requests entirely:

```html
<button h-get href="/action" h-sync="drop">
  Click me (ignores rapid clicks)
</button>
```

### Sync Modes

| Value | Behavior |
|-------|----------|
| `abort` | Abort in-flight request, start new one |
| `drop` | Drop new request if one is in-flight |

---

## Auto-Disable Behavior (`h-disable`)

### Mutation Requests

For POST, PUT, PATCH, DELETE requests, HelmJS automatically:

1. Disables all `<button>` and `<input type="submit">` in the form
2. Re-enables them after response (success or error)

This prevents double-submission. GET requests are not auto-disabled.

`<a>` elements receive the `h-disabled` class (and `aria-disabled`) instead of the
`disabled` attribute; style it via `a.h-disabled { pointer-events: none }`.

### Disable on GET, or disable an anchor

Add `h-disable` (no value) to disable the element itself on any method:

```html
<a href="/slow" h-get h-disable>Loads, disabled while in flight</a>
```

### Disable Additional Elements

A selector value disables the matched elements (and self) during the request:

```html
<form action="/submit" h-post h-disable="#other-button">
  <button>Submit</button>
</form>
<button id="other-button">Also disabled during request</button>
```

### Prevent Auto-Disable

```html
<form action="/submit" h-post h-disable="false">
  <button>Won't be disabled</button>
</form>
```

---

## Initialization

HelmJS initializes automatically:

1. On DOMContentLoaded, processes all elements in `document.body`
2. MutationObserver watches for dynamically added elements
3. New elements with HelmJS attributes are automatically initialized

### Manual Initialization

```javascript
// Process a specific element and its descendants
element.dispatchEvent(new CustomEvent('h:process', { bubbles: true }))
```

### Skip Processing

```html
<div h-ignore>
  <!-- Nothing in here will be processed by HelmJS -->
  <a href="/page" h-get>This won't work</a>
</div>
```
