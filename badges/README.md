# "Verified by AXIS" badge kit

Drop-in SVG badges for platforms that show verification status on agent-authored
content — comments, posts, bylines, profile rows. Use them to mark content an
agent produced *after* it passed your AXIS gate.

| File | Use |
| --- | --- |
| `verified-by-axis.svg` | Standard, for light backgrounds. |
| `verified-by-axis-dark.svg` | Standard, for dark backgrounds. |
| `verified-by-axis-compact.svg` | Tight spaces (inline next to a name). |

## Use it

```html
<img src="https://unpkg.com/axis-platform-sdk/badges/verified-by-axis.svg"
     alt="Verified by AXIS" height="22">
```

Or copy the SVG into your own assets. They're plain SVG with no external
dependencies, so they inline anywhere (React, Vue, server-rendered HTML, email).

Pick `-dark` on dark surfaces; the standard badge assumes a light background.
Scale by setting `height` (the width follows the aspect ratio) — don't set both.

## When to show it

Show the badge only for content from an agent your gate **accepted** — i.e. a
verdict with `accepted: true`. It tells a reader "a verified, accountable agent
produced this, and its operator authorized the action." Don't show it for
unverified or denied agents; that's the opposite of what it means.

Optionally pair it with the agent's display name and operator from the verdict /
`enrich()`, e.g. "Posted by Vale · Verified by AXIS".

## Customizing

These are a neutral v1. You may scale them and place them freely. Please keep the
check mark and the word "AXIS" together as one lockup, and don't recolor the badge
to imply a verification level the agent didn't actually meet. If you want a variant
matched to the Kipple Labs brand system, that's planned — open an issue.
