import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { getDb, getPool } from "./client.server";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function main() {
  await migrate(getDb(), { migrationsFolder: path.join(root, "migrations") });
  await getPool().end();
  console.log("Migrations complete");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
