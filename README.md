# HelmJS

A minimal hypermedia library for HTML-first web applications. **~3.4KB gzipped.**

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

- **`h-get`** works on `<a>` (URL from href) and `<form>` (URL from action, data as query params)
- **`h-post/put/patch/delete`** only work on `<form>` elements
- Server is the source of truth - no client-side routing or state management

## Features

| Feature | Example |
|---------|---------|
| AJAX requests | `<a href="/page" h-get>`, `<form action="/search" h-get>` |
| Form submission | `<form action="/api" h-post>` |
| Target element | `h-target="#content"` |
| Swap strategies | `h-swap="morph"` (default), `inner`, `outer`, `append`, etc. |
| Multiple triggers | `h-trigger="input debounce:300, submit"` |
| Cross-element events | `h-trigger="input from:#search-box"` |
| Request coordination | `h-sync="abort"` (cancel stale), `h-sync="drop"` (ignore new) |
| Infinite scroll | `h-trigger="intersect once"` |
| Polling | `h-poll="/api/status 5s"` |
| Server-Sent Events | `h-sse="/events"` |
| Multi-element updates | `h-oob="true"` |
| Scroll control | `h-scroll="top"` |
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
document.addEventListener('h:before', (e) => {
  e.detail.cfg.headers['X-Custom'] = 'value'
})
```

Events: `h:init`, `h:before`, `h:after`, `h:swapped`, `h:error`, `h:poll`, `h:sse-message`

## Documentation

See [API.md](API.md) for complete reference.

## Browser Support

Modern browsers only (Chrome, Firefox, Safari, Edge).
