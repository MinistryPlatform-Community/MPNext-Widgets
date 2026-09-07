/**
 * Shared Google Maps Places helpers for address autocomplete. Used by
 * `next-my-household` and `next-custom-form`. All entry points fail gracefully
 * so that manual address entry still works when Maps is unavailable.
 */

export interface ParsedAddress {
  line1: string;
  city: string;
  state: string;
  postalCode: string;
  /** ISO country short code (e.g. "US"), uppercase. */
  countryCode: string;
}

// Module-level guard so the Google Maps Places script is only loaded once,
// even across multiple widget instances on the same page.
let googleMapsPromise: Promise<boolean> | null = null;

/**
 * Inject the Google Maps JS API (`places` library) once. Resolves `true` when
 * the script is ready, `false` on any failure. Safe to call repeatedly.
 */
export function loadGoogleMaps(key: string): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (
    typeof (window as any).google !== "undefined" &&
    (window as any).google?.maps?.places
  ) {
    return Promise.resolve(true);
  }
  if ((window as any).__nextGoogleMapsPromise) {
    return (window as any).__nextGoogleMapsPromise;
  }
  if (googleMapsPromise) return googleMapsPromise;

  googleMapsPromise = new Promise<boolean>((resolve) => {
    try {
      const existing = document.querySelector<HTMLScriptElement>(
        'script[data-next-google-maps="1"]',
      );
      if (existing) {
        existing.addEventListener("load", () => resolve(true));
        existing.addEventListener("error", () => resolve(false));
        return;
      }
      const script = document.createElement("script");
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
        key,
      )}&libraries=places`;
      script.async = true;
      script.defer = true;
      script.dataset.nextGoogleMaps = "1";
      script.addEventListener("load", () => resolve(true));
      script.addEventListener("error", () => resolve(false));
      document.head.appendChild(script);
    } catch {
      resolve(false);
    }
  });
  (window as any).__nextGoogleMapsPromise = googleMapsPromise;
  return googleMapsPromise;
}

/** Flatten Google `address_components` into a simple address shape. */
export function parseAddressComponents(
  components: Array<{ long_name: string; short_name: string; types: string[] }>,
): ParsedAddress {
  const get = (type: string, useShort = false): string => {
    const c = components.find((comp) => comp.types.includes(type));
    if (!c) return "";
    return useShort ? c.short_name : c.long_name;
  };

  const streetNumber = get("street_number");
  const route = get("route");
  const line1 = [streetNumber, route].filter(Boolean).join(" ").trim();
  const city =
    get("locality") ||
    get("postal_town") ||
    get("sublocality") ||
    get("administrative_area_level_2");
  const state = get("administrative_area_level_1", true);
  const postalCode = get("postal_code");
  const countryCode = get("country", true);

  return { line1, city, state, postalCode, countryCode };
}

/**
 * Attach a Places `Autocomplete` to the given line-1 input. On selection, the
 * parsed address is handed to `onPlace`. No-op (graceful) if Maps is missing.
 */
export function attachAddressAutocomplete(
  line1Input: HTMLInputElement,
  onPlace: (address: ParsedAddress) => void,
): void {
  try {
    const g = (window as any).google;
    if (!g?.maps?.places?.Autocomplete) return;

    const autocomplete = new g.maps.places.Autocomplete(line1Input, {
      types: ["address"],
      fields: ["address_components"],
    });

    autocomplete.addListener("place_changed", () => {
      try {
        const place = autocomplete.getPlace();
        if (!place || !place.address_components) return;
        onPlace(parseAddressComponents(place.address_components));
      } catch {
        /* graceful fallback */
      }
    });
  } catch {
    /* graceful fallback — manual entry */
  }
}
