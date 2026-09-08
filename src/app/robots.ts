import type { MetadataRoute } from "next";

/**
 * `/robots.txt` for the widget host.
 *
 * This origin serves two very different surfaces and the crawl policy differs
 * for each:
 *
 * - The **app** (`/`, `/signin`, `/demo/...`) is an internal, sign-in-gated
 *   demo library. It has no public content, so nothing here should be indexed.
 *   Without this file every crawler request for `/robots.txt` was answered
 *   with a `307` to `/signin` (TODO 26) — a redirect where a plain-text policy
 *   was expected, which crawlers treat as "no robots.txt, crawl everything".
 * - `/embed-sdk/*` is the **published SDK bundle**, deliberately fetched
 *   anonymously and cross-origin by church websites that embed `<next-*>`
 *   elements. Those host pages are indexed by their own owners, and a crawler
 *   that renders one has to be able to fetch our script — Google explicitly
 *   warns against blocking the JS/CSS a page needs to render. So the SDK is
 *   allowed even though the rest of the origin is not.
 *
 * `Allow` is emitted before `Disallow`, and the allowlisted rule is the longer
 * match, so the SDK stays fetchable under both the longest-match rule Google
 * and Bing use and the first-match behaviour of simpler crawlers.
 *
 * No `sitemap`: there is no public content to enumerate.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/embed-sdk/",
        disallow: "/",
      },
    ],
  };
}
