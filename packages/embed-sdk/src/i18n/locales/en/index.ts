/**
 * The English catalogue — the single source of truth for the catalogue's shape.
 *
 * This file is **statically imported** by `t.ts`, so it is inlined in the SDK
 * bundle. That is deliberate: the English path keeps exactly the bundle size and
 * the zero extra network requests it has today, and every other locale gets a
 * complete, synchronous fallback for any key it is missing.
 *
 * Namespaces are grouped into one file per widget domain rather than one per
 * widget. Fewer files, and — because each domain file has a single owner — the
 * conversion work across widget batches never collides in the same file.
 */

import type { Localized, MessagePaths } from "../../types";
import { core } from "./core";
import { events } from "./events";
import { groups } from "./groups";
import { giving } from "./giving";
import { people } from "./people";
import { account } from "./account";

export const en = {
  ...core,
  ...events,
  ...groups,
  ...giving,
  ...people,
  ...account,
} as const;

/**
 * The shape every translated catalogue must satisfy: exactly these keys, with
 * strings widened from their English literals and plural messages allowed any
 * CLDR category the target language needs.
 *
 * A locale file is written `satisfies Messages`, so a missing key, an extra key
 * or a typo is a `tsc --noEmit` failure rather than a runtime surprise.
 */
export type Messages = Localized<typeof en>;

/** Every valid `t()` key. Gives call sites autocomplete and typo errors. */
export type MessageKey = MessagePaths<typeof en>;
