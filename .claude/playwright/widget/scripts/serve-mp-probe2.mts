// Serving & visit comparison run (C20-C29): scratch MP driver, left in its final state.
import { config } from "dotenv";
config({ path: "S:/MP/MPNext-Components/.env.local", quiet: true });
import { MPHelper } from "@/lib/providers/ministry-platform";
const mp = new MPHelper();
console.log(JSON.stringify(await mp.getTableRecords({ table: "Form_Response_Answers", select: "Form_Response_Answer_ID, Form_Response_ID, Form_Field_ID, Response", filter: "Form_Response_ID = 7 OR Form_Response_ID = 8", orderBy: "Form_Response_ID, Form_Field_ID" }), null, 1));
