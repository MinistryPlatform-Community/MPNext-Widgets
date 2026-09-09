import { config } from "dotenv";
config({ path: "S:/MP/MPNext-Components/.env.local", quiet: true });
import { MPHelper } from "@/lib/providers/ministry-platform";
const mp = new MPHelper();
const op = process.argv[2];
async function t(label: string, fn: () => Promise<unknown>) {
  try { const r = await fn(); console.log(`### ${label}\n${JSON.stringify(r, null, 1).slice(0, 4000)}`); return r; }
  catch (e) { console.log(`### ${label} ERROR: ${(e as Error).message}`); }
}
if (op === "create") {
  await t("create ZZTEST opportunity", () => mp.createTableRecords("Opportunities", [{
    Opportunity_Title: "ZZTEST-Serve-Compare",
    Description: "ZZTEST fixture for the widget comparison run. Safe to delete.",
    Group_Role_ID: 2, Program_ID: 1, Visibility_Level_ID: 4, Contact_Person: 7,
    Publish_Date: "2026-01-01T00:00:00", Opportunity_Date: "2027-12-31T00:00:00",
    Duration_in_Hours: 1, On_Connection_Card: false, Close_Responses: false,
  }]));
} else if (op === "close") {
  await t("close responses", () => mp.updateTableRecords("Opportunities", [{ Opportunity_ID: Number(process.argv[3]), Close_Responses: true }]));
} else if (op === "open") {
  await t("open responses", () => mp.updateTableRecords("Opportunities", [{ Opportunity_ID: Number(process.argv[3]), Close_Responses: false }]));
} else if (op === "resp") {
  await t("responses for opp", () => mp.getTableRecords({ table: "Responses", filter: `Opportunity_ID = ${Number(process.argv[3])}`, orderBy: "Response_ID DESC", top: 20 }));
} else if (op === "delresp") {
  await t("delete response", () => mp.deleteTableRecords("Responses", [Number(process.argv[3])]));
} else if (op === "delopp") {
  await t("delete opportunity", () => mp.deleteTableRecords("Opportunities", [Number(process.argv[3])]));
} else if (op === "participant") {
  await t("participant", () => mp.getTableRecords({ table: "Participants", select: "Participant_ID, Contact_ID", filter: `Participant_ID = ${Number(process.argv[3])}` }));
} else if (op === "contact") {
  await t("contact", () => mp.getTableRecords({ table: "Contacts", select: "Contact_ID, Display_Name, Email_Address, Mobile_Phone", filter: `Contact_ID = ${Number(process.argv[3])}` }));
}
