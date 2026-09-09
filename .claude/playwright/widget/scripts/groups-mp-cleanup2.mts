import { config } from "dotenv";
config({ path: "S:/MP/MPNext-Components/.env.local", quiet: true });
import { MPHelper } from "@/lib/providers/ministry-platform";
const mp = new MPHelper();
const rows = await mp.getTableRecords<Record<string, unknown>>({
  table: "Groups", select: "Group_ID,Group_Name", filter: "Group_Name LIKE 'ZZTEST%'", top: 50,
});
const ids = rows.map((r) => Number(r.Group_ID));
console.log("deleting Groups:", ids, rows.map((r) => r.Group_Name));
if (ids.length) console.log("deleted:", (await mp.deleteTableRecords("Groups", ids)).length);
const after = await mp.getTableRecords({ table: "Groups", select: "Group_ID,Group_Name", filter: "Group_Name LIKE 'ZZTEST%'", top: 10 });
console.log("remaining ZZTEST:", JSON.stringify(after));
const inq = await mp.getTableRecords({ table: "Group_Inquiries", select: "Group_Inquiry_ID", filter: "Comments LIKE 'ZZTEST%'", top: 10 });
console.log("remaining ZZTEST inquiries:", JSON.stringify(inq));
const gp = await mp.getTableRecords({ table: "Group_Participants", select: "Group_Participants.Group_Participant_ID", filter: "Group_Participants.Notes LIKE 'ZZTEST%'", top: 10 });
console.log("remaining ZZTEST participants:", JSON.stringify(gp));
