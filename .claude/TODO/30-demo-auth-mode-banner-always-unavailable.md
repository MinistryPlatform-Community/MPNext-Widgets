# 30. Every demo page's auth-mode banner reports "config unavailable"

**Depends on:** nothing.
**Risk:** none in production — the Vite demo pages only. It misleads local
verification: the banner says `legacy` while the widget is in `dual`.
**Size:** ~15 minutes.

> Found while browser-testing item 29 on 2026-09-07. **Pre-existing** and
> unrelated to that fix.

## The problem

`packages/embed-sdk/demo-user-menu.html` resolves the widget auth mode for its
status banner:

```js
const apiHost = "__API_HOST__";
const res = await fetch(`${apiHost}/api/embed/auth/config`, { mode: "cors", credentials: "omit" });
```

The Vite demo server substitutes `__API_HOST__` **in markup only** — the
placeholder is untouched inside an inline `<script type="module">`, which Vite
extracts into a separate `?html-proxy&index=0.js` chunk before the HTML
transform can reach it. Confirmed on the served bytes:

```
$ curl -s 'http://localhost:5173/demo-user-menu.html?html-proxy&index=0.js' | grep apiHost
      const apiHost = "__API_HOST__";
```

So the fetch goes to `http://localhost:5173/__API_HOST__/api/embed/auth/config`,
404s, and the `catch` branch paints the pill:

> Widget auth mode  **legacy (config unavailable)**

…even when `/api/embed/auth/config` is answering `dual` perfectly well and the
widget on the same page is visibly rendering its own Sign In button. The
banner exists precisely to tell a developer which mode is live, and it always
lies. Measured side by side on 2026-09-07 with
`EMBED_AUTH_MODE_ORIGINS=http://localhost:5173=dual`: widget in dual mode,
banner "legacy (config unavailable)".

## Notes for whoever picks this up

- The repo already knows about this Vite behaviour and has a fix pattern.
  `demo-custom-form.html:73` says so out loud:

  ```html
  <!-- … substitutes __API_HOST__ in markup, but NOT inside inline module
       scripts. -->
  <div class="demo-box" data-api-host="__API_HOST__"></div>
  ```

  and `demo-event-details.html:123` uses `window.__nextEmbedApiHost`. Either
  works: put the value in markup, read it from the script.
- The banner script also drives the `#nw_auth_error` display, which is broken
  the same way for the same reason.
- Check the other 24 `demo-*.html` files for the same pattern before fixing
  only this one — `grep -n '__API_HOST__' packages/embed-sdk/demo-*.html` and
  look at which hits are inside a `<script>`.
- The SDK itself is fine: `<next-user-menu api-host="__API_HOST__">` is markup,
  so the widget always gets the right host. Only the page chrome is affected.

## Done when

Loading a demo page under `EMBED_AUTH_MODE_ORIGINS=http://localhost:5173=dual`
shows `dual` in the banner, and the same page under the default shows
`legacy` — with the "(config unavailable)" text reserved for a genuinely
unreachable config endpoint.
