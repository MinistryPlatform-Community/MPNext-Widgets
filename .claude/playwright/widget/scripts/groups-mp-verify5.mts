import { config } from "dotenv";
config({ path: "S:/MP/MPNext-Components/.env.local", quiet: true });
import { MPHelper } from "@/lib/providers/ministry-platform";
const mp = new MPHelper();
const gp = await mp.getTableRecords<Record<string, unknown>>({
  table: "Group_Participants",
  select: "Group_Participants.Group_Participant_ID,Group_Participants.Group_ID,Group_Participants.Participant_ID,Group_Participants.Group_Role_ID,Group_Role_ID_Table.Role_Title,Group_Participants.Start_Date,Group_Participants.End_Date,Group_Participants.Notes,Group_Participants.Employee_Role,Group_Participants.Hours_Per_Week",
  filter: "Group_Participants.Group_ID = 49",
  orderBy: "Group_Participants.Group_Participant_ID DESC",
  top: 30,
});
console.log("Group_Participants group 49:", JSON.stringify(gp, null, 1));
