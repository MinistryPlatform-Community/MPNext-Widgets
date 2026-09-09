// Groups agent (C10-C19): MP-side verification for the group widgets.
import { config } from "dotenv";
config({ path: "S:/MP/MPNext-Components/.env.local", quiet: true });
import { MPHelper } from "@/lib/providers/ministry-platform";

const mp = new MPHelper();
const base = process.env.MINISTRY_PLATFORM_BASE_URL!.replace(/\/$/, "");

const res = await mp.executeProcedure("api_MPPW_SearchGroups", {
  "@ImageBaseUrl": `${base}/files/`,
  "@UserId": null,
  "@ShowFullGroups": false,
  "@ShowFutureGroups": false,
});
const rows = (res[0] as Record<string, unknown>[]) ?? [];
console.log("PROC ROWS:", rows.length);
console.log("PROC COLUMNS:", Object.keys(rows[0] ?? {}).join(", "));
console.log(JSON.stringify(rows.map((r) => ({ Id: r.Id, Title: r.Title, Hidden: r.Hidden, Featured: r.Featured, IsFull: r.IsFull, MeetsOnline: r.MeetsOnline, MeetingFrequency: r.MeetingFrequency, StartDate: r.StartDate, Offsite: r.Offsite })), null, 1));

const groups = await mp.getTableRecords({
  table: "Groups",
  select: "Group_ID,Group_Name,Available_Online,Group_Is_Full,Start_Date,End_Date,Group_Type_ID,Meets_Online,Congregation_ID",
  filter: "Available_Online = 1",
  orderBy: "Group_ID",
  top: 200,
});
console.log("Groups Available_Online=1 :", groups.length);
console.log(JSON.stringify(groups, null, 1).slice(0, 5000));
