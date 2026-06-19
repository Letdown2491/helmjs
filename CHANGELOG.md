# Changelog

All notable changes to HelmJS are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) (pre-1.0: minor
versions may include breaking changes).

Entries for 0.1.0–0.6.0 are reconstructed from commit history and are approximate.

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
