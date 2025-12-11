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
- [Polling](#polling)
- [Server-Sent Events](#server-sent-events)
- [Events](#events)
- [CSS Classes](#css-classes)
- [Request Headers](#request-headers)
- [History Management](#history-management)
- [View Transitions](#view-transitions)

---

## Philosophy

HelmJS is built for developers creating HATEOAS-compliant web applications who want simple HTML-driven enhancements without complex JavaScript frameworks.

### Core Principles

1. **Server is the source of truth** - The server controls application state and sends complete HTML. No client-side state management, routing, or URL generation.

2. **Semantic HTML required** - Use proper HTML elements. `<a href>` for navigation, `<form action>` for submissions. Applications must work without JavaScript.

3. **Strict HATEOAS compliance** - The client never invents URLs. All actions come from server-provided hypermedia controls.

4. **Minimal footprint** - Every byte must be justified. No dependencies, no dev-only code. Currently ~3.2KB gzipped.

5. **Intuitive defaults** - Zero config for common cases. Opinionated defaults enforce good hypermedia practices.

### Semantic Constraints

| Attribute | Allowed Elements | URL Source |
|-----------|------------------|------------|
| `h-get` | `<a>` only | `href` attribute |
| `h-post` | `<form>` only | `action` attribute |
| `h-put` | `<form>` only | `action` attribute |
| `h-patch` | `<form>` only | `action` attribute |
| `h-delete` | `<form>` only | `action` attribute |

These constraints are intentional. Links fetch data, forms mutate data.

---

## Build Commands

```bash
npm run build      # Production build (minified, with .d.ts types)
npm run dev        # Development build (with sourcemaps)
npm run watch      # Watch mode for development
npm run size       # Check bundle size (raw + gzipped)
npm run typecheck  # Type check without emitting
```

---

## Architecture

```
src/
  index.ts    # Main entry point, all library code
dist/
  helm.js     # Bundled output (ESM, minified)
  index.d.ts  # TypeScript declarations
test/
  index.html  # Manual test page
```

- **Build**: esbuild bundles TypeScript to a single minified ESM file
- **Types**: tsc generates declaration files only
- **Target**: ES2022, modern browsers only

---

## Attributes Reference

### Request Attributes

| Attribute | Elements | Description |
|-----------|----------|-------------|
| `h-get` | `<a>` | AJAX GET request. URL from `href` attribute. |
| `h-post` | `<form>` | AJAX POST request. URL from `action` attribute. |
| `h-put` | `<form>` | AJAX PUT request. URL from `action` attribute. |
| `h-patch` | `<form>` | AJAX PATCH request. URL from `action` attribute. |
| `h-delete` | `<form>` | AJAX DELETE request. URL from `action` attribute. |

### Response Handling

| Attribute | Elements | Description |
|-----------|----------|-------------|
| `h-target` | any | CSS selector for response destination. Default: the triggering element. |
| `h-swap` | any | How to insert the response. Default: `morph`. |
| `h-select` | any | CSS selector to extract a fragment from the response before swapping. |
| `h-error-target` | any | CSS selector for where to swap 4xx/5xx error responses. |
| `h-scroll` | any | Scroll behavior after swap: `top`, `bottom`, `target`, or a CSS selector. |

### Behavior Modifiers

| Attribute | Elements | Description |
|-----------|----------|-------------|
| `h-trigger` | any | Event that triggers the request. Default: `submit` for forms, `click` for links. |
| `h-confirm` | any | Show a confirmation dialog with this message before sending the request. |
| `h-indicator` | any | CSS selector for element(s) to receive `h-loading` class during request. |
| `h-headers` | any | JSON object of custom headers to include in the request. |
| `h-disabled` | any | CSS selector for additional elements to disable during request. |
| `h-no-disable` | any | Prevent automatic disabling of form buttons during mutation requests. |
| `h-ignore` | any | Skip HelmJS processing for this element and all descendants. |

### History

| Attribute | Elements | Description |
|-----------|----------|-------------|
| `h-push-url` | any | Push the request URL to browser history after successful swap. |
| `h-replace-url` | any | Replace current URL in browser history after successful swap. |

### Real-time Updates

| Attribute | Elements | Description |
|-----------|----------|-------------|
| `h-poll` | any | URL to poll, with optional interval: `/api/data 30s`. Default interval: 30s. |
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
| `morph` | **Default.** Smart DOM diffing that preserves focus, input values, and scroll position. |
| `inner` | Replace the target's innerHTML. |
| `outer` | Replace the entire target element (outerHTML). |
| `before` | Insert before the target element. |
| `after` | Insert after the target element. |
| `prepend` | Insert at the beginning of the target's children. |
| `append` | Insert at the end of the target's children. |
| `none` | Don't swap. Useful for side-effect-only requests. |

### Morph Algorithm

The `morph` strategy performs intelligent DOM diffing:

1. Matches elements by `id` attribute first
2. Falls back to position + tag name matching
3. Preserves `<input>` values and checked states
4. Preserves `<textarea>` content
5. Updates attributes that changed
6. Recursively morphs children

This preserves user input and focus during updates.

---

## Trigger System

The `h-trigger` attribute specifies when to send the request.

### Basic Triggers

```html
<a href="/page" h-get h-trigger="click">Click me</a>
<form action="/search" h-get h-trigger="submit">...</form>
<input h-get href="/search" h-trigger="input">
```

Default triggers:
- `<form>` elements: `submit`
- `<a>` elements: `click`

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

| Value | Behavior |
|-------|----------|
| `true` | Outer swap (replace entire element) |
| `inner` | Replace innerHTML only |
| `outer` | Replace entire element |
| `prepend` | Insert at beginning |
| `append` | Insert at end |

The target element is determined by the OOB element's `id` attribute.

---

## Polling

Automatically refresh content at regular intervals.

### Basic Usage

```html
<div h-poll="/api/status 10s">Loading...</div>
```

### Syntax

```
h-poll="URL [interval]"
```

- **URL**: Required. The endpoint to poll.
- **interval**: Optional. Default: `30s`. Supports: `ms`, `s`, `m`.

### Examples

```html
<div h-poll="/api/notifications">...</div>           <!-- 30s default -->
<div h-poll="/api/status 5s">...</div>               <!-- 5 seconds -->
<div h-poll="/api/updates 500ms">...</div>           <!-- 500 milliseconds -->
<div h-poll="/api/daily 1m">...</div>                <!-- 1 minute -->
```

### Behavior

- Polling starts immediately when element is processed
- Stops automatically when element is removed from DOM
- Uses `h-target` and `h-swap` attributes (defaults: self, inner)
- Supports OOB updates in poll responses
- Emits `h:poll-start` and `h:poll` events

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
| `h:inited` | No | `{}` | After element initialization complete. |
| `h:before` | Yes | `{ cfg }` | Before request sent. Modify `cfg` to change request. |
| `h:after` | Yes | `{ cfg, response, html }` | After response, before swap. Cancel to skip swap. |
| `h:swapped` | No | `{ cfg }` | After DOM update complete. |
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
document.addEventListener('h:before', (e) => {
  e.detail.cfg.headers['Authorization'] = 'Bearer ' + token
})

// Focus input after swap
document.addEventListener('h:swapped', () => {
  document.querySelector('input[autofocus]')?.focus()
})

// Log errors
document.addEventListener('h:error', (e) => {
  console.error('Request failed:', e.detail)
})

// Prevent specific request
element.addEventListener('h:before', (e) => {
  if (someCondition) e.preventDefault()
})
```

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
```

Use this server-side to detect HelmJS requests and return partial HTML instead of full pages.

### Custom Headers

```html
<a href="/api" h-get h-headers='{"X-Custom": "value"}'>Link</a>
```

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

## Auto-Disable Behavior

### Mutation Requests

For POST, PUT, PATCH, DELETE requests, HelmJS automatically:

1. Disables all `<button>` and `<input type="submit">` in the form
2. Re-enables them after response (success or error)

This prevents double-submission.

### Disable Additional Elements

```html
<form action="/submit" h-post h-disabled="#other-button">
  <button>Submit</button>
</form>
<button id="other-button">Also disabled during request</button>
```

### Prevent Auto-Disable

```html
<form action="/submit" h-post h-no-disable>
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
