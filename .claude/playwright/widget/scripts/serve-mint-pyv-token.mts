// Mints a plan-your-visit verify token locally so step 2 can be tested without a mailbox.
import { config } from "dotenv";
config({ path: "S:/MP/MPNext-Components/.env.local", quiet: true });
import { createVerifyToken } from "@/lib/embed/verify-token";
const [first, last, email] = process.argv.slice(2);
console.log(await createVerifyToken({ firstName: first, lastName: last, email }));
