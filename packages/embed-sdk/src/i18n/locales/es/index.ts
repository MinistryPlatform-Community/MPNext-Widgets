/**
 * Spanish catalogue — the lazy-loaded half of the i18n layer.
 *
 * Nothing imports this statically. `registry.ts` reaches it through
 * `() => import("./locales/es")`, which rolldown splits into its own
 * content-hashed chunk, so an English page never downloads a byte of it and a
 * Spanish page pays one ~12KB gzip fetch that every widget on the page shares.
 *
 * The `satisfies Messages` below is the single enforcement point for this
 * locale: it fails `tsc --noEmit` if any key in the English catalogue is missing
 * here, if a key is misspelled, or if a plural message is missing a branch.
 * "Add a language" really is "write the files and let the compiler tell you what
 * is left".
 */

import type { Messages } from "../en";
import { esCore } from "./core";
import { esEvents } from "./events";
import { esGroups } from "./groups";
import { esGiving } from "./giving";
import { esPeople } from "./people";
import { esAccount } from "./account";

export const es = {
  ...esCore,
  ...esEvents,
  ...esGroups,
  ...esGiving,
  ...esPeople,
  ...esAccount,
} satisfies Messages;
