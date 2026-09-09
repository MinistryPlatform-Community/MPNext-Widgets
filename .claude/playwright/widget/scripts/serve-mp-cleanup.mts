// Serving & visit comparison run (C20-C29): scratch MP driver, left in its final state.
import { config } from "dotenv";
config({ path: "S:/MP/MPNext-Components/.env.local", quiet: true });
import { MPHelper } from "@/lib/providers/ministry-platform";
const mp = new MPHelper();
async function del(table: string, ids: number[]) {
  for (const id of ids) {
    try { await mp.deleteTableRecords(table, [id]); console.log(`deleted ${table} ${id}`); }
    catch (e) { console.log(`FAILED ${table} ${id}: ${(e as Error).message}`); }
  }
}
await del("Form_Response_Answers", [23, 24, 25, 26]);
await del("Form_Responses", [7, 8]);
