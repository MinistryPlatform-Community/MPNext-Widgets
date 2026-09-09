/**
 * Brazilian Portuguese catalogue — lazy-loaded, same contract as `../es`.
 *
 * Reached only through `registry.ts`'s `() => import("./locales/pt-BR")`, so it
 * lands in its own content-hashed chunk and costs an English or Spanish page
 * nothing.
 *
 * The `satisfies Messages` below fails `tsc --noEmit` on any key that is missing
 * relative to the English catalogue, misspelled, or a plural message short a
 * branch.
 */

import type { Messages } from "../en";
import { ptBRCore } from "./core";
import { ptBREvents } from "./events";
import { ptBRGroups } from "./groups";
import { ptBRGiving } from "./giving";
import { ptBRPeople } from "./people";
import { ptBRAccount } from "./account";

export const ptBR = {
  ...ptBRCore,
  ...ptBREvents,
  ...ptBRGroups,
  ...ptBRGiving,
  ...ptBRPeople,
  ...ptBRAccount,
} satisfies Messages;
