// MP read/write driver used by the giving comparison pass (2026-09-08).
import { config } from "dotenv";
config({ path: "S:/MP/MPNext-Components/.env.local", quiet: true });
import { MPHelper } from "../../../../../src/lib/providers/ministry-platform/index.js";

const mp = new MPHelper();
const [mode, ...rest] = process.argv.slice(2);
const out = (x: unknown) => console.log(JSON.stringify(x, null, 1));

async function main() {
  if (mode === "t") {
    const [table, select, filter, top, orderBy] = rest;
    out(await mp.getTableRecords({ table, select: select || undefined, filter: filter || undefined, top: top ? Number(top) : 200, orderBy: orderBy || undefined }));
  } else if (mode === "p") {
    const [proc, params] = rest;
    out(await mp.executeProcedure(proc, params ? JSON.parse(params) : {}));
  } else if (mode === "procs") {
    out((await mp.getProcedures(rest[0])).map((p: any) => p.Name ?? p.name ?? p));
  } else if (mode === "create") {
    out(await mp.createTableRecords(rest[0], JSON.parse(rest[1])));
  } else if (mode === "update") {
    out(await mp.updateTableRecords(rest[0], JSON.parse(rest[1])));
  } else if (mode === "del") {
    out(await mp.deleteTableRecords(rest[0], JSON.parse(rest[1])));
  } else if (mode === "updatef") {
    const fs = await import("node:fs");
    out(await mp.updateTableRecords(rest[0], JSON.parse(fs.readFileSync(rest[1], "utf8"))));
  } else console.error("usage: t|p|procs|create|update|del|updatef");
}
main().catch(e => { console.error("ERR", e?.message ?? e); process.exit(1); });
