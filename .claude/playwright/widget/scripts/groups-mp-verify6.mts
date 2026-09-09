import { config } from "dotenv";
config({ path: "S:/MP/MPNext-Components/.env.local", quiet: true });
import { MPHelper } from "@/lib/providers/ministry-platform";
const mp = new MPHelper();
const rows = await mp.getTableRecords<Record<string, unknown>>({
  table: "Groups",
  select: "Group_ID,Group_Name,Description,Congregation_ID,Ministry_ID,Group_Type_ID,Primary_Contact,Start_Date,Meeting_Day_ID,Meeting_Time,Life_Stage_ID,Group_Focus_ID,Available_Online,Meets_Online,Group_Is_Full,Meeting_Frequency_ID,Target_Size,Domain_ID",
  filter: "Group_Name LIKE 'ZZTEST-groups-agent%'",
  orderBy: "Group_ID",
  top: 20,
});
console.log(JSON.stringify(rows, null, 1));
