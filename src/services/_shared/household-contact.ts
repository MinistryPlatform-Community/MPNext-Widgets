/**
 * "Act as a household member": the one server-side check behind every
 * "Respond As" / "Complete Form As" picker (C21, C26).
 *
 * A picker posts a bare `ContactId`. The client chose it from the caller's own
 * household roster, but nothing stops a caller from posting any other id, and
 * the routes that accept it then stamp a row with that contact's identity and
 * back-fill that contact's name, email and phone. So the id is honoured only
 * when it is the signed-in caller or a member of the caller's household. A
 * public token never acts as anyone.
 *
 * Reads only.
 */

import { MPHelper } from "@/lib/providers/ministry-platform";
import { HouseholdService } from "@/services/householdService";

/** The columns a response/answer row denormalises from its contact. */
export interface ContactBasics {
  contactId: number;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
}

/**
 * True when `sub` (a widget JWT `sub`, the caller's `User_GUID`) may act as
 * `contactId`: it is the caller's own contact, or a contact in the caller's
 * household. `"public"` is never allowed.
 */
export async function canActAsContact(sub: string, contactId: number): Promise<boolean> {
  if (!sub || sub === "public" || !Number.isInteger(contactId) || contactId <= 0) return false;
  const households = await HouseholdService.getInstance();
  const user = await households.resolveUser(sub);
  if (!user) return false;
  if (user.contactId === contactId) return true;
  if (user.householdId == null) return false;
  return households.verifyMemberInHousehold(contactId, user.householdId);
}

/** First/last name, email and mobile phone for one contact, or null. */
export async function getContactBasics(
  contactId: number,
  mp: MPHelper = new MPHelper()
): Promise<ContactBasics | null> {
  const rows = await mp.getTableRecords<{
    Contact_ID: number;
    First_Name: string | null;
    Nickname: string | null;
    Last_Name: string | null;
    Email_Address: string | null;
    Mobile_Phone: string | null;
  }>({
    table: "Contacts",
    select: "Contact_ID, First_Name, Nickname, Last_Name, Email_Address, Mobile_Phone",
    filter: `Contact_ID = ${Number(contactId)}`,
    top: 1,
  });
  const c = rows[0];
  if (!c) return null;
  return {
    contactId: Number(c.Contact_ID),
    firstName: c.First_Name || c.Nickname || null,
    lastName: c.Last_Name || null,
    email: c.Email_Address || null,
    phone: c.Mobile_Phone || null,
  };
}
