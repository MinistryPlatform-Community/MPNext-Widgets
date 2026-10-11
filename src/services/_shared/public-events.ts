/**
 * The one definition of "an event a public (anonymous) widget may show".
 *
 * `Visibility_Levels` is an MP system lookup with fixed ids across domains:
 * 1 Private, 2 Staff Only, 3 Staff & Church, **4 Public**, 5 Hidden: URL Required
 * (verified 2026-10-11). Only 4 is public. `Cancelled = 0` keeps a cancelled
 * event off calendars and out of add-to-calendar links.
 *
 * Every service that reads `Events` rows on behalf of a public token composes its
 * `$filter` through {@link publicEventFilter} rather than restating the predicate.
 * C06 was exactly that drift: one events route applied it, its sibling did not,
 * and a third (`FullCalendarService.getEventDetail`) applied only half of it.
 *
 * `prefix` qualifies the columns when the query traverses a foreign key and the
 * bare names would be ambiguous (`"Events."`).
 */
export function publicEventPredicate(prefix = ""): string {
  return `${prefix}Cancelled = 0 AND ${prefix}Visibility_Level_ID = 4`;
}

/** `clause` AND the public-event predicate, ready to pass as an MP `$filter`. */
export function publicEventFilter(clause: string, prefix = ""): string {
  return `(${clause}) AND ${publicEventPredicate(prefix)}`;
}
