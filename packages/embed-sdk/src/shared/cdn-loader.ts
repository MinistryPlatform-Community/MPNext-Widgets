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
 * `integrity` carries the same contract as `loadScript` above, and for the same
 * reason: supplying it also sets `crossOrigin="anonymous"`, because without a
 * CORS request the browser cannot read a cross-origin response body to hash it
 * and blocks the stylesheet outright. A hash mismatch surfaces as `onerror`,
 * i.e. this promise rejects — the same path a network failure takes.
 *
 * FullCalendar 7 is the first real caller (7.x ships no CSS inside its JS
 * bundle, unlike 6.x, which injected its own `<style>` into `document.head`).
 *
 * Deliberately **not** deduplicated the way `loadScript` is: a `<link>` belongs
 * to one shadow root, and every widget instance has its own, so a module-level
 * URL-keyed cache would hand instance 2 a resolved promise for a stylesheet
 * that only ever landed in instance 1. Callers that must not double-inject own
 * that latch (see `stylesInjected` in `full-calendar.ts`).
 */
export function injectExternalCSS(
  shadowRoot: ShadowRoot,
  cssUrl: string,
  integrity?: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = cssUrl;
    if (integrity) {
      // setAttribute rather than the IDL properties, matching loadScript: jsdom
      // does not reflect `link.integrity = ...` to an actual attribute, which
      // would make this untestable.
      link.setAttribute("integrity", integrity);
      link.setAttribute("crossorigin", "anonymous");
    }
    link.onload = () => resolve();
    link.onerror = () => reject(new Error(`Failed to load CSS: ${cssUrl}`));
    shadowRoot.appendChild(link);
  });
}
