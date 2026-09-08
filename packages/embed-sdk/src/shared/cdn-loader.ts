const scriptCache = new Map<string, Promise<void>>();

/**
 * Load a script from CDN. Deduplicates concurrent requests for the same URL.
 *
 * `integrity` is optional so the signature stays backward compatible. When it
 * is supplied the tag also gets `crossOrigin="anonymous"`: without a CORS
 * request the browser cannot read a cross-origin response body to hash it, so
 * it blocks the script outright. jsDelivr sends `access-control-allow-origin: *`,
 * so anonymous CORS is safe there.
 *
 * A hash mismatch surfaces as `onerror`, i.e. this promise rejects — the same
 * path a network failure takes, which is what both call sites already handle.
 *
 * Two known, deliberately-unfixed gaps (see .claude/TODO/10, both accepted):
 *
 * 1. The early-resolve path below adopts an existing `script[src="..."]` tag
 *    without checking its `integrity`. If a host page had already loaded the
 *    same URL unverified, we report success on their unverified copy. Left as
 *    is: matching on `integrity` too would inject a *second* copy of a 300-500KB
 *    library that is already executing in the page, and the byte-level trust
 *    problem (their tag ran first, whatever we do) would not actually be solved.
 * 2. `scriptCache` is keyed by URL only, so a second caller passing a different
 *    hash for the same URL silently reuses the first promise. Left as is: each
 *    URL has exactly one hash, defined next to its version constant (`FC_SRI` —
 *    FullCalendar is the only remaining production caller), so two hashes for
 *    one URL cannot arise today.
 */
export function loadScript(url: string, integrity?: string): Promise<void> {
  if (scriptCache.has(url)) return scriptCache.get(url)!;

  const promise = new Promise<void>((resolve, reject) => {
    // Check if already loaded in the document
    const existing = document.querySelector(`script[src="${url}"]`);
    if (existing) {
      resolve();
      return;
    }

    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    if (integrity) {
      // setAttribute rather than the IDL properties: identical in browsers, but
      // jsdom does not reflect `script.integrity = ...` to an actual attribute,
      // which would make this untestable (and unverifiable in a DOM dump).
      script.setAttribute("integrity", integrity);
      script.setAttribute("crossorigin", "anonymous");
    }
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${url}`));
    document.head.appendChild(script);
  });

  scriptCache.set(url, promise);
  return promise;
}

/**
 * Inject an external CSS file into a Shadow DOM root.
 *
 * No `integrity` parameter here on purpose: this helper has no production
 * callers (FullCalendar 6.x injects its own CSS from index.global.min.js, and
 * mp-widget-overrides.css is served same-origin via the `customcss` attribute).
 * Add one alongside the first real caller.
 */
export function injectExternalCSS(shadowRoot: ShadowRoot, cssUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = cssUrl;
    link.onload = () => resolve();
    link.onerror = () => reject(new Error(`Failed to load CSS: ${cssUrl}`));
    shadowRoot.appendChild(link);
  });
}
