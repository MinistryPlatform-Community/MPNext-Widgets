# 48. Test records left in MP by the comparison run need a Platform user to delete

**Depends on:** a MinistryPlatform Platform (UI) user on the reference domain.
**Risk:** low; this is clutter. The records are obviously named test records.
**Size:** 10 min.

Filed 2026-09-08 by the legacy-vs-next comparison run, and carried over when its index was
pruned on 2026-10-11. Check that the records still exist before acting.

## What

The MP REST API refused these deletes (`table supports direct deletes only`, or 500), so they
were left in place:

| Records | From |
|---|---|
| `Contacts` 942 ("AnonAgent, ZZTEST"), `Participants` 826 | anonymous event registration |
| `Contacts` 943–945 (renamed `ZZTEST-DELETE-ME`), `Participants` 827–829, `Households` 450, `Addresses` 499 | Plan Your Visit submissions |

Deliberately **kept**: the `dp_Communications` / `dp_Communication_Messages` rows from the
pledge confirmation and cancellation emails. They are the evidence that those emails fired.

## Done when

The records are deleted through the Platform UI, and this file is deleted.
