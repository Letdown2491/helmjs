# HelmJS

A minimal hypermedia library for HTML-first web applications. **3.3KB gzipped.**

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

<!-- Forms mutate data -->
<form action="/api/subscribe" h-post>
  <input name="email" type="email" required>
  <button>Subscribe</button>
</form>
```

The server sends HTML, HelmJS swaps it in. That's it.

## Philosophy

- **`h-get`** only works on `<a>` elements - links fetch data
- **`h-post/put/patch/delete`** only work on `<form>` elements - forms mutate data
- Server is the source of truth - no client-side routing or state management

## Features

| Feature | Example |
|---------|---------|
| AJAX requests | `<a href="/page" h-get>` |
| Form submission | `<form action="/api" h-post>` |
| Target element | `h-target="#content"` |
| Swap strategies | `h-swap="append"` |
| Debounce/throttle | `h-trigger="input debounce:300"` |
| Infinite scroll | `h-trigger="intersect once"` |
| Polling | `h-poll="/api/status 5s"` |
| Server-Sent Events | `h-sse="/events"` |
| Multi-element updates | `h-oob="true"` |
| Scroll control | `h-scroll="top"` |
| History | `h-push-url` |

## Example

```html
<!-- Infinite scroll -->
<div id="posts">
  <a href="/posts?page=2" h-get h-trigger="intersect once" h-target="#posts" h-swap="append">
    Loading more...
  </a>
</div>

<!-- Search with debounce -->
<form action="/search" h-get h-target="#results" h-trigger="input debounce:300">
  <input type="search" name="q">
</form>
<div id="results"></div>
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
