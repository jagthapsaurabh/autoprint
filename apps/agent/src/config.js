import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Config resolution order:
// 1. AUTOPRINT_SERVER_URL / AUTOPRINT_RUNTIME_KEY env vars
// 2. .env file next to the executable
// 3. ~/.autoprint/agent-config.json (written by the installer / first run)
const CONFIG_DIR = path.join(os.homedir(), ".autoprint");
const CONFIG_FILE = path.join(CONFIG_DIR, "agent-config.json");

export function loadConfig() {
  let fileConfig = {};
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      fileConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
    }
  } catch {
    // ignore corrupt config
  }

  const serverUrl = process.env.AUTOPRINT_SERVER_URL || fileConfig.serverUrl || "http://localhost:4000";
  const runtimeKey = process.env.AUTOPRINT_RUNTIME_KEY || fileConfig.runtimeKey || "";

  return { serverUrl: serverUrl.replace(/\/$/, ""), runtimeKey };
}

export function saveConfig({ serverUrl, runtimeKey }) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ serverUrl, runtimeKey }, null, 2));
}

export { CONFIG_FILE, CONFIG_DIR };
