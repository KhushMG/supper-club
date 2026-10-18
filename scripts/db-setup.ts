import { setup, database } from "../lib/db";
await setup();
console.log("Database ready.");
database().close();
