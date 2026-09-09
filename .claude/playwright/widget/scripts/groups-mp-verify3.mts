import { config } from "dotenv";
config({ path: "S:/MP/MPNext-Components/.env.local", quiet: true });
import { MPHelper } from "@/lib/providers/ministry-platform";
const mp = new MPHelper();

// Chris Kehayias = Contact 101, Participant 13 (from the group-details contacts result set)
const gp = await mp.getTableRecords({
  table: "Group_Participants",
  select: "Group_Participants.Group_Participant_ID,Group_Participants.Group_ID,Group_ID_Table.Group_Name,Group_ID_Table.Available_Online,Group_Participants.Group_Role_ID,Group_Role_ID_Table.Role_Title,Group_Participants.Start_Date,Group_Participants.End_Date",
  filter: "Participant_ID_Table.Contact_ID = 101",
  orderBy: "Group_Participants.Group_ID",
  top: 100,
});
console.log("Group_Participants for contact 101:", gp.length);
console.log(JSON.stringify(gp, null, 1));

const inq = await mp.getTableRecords({
  table: "Group_Inquiries",
  select: "Group_Inquiry_ID,Group_ID,Contact_ID,First_name,Last_name,Email,Phone,Comments,Inquiry_Date,Placed,_From_Group_Finder",
  filter: "Group_ID = 49",
  orderBy: "Group_Inquiry_ID DESC",
  top: 20,
});
console.log("Group_Inquiries for group 49:", JSON.stringify(inq, null, 1));
