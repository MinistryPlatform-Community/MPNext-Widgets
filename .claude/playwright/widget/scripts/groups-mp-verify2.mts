import { config } from "dotenv";
config({ path: "S:/MP/MPNext-Components/.env.local", quiet: true });
import { MPHelper } from "@/lib/providers/ministry-platform";

const mp = new MPHelper();
const base = process.env.MINISTRY_PLATFORM_BASE_URL!.replace(/\/$/, "");
const arg = process.argv[2] || "49";

const det = await mp.executeProcedure("api_MPPW_SearchGroups", {
  "@ImageBaseUrl": `${base}/files/`,
  "@GroupId": Number(arg),
  "@UserId": null,
  "@ShowFullGroups": true,
  "@ShowFutureGroups": true,
  "@ShowFullAddress": true,
});
console.log("DETAIL rs0:", JSON.stringify(det[0], null, 1));
console.log("DETAIL rs1 (contacts):", JSON.stringify(det[1], null, 1));
console.log("result sets:", det.length);

const full = await mp.executeProcedure("api_MPPW_SearchGroups", {
  "@ImageBaseUrl": `${base}/files/`,
  "@UserId": null,
  "@ShowFullGroups": true,
  "@ShowFutureGroups": false,
});
const rows = (full[0] as Record<string, unknown>[]) ?? [];
console.log("ShowFullGroups=true rows:", rows.length);
console.log(JSON.stringify(rows.map(r => ({ Id: r.Id, Title: r.Title, IsFull: r.IsFull, Address: r.Address, Lat: r.Latitude })), null, 1).slice(0, 3000));
