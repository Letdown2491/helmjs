# CLAUDE.md

Guidance for Claude Code when working with this repository.

## Build Commands

```bash
npm run build      # Production build (minified, with .d.ts types)
npm run dev        # Development build (with sourcemaps)
npm run watch      # Watch mode for development
npm run size       # Check bundle size (raw + gzipped)
npm run typecheck  # Type check without emitting
```

## Philosophy

**Target Audience:** Developers building HATEOAS-compliant web applications who want simple HTML-driven enhancements without learning complex JavaScript frameworks.

### Core Principles

1. **Server is the source of truth** - No client-side state management, routing, or URL generation
2. **Semantic HTML required** - `<a href>` for navigation, `<form action>` for submissions
3. **Strict HATEOAS compliance** - Client never invents URLs
4. **Minimal footprint** - ~3.4KB gzipped, no dependencies
5. **Intuitive defaults** - Zero config for common cases

### Opinionated Decisions

- `h-get` works on `<a>` (URL from `href`) and `<form>` (URL from `action`, data as query params)
- `h-post/put/patch/delete` only work on `<form>` elements (URL from `action`)
- Default swap is `morph` (preserves form state)
- Mutations auto-disable to prevent double-submit

## Architecture

```
src/index.ts    # All library code (~400 lines)
dist/helm.js    # Bundled ESM output
dist/index.d.ts # TypeScript declarations
test/index.html # Manual test page
API.md          # Complete API reference
```

## Quick Reference

### Attributes

| Attribute | Elements | Description |
|-----------|----------|-------------|
| `h-get` | `<a>`, `<form>` | GET request, URL from `href`/`action` |
| `h-post/put/patch/delete` | `<form>` | Mutation requests, URL from `action` |
| `h-target` | any | CSS selector for swap destination |
| `h-swap` | any | `morph` (default), `inner`, `outer`, `before`, `after`, `prepend`, `append`, `none` |
| `h-trigger` | any | Event + modifiers: `click`, `submit`, `input debounce:300 from:#el`, `intersect once`. Comma-separated for multiple. |
| `h-sync` | any | Request coordination: `abort` (cancel in-flight), `drop` (ignore if in-flight) |
| `h-select` | any | Extract fragment from response |
| `h-scroll` | any | `top`, `bottom`, `target`, or CSS selector |
| `h-oob` | response | Out-of-band swap by element ID |
| `h-poll` | any | URL + interval: `/api/data 30s` |
| `h-sse` | any | SSE endpoint URL |
| `h-error-target` | any | Target for 4xx/5xx responses |
| `h-confirm` | any | Confirmation dialog |
| `h-indicator` | any | Element for `h-loading` class |
| `h-push-url` | any | Push to browser history |
| `h-ignore` | any | Skip processing |

### Events

`h:init`, `h:inited`, `h:before`, `h:after`, `h:swapped`, `h:error`, `h:poll-start`, `h:poll`, `h:sse-connect`, `h:sse-message`, `h:sse-error`, `h:process`

### CSS Classes

- `h-loading` - Added to indicator during request
- `h-disabled` - Added to `<a>` elements during mutations

## Full Documentation

See [API.md](API.md) for complete API reference with examples.
