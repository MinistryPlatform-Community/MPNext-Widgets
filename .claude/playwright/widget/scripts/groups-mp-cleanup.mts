import { config } from "dotenv";
config({ path: "S:/MP/MPNext-Components/.env.local", quiet: true });
import { MPHelper } from "@/lib/providers/ministry-platform";
const mp = new MPHelper();

const inq = await mp.getTableRecords<Record<string, unknown>>({
  table: "Group_Inquiries",
  select: "Group_Inquiry_ID,Comments",
  filter: "Comments LIKE 'ZZTEST-groups-agent%'",
  top: 50,
});
const inqIds = inq.map((r) => Number(r.Group_Inquiry_ID));
console.log("deleting Group_Inquiries:", inqIds);
if (inqIds.length) console.log(JSON.stringify(await mp.deleteTableRecords("Group_Inquiries", inqIds)));

const gp = await mp.getTableRecords<Record<string, unknown>>({
  table: "Group_Participants",
  select: "Group_Participants.Group_Participant_ID,Group_Participants.Notes",
  filter: "Group_Participants.Notes LIKE 'ZZTEST-groups-agent%'",
  top: 50,
});
const gpIds = gp.map((r) => Number(r.Group_Participant_ID));
console.log("deleting Group_Participants:", gpIds);
if (gpIds.length) console.log(JSON.stringify(await mp.deleteTableRecords("Group_Participants", gpIds)));

const grp = await mp.getTableRecords<Record<string, unknown>>({
  table: "Groups",
  select: "Group_ID,Group_Name",
  filter: "Group_Name LIKE 'ZZTEST%'",
  top: 50,
});
console.log("remaining ZZTEST groups:", JSON.stringify(grp));
