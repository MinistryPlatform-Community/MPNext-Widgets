import { config } from "dotenv";
config({ path: "S:/MP/MPNext-Components/.env.local", quiet: true });
import { MPHelper } from "@/lib/providers/ministry-platform";
const mp = new MPHelper();
const uname = (process.env.PLAYWRIGHT_MP_USERNAME || "").replace(/'/g, "''");

const users = await mp.getTableRecords<Record<string, unknown>>({
  table: "dp_Users",
  select: "User_ID,Contact_ID,Display_Name",
  filter: `User_Name = '${uname}' OR User_Email = '${uname}'`,
  top: 5,
});
console.log("USER:", JSON.stringify(users));
const uid = Number(users[0]?.User_ID);
const cid = Number(users[0]?.Contact_ID);

const proc = await mp.executeProcedure("api_MPPW_GetMyGroups", {
  "@UserId": uid,
  "@ImageBaseUrl": `${process.env.MINISTRY_PLATFORM_BASE_URL}/files/`,
});
const rows = (proc[0] as Record<string, unknown>[]) ?? [];
console.log("api_MPPW_GetMyGroups rows:", rows.length);
console.log("columns:", Object.keys(rows[0] ?? {}).join(", "));
console.log(JSON.stringify(rows.map((r) => ({ GroupId: r.GroupId, GroupName: r.GroupName, AvailableOnline: r.AvailableOnline, IsUserLeader: r.IsUserLeader, GroupRoleId: r.GroupRoleId, VolunteerGroup: r.VolunteerGroup })), null, 1));

const gp = await mp.getTableRecords<Record<string, unknown>>({
  table: "Group_Participants",
  select: "Group_Participants.Group_Participant_ID,Group_Participants.Group_ID,Group_ID_Table.Group_Name,Group_ID_Table.Available_Online,Group_Participants.Group_Role_ID,Group_Role_ID_Table.Role_Title,Group_Participants.Start_Date,Group_Participants.End_Date",
  filter: `Participant_ID_Table.Contact_ID = ${cid}`,
  orderBy: "Group_Participants.Group_ID",
  top: 100,
});
console.log(`Group_Participants for contact ${cid}:`, JSON.stringify(gp, null, 1));
