const scriptCache = new Map<string, Promise<void>>();

/**
 * Load a script from CDN. Deduplicates concurrent requests for the same URL.
 */
export function loadScript(url: string): Promise<void> {
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
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${url}`));
    document.head.appendChild(script);
  });

  scriptCache.set(url, promise);
  return promise;
}

/**
 * Inject an external CSS file into a Shadow DOM root.
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
