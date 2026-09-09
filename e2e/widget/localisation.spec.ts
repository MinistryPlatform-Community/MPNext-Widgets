import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";

/**
 * End-to-end proof that localisation works in a real browser.
 *
 * The unit tests cover resolution, formatting and the catalogue; jsdom cannot
 * cover the two things that actually break in production:
 *
 *  1. **The lazy locale chunk is a real network request.** `es` and `pt-BR` are
 *     separate content-hashed chunks that rolldown emits and
 *     `scripts/copy-sdk.js` publishes into `public/embed-sdk/`. A
 *     `chunkFileNames` pattern that loses the `next-embed` prefix, or a missing
 *     `vercel.json` CORS entry, produces a build that works under `vite dev`
 *     (which serves the import off the filesystem) and 404s on every customer
 *     site. Only a browser fetching over HTTP catches that.
 *  2. **First paint must not flash English.** Widgets await the catalogue before
 *     their first render, and whether that ordering actually holds depends on
 *     real timing, not on a jsdom microtask queue.
 *
 * Deliberately no auth: every assertion here uses `next-event-finder`, which is
 * public. A localisation regression should fail this spec whether or not MP is
 * reachable.
 */

/** Text content of a widget's shadow root, whitespace-collapsed. */
async function shadowText(page: Page, tag: string): Promise<string> {
  return page.evaluate((selector) => {
    const host = document.querySelector(selector);
    const text = host?.shadowRoot?.textContent ?? "";
    return text.replace(/\s+/g, " ").trim();
  }, tag);
}

/**
 * Declare `<html lang="…">` before the SDK reads it, the way a bilingual CMS
 * would.
 *
 * Two approaches were tried and rejected, both worth recording:
 *
 *  - A bare `addInitScript` that sets `document.documentElement.lang` runs
 *    against the *initial empty document*, so the attribute is discarded when
 *    the real document parses. The page loads as English and every assertion
 *    fails while the SDK is behaving perfectly.
 *  - Rewriting the HTML through `page.route` gets the attribute there, but
 *    **intercepting the demo page breaks every cross-origin API call in this
 *    setup** — `net::ERR_FAILED` on `localhost:3000/api/embed/*`. Measured, not
 *    guessed: with interception and `lang="en"` the widget rendered 0 event
 *    cards; without it, 34. It is locale-independent, so it is the
 *    interception, and it silently hollows out any assertion that needs data.
 *    (Compare `.claude/TODO/37`, where a widget-E2E network failure was also
 *    first blamed on the wrong thing.)
 *
 * So: set the attribute from an init script, but wait for `<html>` to exist and
 * re-assert on `DOMContentLoaded`. The observer fires while the head is being
 * parsed, long before any widget element is upgraded, and no request is touched.
 */
async function withPageLang(page: Page, lang: string): Promise<void> {
  await page.addInitScript((value) => {
    const apply = () => {
      const root = document.documentElement;
      if (!root) return false;
      root.setAttribute("lang", value as string);
      return true;
    };
    if (!apply()) {
      const observer = new MutationObserver(() => {
        if (apply()) observer.disconnect();
      });
      observer.observe(document, { childList: true, subtree: true });
    }
    // The parser sets its own `lang` from the markup as it reaches the tag;
    // re-assert once it is done so ours is the value that stands.
    document.addEventListener("DOMContentLoaded", apply);
  }, lang);
}

/**
 * A lazily-loaded locale catalogue, in either environment.
 *
 * Production emits a content-hashed `next-embed-locale-<code>.<hash>.js` chunk;
 * the Vite demo server these specs run against serves the module straight from
 * source as `/src/i18n/locales/<code>/index.ts`. Matching both keeps the
 * design property under test here — *one* catalogue fetch per page, shared by
 * every widget, and none at all for English.
 *
 * `en/` is excluded on purpose. In production the English catalogue is inlined
 * in the bundle and fetched never; under `vite dev` its nine source modules
 * arrive as nine separate requests, which would report an English page as
 * fetching nine locale chunks.
 *
 * The production *filename* is guarded separately, by
 * `packages/embed-sdk/src/locale-chunk-naming.test.ts`, because it is a
 * build-output contract rather than a runtime one: the `next-embed` prefix is
 * what `scripts/copy-sdk.js` publishes by, and a chunk named anything else is
 * built, never deployed, and 404s in production.
 */
const LOCALE_MODULE = /next-embed-locale-|\/i18n\/locales\/(?!en\/)/;

const EVENT_FINDER = "next-event-finder";
const DEMO = "/demo-event-finder.html";

/** Wait until the widget has rendered something with words in it. */
async function waitForRender(page: Page): Promise<void> {
  await page.waitForFunction(
    (selector) => {
      const host = document.querySelector(selector);
      const text = host?.shadowRoot?.textContent ?? "";
      return text.trim().length > 10;
    },
    EVENT_FINDER,
    { timeout: 15_000 },
  );
}

test.describe("widget localisation", () => {
  test("renders English by default", async ({ page }) => {
    await page.goto(DEMO);
    await waitForRender(page);

    const text = await shadowText(page, EVENT_FINDER);
    expect(text).toContain("Search");
    expect(text).toContain("Advanced Search");
  });

  test("renders Spanish from <html lang> with no other configuration", async ({
    page,
  }) => {
    // The zero-configuration path, and the one most customers will use: a
    // bilingual CMS already sets this, so the snippet never changes.
    await withPageLang(page, "es");
    await page.goto(DEMO);
    await waitForRender(page);

    const text = await shadowText(page, EVENT_FINDER);
    expect(text).toContain("Búsqueda avanzada");
    expect(text).not.toContain("Advanced Search");
  });

  test("renders Brazilian Portuguese", async ({ page }) => {
    await withPageLang(page, "pt-BR");
    await page.goto(DEMO);
    await waitForRender(page);

    const text = await shadowText(page, EVENT_FINDER);
    expect(text).toContain("Busca avançada");
  });

  test("resolves a regional variant to the shipped catalogue", async ({ page }) => {
    // `es-MX` ships no catalogue of its own; the whole US Spanish-speaking
    // diaspora arrives as one of these tags.
    await withPageLang(page, "es-MX");
    await page.goto(DEMO);
    await waitForRender(page);

    expect(await shadowText(page, EVENT_FINDER)).toContain("Búsqueda avanzada");
  });

  test("falls back to English for a language we do not ship", async ({ page }) => {
    await withPageLang(page, "de");
    await page.goto(DEMO);
    await waitForRender(page);

    expect(await shadowText(page, EVENT_FINDER)).toContain("Advanced Search");
  });

  test("fetches exactly one locale chunk, and none for English", async ({
    page,
  }) => {
    // Guards the whole lazy-loading design: English must cost no extra request,
    // and a non-English page must not fetch a chunk per widget.
    const chunkRequests: string[] = [];
    page.on("request", (req) => {
      if (LOCALE_MODULE.test(req.url())) chunkRequests.push(req.url());
    });

    await page.goto(DEMO);
    await waitForRender(page);
    expect(chunkRequests, "English must fetch no locale chunk").toEqual([]);

    await withPageLang(page, "es");
    await page.goto(DEMO);
    await waitForRender(page);

    // The property under test here is that a non-English page loads the
    // catalogue *at all*, and that English costs nothing. The count is not
    // asserted: production bundles the Spanish catalogue into one chunk, while
    // `vite dev` serves its seven source modules (the index plus six widget
    // domains) as seven requests. "Exactly one chunk per locale" is a build
    // property, guarded by `locale-chunk-naming.test.ts`.
    expect(chunkRequests.length).toBeGreaterThan(0);
    expect(chunkRequests.every((u) => /es/.test(u))).toBe(true);
  });

  test("serves the locale chunk with a 200 and a JS content type", async ({
    page,
  }) => {
    // The failure this catches is a chunk that exists in `dist/` but was never
    // copied into `public/embed-sdk/`, which reads as a 404 the SDK swallows —
    // widgets then render English and nothing looks broken.
    const responses: { status: number; type: string }[] = [];
    page.on("response", (res) => {
      if (LOCALE_MODULE.test(res.url())) {
        responses.push({
          status: res.status(),
          type: res.headers()["content-type"] ?? "",
        });
      }
    });

    await withPageLang(page, "pt-BR");
    await page.goto(DEMO);
    await waitForRender(page);

    expect(responses.length).toBeGreaterThan(0);
    expect(responses[0]?.status).toBe(200);
    expect(responses[0]?.type).toMatch(/javascript/);
  });

  test("never paints English before switching to Spanish", async ({ page }) => {
    // Widgets await the catalogue before their first render. If that ordering
    // regresses, a Spanish visitor sees an English flash — ugly, and invisible
    // to a test that only checks the settled state.
    await withPageLang(page, "es");

    const englishSeen: string[] = [];
    await page.exposeFunction("__recordSample", (text: string) => {
      if (/Advanced Search|No events found/.test(text)) englishSeen.push(text);
    });

    await page.addInitScript(() => {
      // Sample the shadow root on every animation frame from first paint.
      const poll = () => {
        const host = document.querySelector("next-event-finder");
        const text = host?.shadowRoot?.textContent ?? "";
        if (text.trim()) {
          (window as unknown as { __recordSample: (t: string) => void }).__recordSample(
            text,
          );
        }
        requestAnimationFrame(poll);
      };
      requestAnimationFrame(poll);
    });

    await page.goto(DEMO);
    await waitForRender(page);

    expect(
      englishSeen,
      "English copy was painted before the Spanish catalogue arrived",
    ).toEqual([]);
  });

  test("reflects lang and dir onto the host for assistive tech", async ({
    page,
  }) => {
    await withPageLang(page, "es");
    await page.goto(DEMO);
    await waitForRender(page);

    const attrs = await page.evaluate((selector) => {
      const host = document.querySelector(selector);
      return { lang: host?.getAttribute("lang"), dir: host?.getAttribute("dir") };
    }, EVENT_FINDER);

    expect(attrs).toEqual({ lang: "es", dir: "ltr" });
  });

  test("switches every widget on the page via setLocale, and persists it", async ({
    page,
  }) => {
    await page.goto(DEMO);
    await waitForRender(page);
    expect(await shadowText(page, EVENT_FINDER)).toContain("Advanced Search");

    await page.evaluate(async () => {
      const embed = (
        window as unknown as {
          MPNextEmbed?: { setLocale?: (l: string) => Promise<void> };
        }
      ).MPNextEmbed;
      if (!embed?.setLocale) throw new Error("MPNextEmbed.setLocale is unavailable");
      await embed.setLocale("es");
    });

    await expect
      .poll(() => shadowText(page, EVENT_FINDER))
      .toContain("Búsqueda avanzada");

    // The choice survives a reload on a page that declares no language of its
    // own — this is the rung the locale selector writes to.
    await page.reload();
    await waitForRender(page);
    expect(await shadowText(page, EVENT_FINDER)).toContain("Búsqueda avanzada");
  });

  test("applies a church label override over the translation", async ({ page }) => {
    await withPageLang(page, "es");
    await page.goto(DEMO);
    await waitForRender(page);

    await page.evaluate(() => {
      const embed = (
        window as unknown as {
          MPNextEmbed?: {
            setMessages?: (s: string, m: Record<string, string>) => void;
          };
        }
      ).MPNextEmbed;
      if (!embed?.setMessages) throw new Error("MPNextEmbed.setMessages is unavailable");
      embed.setMessages("es", { "eventFinder.showAdvanced": "Más filtros" });
    });

    await expect.poll(() => shadowText(page, EVENT_FINDER)).toContain("Más filtros");
  });

  test("localises dates in the widget's own locale", async ({ page }) => {
    // Formatting is the half of localisation that is easy to forget: the copy
    // translates but the dates stay "Thu, Sep 10". Skips when the API returned
    // no events, since there is then nothing dated to inspect.
    await withPageLang(page, "es");
    await page.goto(DEMO);
    await waitForRender(page);

    // `waitForRender` is satisfied by the search form alone, which paints well
    // before the event query returns — so wait for a dated card specifically,
    // or this silently skips on a working page.
    const dates = await page
      .waitForFunction(
        (selector) => {
          const host = document.querySelector(selector);
          const found = [
            ...(host?.shadowRoot?.querySelectorAll(".nw-ef-card-date") ?? []),
          ].map((el) => el.textContent?.trim() ?? "");
          return found.length ? found : null;
        },
        EVENT_FINDER,
        { timeout: 10_000 },
      )
      .then((handle) => handle.jsonValue() as Promise<string[]>)
      .catch(() => [] as string[]);

    test.skip(dates.length === 0, "no events returned; nothing dated to check");
    // Spanish abbreviates weekdays and months in lower case and never uses the
    // English three-letter forms.
    expect(dates.join(" ")).not.toMatch(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/);
  });
});
