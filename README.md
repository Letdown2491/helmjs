# HelmJS

**The smallest hypermedia library where the server, not the client, drives every
state transition, and it all degrades to plain HTML.**

~5.5KB gzipped · zero dependencies · TypeScript.

```html
<script src="https://unpkg.com/helmjs"></script>
```

```bash
npm install helmjs
```

## Quick Start

```html
<!-- Links fetch data -->
<a href="/api/greeting" h-get h-target="#output">Say Hello</a>
<div id="output"></div>

<!-- Forms submit data -->
<form action="/api/subscribe" h-post>
  <input name="email" type="email" required>
  <button>Subscribe</button>
</form>

<!-- Live search -->
<form action="/search" h-get h-target="#results"
      h-trigger="input debounce:300 from:#q, submit"
      h-sync="abort">
  <input id="q" name="q" placeholder="Search...">
  <button>Search</button>
</form>
<div id="results"></div>
```

The server sends HTML, HelmJS swaps it in. That's it.

## Philosophy

- **`h-get`** works on `<a>` (URL from href), `<form>` (URL from action, data as query params), and any other element (URL from `h-get`'s value)
- **`h-post/put/patch/delete`** work on a `<form>` (URL from action, fields as the body) or on any bare element like a `<button>` (URL from the `h-{method}` value, no body: data rides the query string)
- Server is the source of truth - no client-side routing or state management

## HATEOAS posture

HelmJS treats the **server as the engine of application state**. The client never
invents URLs and holds no routing or application state of its own; it transitions
state only through hypermedia controls (links/forms) the server sends back as HTML.
In short:

- **The server can drive every transition from the response** via `H-*` headers
  (retarget, reswap, reselect, push/replace URL, trigger events, redirect, refresh).
  The requesting element doesn't have to pre-encode layout knowledge.
- **`h-boost`** upgrades plain server-rendered `<a>`/`<form>` to partial-swap +
  push-url navigation with *no helmjs attributes in the HTML at all*.
- **Self-descriptive responses** are preferred: a returned fragment can declare its
  own placement (`h-oob`, or `H-Retarget`/`H-Reswap`); `h-target` is the fallback.
- **Graceful degradation is a contract** (see below): with JS off, everything still
  works as native full-page navigation/submission.

### Server-driven control (response headers)

The server can override client behavior from any response. Mirrors htmx `HX-*`
semantics under the `H-` prefix.

| Header | Effect |
|--------|--------|
| `H-Retarget: <selector>` | Swap into a different element than the client's `h-target`. Also accepts trigger-relative keywords `this` / `closest <sel>` / `find <sel>`, resolved against the requesting element (so a shared control can retarget its own row with no `id`). A plain-selector miss falls back to the original target; a relative miss skips the swap. |
| `H-Reswap: <strategy>` | Override the swap strategy (`inner`, `outer`, `append`, …). Validated; an unknown value falls back to the element's `h-swap`. |
| `H-Reselect: <selector>` | Choose which fragment of the response to extract. If it matches nothing, the full response is swapped. |
| `H-Push-Url: <url \| false>` | Push (or suppress) a history URL; the server picks the canonical URL. |
| `H-Replace-Url: <url \| false>` | Replace the current history entry. |
| `H-Trigger: <name \| JSON>` | Fire client event(s) **on receive, before the swap** (htmx parity). `"a,b"` or `{"evt":{...detail}}`. |
| `H-Trigger-After-Swap: <name \| JSON>` | Fire client event(s) **after the swap is applied** (handlers see the new DOM). Skipped on redirect/refresh. |
| `H-Redirect: <url>` | Full client-side redirect (`location.href`). **Same-origin only** unless opted in (see below). |
| `H-Location: <url>` | Client-side (AJAX) navigation: fetch + swap `<body>` + push URL. **Same-origin only.** |
| `H-Refresh: true` | Reload the page. |

`H-Retarget`/`H-Reswap` also apply to 4xx/5xx responses, so the server can place
errors. With no `H-Retarget`, an error response is swapped into a conventional
`[h-error]` region if the page has one; either way `h:error` fires.

**Security: response-driven navigation is same-origin by default.** `H-Location`
always requires a same-origin URL (a cross-origin value is ignored and emits
`h:error`). `H-Redirect` is same-origin by default; cross-origin redirects are an
open-redirect risk, so they require an explicit page-level opt-in:
`<html h-allow-cross-origin>`. URLs are resolved against `location.href` before the
origin check, so relative URLs always work.

**Security: HelmJS trusts your server's HTML, so never let untrusted HTML reach the
DOM unescaped.** Swaps use `innerHTML`/`outerHTML`, so a response containing
`<img src=x onerror=…>` executes, exactly as with htmx. More subtly, HelmJS
auto-initializes every `h-*` attribute in any inserted subtree, **including
user-generated content**: a stored comment like
`<button h-post="/account/close" h-trigger="load">` would fire a same-origin,
cookie-bearing request the moment it renders, turning HTML injection into automatic
CSRF. Escape user content on the server (the usual XSS defense), and additionally
wrap any region that renders raw user HTML in `[h-ignore]` so HelmJS skips it:

```html
<div h-ignore><!-- user-authored markdown/HTML: no h-* attribute here is activated --></div>
```

**H-Trigger timing.** `H-Trigger` fires *before* the swap (matching htmx's
`HX-Trigger`), so its handlers observe the pre-swap DOM. Use
`H-Trigger-After-Swap` when a handler needs to see the newly inserted content.

### Progressive enhancement with `h-boost`

```html
<body h-boost>
  <!-- plain hypermedia, no helmjs attributes needed -->
  <nav><a href="/about">About</a> <a href="/contact">Contact</a></nav>
  <form action="/search" method="get"><input name="q"><button>Search</button></form>
</body>
```

Inside an `h-boost` container, plain `<a href>` and `<form action>` are upgraded to
fetch + swap the `<body>` contents and push the URL. Links that should stay native
(`target`, `download`, `#fragment`, cross-origin) are left alone, and any element can
opt out with `h-boost="false"`. With JavaScript disabled, every one of these is just
a normal link/form, and the browser does a full page load to the same destination.

### Graceful degradation contract

Every requesting element must resolve to a **working native control** when JS is off:

- `h-get` on `<a>` requires a real `href`; that's the no-JS navigation.
- `h-post`/`put`/`patch`/`delete` on `<form>` require a real `action` **and** an
  explicit `method` (`get`/`post`); that's the no-JS submission. (HTML forms only
  support GET/POST natively; PUT/PATCH/DELETE still need a server-side fallback.)
- `h-post`/`put`/`patch`/`delete` on a bare element (e.g. `<button>`) take the URL
  from the `h-{method}` value and send no body, so they're JS-only enhancements
  (a form-less star toggle or Undo button) with no native no-JS equivalent.
- HelmJS never strips `href`/`action`/`method`, and a control without a usable
  URL is never hijacked (it stays a plain element).

## Features

| Feature | Example |
|---------|---------|
| AJAX requests | `<a href="/page" h-get>`, `<form action="/search" h-get>` |
| Form submission | `<form action="/api" h-post>` |
| Target element | `h-target="#content"` |
| Swap strategies | `h-swap="inner"` (default), `outer`, `append`, `morph`, etc. |
| Multiple triggers | `h-trigger="input debounce:300, submit"` |
| Cross-element events | `h-trigger="input from:#search-box"` |
| Request coordination | `h-sync="abort"` (cancel stale), `h-sync="drop"` (ignore new) |
| Infinite scroll | `h-trigger="intersect once"` |
| Lazy hydration | `h-trigger="load"` (fetch a region as soon as it's in the DOM) |
| Polling | `h-trigger="every 5s"` (add `visible` to pause while the tab is hidden) |
| Server-Sent Events | `h-sse="/events"` |
| Typeahead insert | `h-insert` + `h-insert-target` (e.g. @-mention / :emoji pickers) |
| Combobox keys | `h-combobox` (Arrow/Enter/Escape navigation of a suggestion dropdown) |
| Dropdown dismiss | `h-dismiss` on a `<details>` (close on outside click / Escape) |
| Multi-element updates | `h-oob="true"` |
| Server-driven control | `H-Retarget`, `H-Reswap`, `H-Push-Url`, `H-Redirect`, … (response headers) |
| Progressive enhancement | `<body h-boost>` upgrades plain `<a>`/`<form>` |
| Scroll control | `h-scroll="top"`, `h-scroll="top instant"` |
| Focus control | `h-focus="#input"` |
| Form reset | `h-reset` (clear the originating form after a successful swap) |
| History | `h-push-url` |

## Example: Live Search

```html
<form action="/search" h-get h-target="#results"
      h-trigger="input debounce:300 from:#q, submit"
      h-sync="abort">
  <input id="q" name="q" placeholder="Search...">
  <button>Search</button>
</form>
<div id="results"></div>
```

This form:
- Makes GET requests with query params serialized from form data
- Triggers on debounced input from `#q` OR form submit
- Aborts in-flight requests when new ones start (prevents race conditions)

## Example: Infinite Scroll

```html
<div id="posts">
  <a href="/posts?page=2" h-get h-trigger="intersect once" h-target="#posts" h-swap="append">
    Loading more...
  </a>
</div>
```

## Events

```javascript
document.addEventListener('h:before-request', (e) => {
  e.detail.cfg.headers['X-Custom'] = 'value'
})
```

Events: `h:init`, `h:ready`, `h:before-request`, `h:before-swap`, `h:swapped`, `h:error`, `h:sse-message`

A `h:before-swap` listener can `preventDefault()`, do async work, then call
`e.detail.swap(html, response?)` to re-enter the normal swap pipeline with
replacement content (placement headers, OOB, view transitions, history, and
`h:swapped` all still run). See [Deferred / async swaps](API.md#deferred--async-swaps).

## Intentional deviations

Some attributes are deliberately *not* server-driven, because they configure
client-side interaction/UX rather than application-state transitions, and have no
sensible HATEOAS equivalent:

- **`h-trigger`** (when to fire), **`h-sync`** (abort/drop coordination),
  **`h-confirm`**, **`h-indicator`**, **`h-busy`**, **`h-disable`**, **`h-scroll`**, **`h-focus`**, **`h-reset`**, **`h-dismiss`**:
  these describe browser behavior *around* a transition, not the transition itself.
  Encoding them in the response would add weight without making the system more RESTful.
- **Polling (`h-trigger="every Ns"`)** and **`h-sse`** are real-time transports with
  no native HTML equivalent; they can't degrade with JS off. They stay
  hypermedia-faithful in that their *responses* are HTML and flow through the normal
  pipeline (target/swap/select, server `H-*` headers, OOB, events). Polling a
  non-degradable region (e.g. a `<div h-get="…">`) is the one place a URL lives in an
  attribute rather than `href`/`action`.

### Compliance summary

Measured against REST's hypermedia constraints, HelmJS is compliant on the parts a
client library controls, and the remaining gaps are inherent HTML limits rather than
design choices:

- **Hypermedia as the engine of state, statelessness, self-descriptive messages,
  uniform interface** are compliant. URLs come only from server-rendered `href`/`action`;
  the server can override every transition from the response (`H-*` headers); no
  client-side routing or application state; back/forward re-fetches from the server;
  responses are HTML, and controls in swapped-in fragments auto-activate.
- **Graceful degradation**: compliant for `h-get`, GET/POST forms, and `h-boost`.
  The only non-degrading features are ones with no JS-off equivalent in HTML:
  `h-put`/`h-patch`/`h-delete` (forms submit only GET/POST natively, so use a server
  `_method` override for a native fallback), non-`click`/`submit` `h-trigger` events
  (including `every`), cross-form `h-include`, `h-sse`, and any method attribute
  (`h-get`/`h-post`/`h-put`/`h-patch`/`h-delete`) on a non-anchor/form element (which
  carries its URL in an attribute and has no native control to degrade to).

## Size

~5.5KB gzipped, zero runtime dependencies. The bulk buys the full server-driven
control surface: the response headers above, which are what make the **server** the
engine of state transitions rather than the client, plus `h-boost`, morph, prefetch,
and the same-origin security hardening on response-driven navigation. The header
surface is a compact dispatch (a handful of `res.headers.get` reads guarded by early
returns; one shared `sameOrigin` helper and one swap-strategy regex), with no
per-feature framework. Absent any `H-*` header, behavior is unchanged.

The default swap is `inner` (predictable and small); `morph` is opt-in via
`h-swap="morph"`. We ship a single batteries-included build: at ~5KB the savings
from carving optional features out into a second build weren't worth the added
complexity for users or maintainers.

## Documentation

See [API.md](API.md) for complete reference.

## Browser Support

Modern browsers only (Chrome, Firefox, Safari, Edge).
