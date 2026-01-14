import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";

// Load .env file if it exists
const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath, override: true });
}

export { run } from "@oclif/core";
