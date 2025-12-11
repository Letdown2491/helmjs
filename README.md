# ⚓ HelmJS

A minimal hypermedia library for HTML-first web applications.

```html
<script src="https://unpkg.com/helmjs"></script>
```

```bash
npm install helmjs
```

## Quick Start

```html
<!-- Click link, fetch content, morph it into #output -->
<a href="/api/greeting" h-get h-target="#output">Say Hello</a>
<div id="output"></div>

<!-- Submit form, POST data, morph response into form -->
<form action="/api/subscribe" h-post>
  <input name="email" type="email" required>
  <button>Subscribe</button>
</form>
```

When the link is clicked, HelmJS issues a `GET` to `/api/greeting` and morphs the response into `#output`. When the form submits, it `POST`s to `/api/subscribe` and morphs the response into itself.

That's it. The server sends HTML, HelmJS puts it in the DOM.

## Philosophy

HelmJS enforces semantic HTML:

- **`h-get`** only works on `<a>` elements — links fetch data
- **`h-post/put/patch/delete`** only work on `<form>` elements — forms mutate data

The server is the source of truth. No client-side routing, no state management, no URL generation. Your server sends HTML, HelmJS swaps it in.

## Attributes

| Attribute | Description |
|-----------|-------------|
| `h-get` | GET request (`<a>` only, uses `href`) |
| `h-post` `h-put` `h-patch` `h-delete` | Mutation requests (`<form>` only, uses `action`) |
| `h-target` | CSS selector for swap destination (default: self) |
| `h-swap` | Swap strategy (default: `morph`) |
| `h-trigger` | Event + modifiers: `click`, `submit`, `input debounce:300` |
| `h-select` | Extract fragment from response via CSS selector |
| `h-confirm` | Show confirmation dialog before request |
| `h-indicator` | Selector for element to receive `h-loading` class |
| `h-push-url` | Push URL to browser history |
| `h-sse` | Connect to Server-Sent Events endpoint |

## Swap Strategies

| Strategy | Description |
|----------|-------------|
| `morph` | Smart DOM diffing, preserves focus & input values *(default)* |
| `inner` | Replace innerHTML |
| `outer` | Replace entire element |
| `before` / `after` | Insert adjacent to target |
| `prepend` / `append` | Insert inside target |
| `none` | Don't swap (side-effects only) |

## Examples

**Search with debounce**
```html
<input type="search" h-get href="/search" h-target="#results" h-trigger="input debounce:300">
<div id="results"></div>
```

**Delete with confirmation**
```html
<form action="/items/123" h-delete h-confirm="Delete this item?" h-swap="outer">
  <button>Delete</button>
</form>
```

**Infinite scroll**
```html
<a href="/items?page=2" h-get h-target="#list" h-swap="append" h-trigger="click once">
  Load More
</a>
```

**Live updates via SSE**
```html
<div h-sse="/events" h-target="#feed" h-swap="prepend"></div>
<div id="feed"></div>
```

## Events

Listen for lifecycle events to customize behavior:

```javascript
// Modify request before sending
document.addEventListener('h:before', (e) => {
  e.detail.cfg.headers['X-Custom'] = 'value'
})

// Cancel with e.preventDefault()
// Available: h:init, h:before, h:after, h:swapped, h:error
```

## Browser Support

Modern browsers only (Chrome, Firefox, Safari, Edge).
