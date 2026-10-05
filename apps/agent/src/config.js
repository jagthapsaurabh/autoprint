import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Config resolution order:
// 1. AUTOPRINT_SERVER_URL / AUTOPRINT_RUNTIME_KEY env vars
// 2. .env file next to the executable
// 3. agent-config.json in the current working directory — the portable
//    bundle's .bat files start the agent from the bundle folder, where the
//    download pre-fills this file with the shop's server URL + runtime key
// 4. ~/.autoprint/agent-config.json (written by older installers / first run)
const CONFIG_DIR = path.join(os.homedir(), ".autoprint");
const CONFIG_FILE = path.join(CONFIG_DIR, "agent-config.json");
const LOCAL_CONFIG_FILE = path.join(process.cwd(), "agent-config.json");

function readJsonConfig(file) {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, "utf-8"));
    }
  } catch {
    // ignore corrupt config
  }
  return {};
}

export function loadConfig() {
  // Local (bundle) config wins over the home-dir one so a shop that unzips
  // the package on several PCs keeps working after moving the folder.
  const fileConfig = { ...readJsonConfig(CONFIG_FILE), ...readJsonConfig(LOCAL_CONFIG_FILE) };

  const serverUrl = process.env.AUTOPRINT_SERVER_URL || fileConfig.serverUrl || "http://localhost:4000";
  const runtimeKey = process.env.AUTOPRINT_RUNTIME_KEY || fileConfig.runtimeKey || "";

  return { serverUrl: serverUrl.replace(/\/$/, ""), runtimeKey };
}

export function saveConfig({ serverUrl, runtimeKey }) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ serverUrl, runtimeKey }, null, 2));
}

export { CONFIG_FILE, CONFIG_DIR };
