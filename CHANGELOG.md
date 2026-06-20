# Changelog

All notable changes to HelmJS are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) (pre-1.0: minor
versions may include breaking changes).

Entries for 0.1.0–0.6.0 are reconstructed from commit history and are approximate.

## [0.11.0] - 2026-06-19

### Added
- **Global busy state (`data-h-busy`).** While one or more HelmJS requests are in
  flight, HelmJS sets a boolean `data-h-busy` attribute on `<html>` and removes it
  when the last one settles, so a site-wide loader (progress bar, busy cursor, dimmed
  shell) is pure CSS with no per-element plumbing, even across boosted links inside
  user-generated content. It is reference-counted (toggled only on the `0`↔`1` edge,
  covering success, error, and abort), so overlapping requests never clear it early.
  Background work is quiet by default: background triggers (`every`, `load`,
  `intersect`) and `h-prefetch` fetches are excluded so polling and lazy-loading don't
  flash the loader. `h-busy` overrides per element: `h-busy="false"` keeps a foreground
  request out of the count, `h-busy="true"` opts a background one in. Document-level
  `h:busy` / `h:idle` events fire on the same edges for JS reactors. Purely additive:
  existing apps see no behavior change, and `h-indicator` / `.h-loading` are unaffected.

### Security
- **Prefetch is now same-origin only.** `h-prefetch` no longer speculatively fetches a
  cross-origin `href` on hover/focus/intersect (such a GET can't be read back under
  CORS anyway, but would still hit a third party with the `H-Request` headers before
  the user commits).
- **Request-setup affordances can't be stranded.** The in-flight UI side effects
  (`h-disable`, the `h-indicator` `.h-loading` class, and the `data-h-busy` counter)
  are now activated inside the request `try`, so a throw during setup (e.g. an invalid
  `h-optimistic-target` selector) reverts them via the `finally` instead of leaving
  controls disabled or the loader stuck.

## [0.10.0] - 2026-06-19

### Added
- **`h-optimistic` optimistic UI.** `h-optimistic="class:NAME"` toggles `NAME` on a
  local element the instant the request is triggered, so an action control reflects
  its new state without waiting a full round-trip. The element is resolved from
  `h-optimistic-target` (selector), else the resolved swap target, else the triggering
  element. The normal response swap reconciles the guess (server truth wins; if the
  optimistic element *is* the swap target, the swap replaces it outright), and an
  `h:error` reverts the class to its pre-toggle value. The class persists through a
  deferred swap (e.g. a sign-and-resubmit `before-swap` seam) until its continuation
  swaps or errors, so it never clears merely because a request finished without an
  immediate swap. Enhancement-only: the zero-JS baseline is unchanged. Only the
  `class:` op exists today; the value grammar is left open to extend.

## [0.9.0] - 2026-06-19

### Changed
- **View Transitions are now opt-in (BREAKING).** Previously every swap was wrapped
  in `document.startViewTransition` whenever the browser supported it. Because the
  API runs one transition at a time and cross-fades the whole viewport, rapid or
  concurrent partial swaps (infinite scroll, `intersect`/`load` lazy-loaders, polling,
  OOB) ghosted, and whole-page cross-fades are wrong for most partial updates. Swaps
  now apply **instantly by default**. Opt in per-swap with `h-swap="… transition"` or
  the `h-transition` attribute, or globally with `<html h-view-transitions>` (which
  restores the old behavior). The skipped-transition handling from 0.8.2 still applies
  to the opted-in path. `HConfig` gains a `transition` boolean a `before-request`
  listener can toggle.

## [0.8.2] - 2026-06-19

### Fixed
- **Skipped View Transitions no longer throw.** Only one View Transition runs at a
  time, so near-simultaneous swaps (multiple `intersect once` loaders, OOB, polling)
  skip each other's transitions, rejecting `ready`/`finished` with a benign "Skipped
  ViewTransition" `DOMException`. That awaited rejection surfaced as an uncaught
  promise rejection, filling the console. HelmJS now awaits `updateCallbackDone`
  (the swap still applies) and swallows the skip rejection, while a genuine error in
  the swap callback still propagates as `h:error`.

## [0.8.1] - 2026-06-19

### Added
- **`h-trigger="load"` fires once on init** (lazy hydration), instead of silently
  doing nothing on elements that never emit a native DOM `load` event. Fires as soon
  as the element is wired into the DOM (including swapped-in markup), regardless of
  visibility; an optional `delay:<n>` staggers it. On an `<img>` it fires on init,
  not on the image's network load (htmx parity).

## [0.8.0] - 2026-06-19

### Added
- **Submit-button overrides.** When a form is submitted via a specific button, that
  button overrides the form's request config: native `formaction`/`formmethod`, and
  `h-get`/`h-post`/`h-put`/`h-patch`/`h-delete`/`h-target`/`h-swap`/`h-select`/`h-headers`,
  each falling back to the form's value when the button doesn't set it.
- **`h-insert` text insertion.** A click action that splices `h-insert`'s text into
  the `h-insert-target` input/textarea at the live caret, optionally replacing a
  caret-anchored token (`h-insert-replace` regex), then refocuses and fires a
  bubbling `input`. The one swap-less primitive (caret editing isn't a DOM swap).
- **`h-selection` caret headers.** Opt in to sending a field's caret as
  `H-Selection-Start`/`H-Selection-End` request headers so the server can detect the
  active token exactly when editing mid-text.
- **`h-combobox` keyboard navigation.** Arrow/Enter/Escape navigation of a
  `[role=option]` suggestion dropdown; the highlighted item carries the `h-active`
  class and ARIA state. Active state lives in the DOM, so it survives the server
  re-rendering the list, and a server-rendered `h-active` option makes Enter pick it.
- **Re-enterable `h:before-swap` seam.** A canceling listener can call
  `detail.swap(html, response?, url?)` to do async work and feed content back through
  the normal swap pipeline; hardened with a double-swap guard and a URL override.
- **Reproducible build artifacts.** A committed `dist/helm.js.gz` (gzip `-9 -n`, no
  embedded timestamp) plus a pre-commit hook that blocks commits when `dist/` is stale
  relative to `src/`.

### Changed
- **Boosted-GET auto-push is now scoped to real navigations** (default trigger +
  whole-`body` target). In-place/background GETs (pollers, lazy hydration,
  infinite-scroll sentinels, sub-region updates) no longer rewrite the address bar;
  `h-push-url` is the explicit override in both directions.
- **Polling folded into `h-trigger="every Ns"`** and the `h-get` URL source
  generalized so any element can drive a request from its own `h-get` value. Polling
  now defaults to `h-sync="abort"`.
- **Intersection modifier renamed `rootMargin` → `root-margin`** for consistency with
  every other kebab-case modifier.
- **Event renames:** `h:before` → `h:before-request`, `h:after` → `h:before-swap`,
  `h:inited` → `h:ready`.

### Fixed
- An unknown `h-swap` value now falls back to `inner` instead of silently performing
  no swap.

## [0.7.0] - 2026-06-18

### Added
- Server-driven response headers (`H-Retarget`, `H-Reswap`, `H-Reselect`,
  `H-Push-Url`, `H-Replace-Url`, `H-Trigger`, `H-Redirect`, `H-Location`, `H-Refresh`).
- `h-boost` progressive enhancement of plain `<a href>`/`<form action>`.
- Same-origin hardening for response-driven navigation (cross-origin opt-in via
  `h-allow-cross-origin`).
- `[h-error]` convention for placing error responses; `h-disable` for request-time
  disabling.
- A jsdom-based automated test suite.

### Changed
- Default swap is now `inner`.
- API slim-down: removed the OOB `value`/`replace`/`merge` input-manipulation
  strategies (OOB is for DOM updates).
- Collapsed the disable attributes into a single `h-disable`.

## [0.6.0] - 2025-12-20

### Added
- `h-include` to pull additional fields into a request.

### Changed
- Expanded swap and out-of-band handling.

## [0.5.0] - 2025-12-19

### Added
- `h-prefetch`: prefetch on hover/focus/intersect.

## [0.4.1] - 2025-12-15

### Added
- `<title>` handling in out-of-band updates.

## [0.4.0] - 2025-12-12

### Added
- `h-focus` to focus an element after a swap.

### Changed
- Improved type safety.

## [0.3.1] - 2025-12-12

### Fixed
- Send `H-Target` request headers.

## [0.3.0] - 2025-12-11

### Added
- Live-query features (polling).

## [0.2.0] - 2025-12-11

### Added
- Additional API functionality over the initial release.

## [0.1.0] - 2025-12-11

- Initial release: `h-get`/`h-post`/`h-put`/`h-patch`/`h-delete`, `h-target`,
  `h-swap`, `h-trigger`.
