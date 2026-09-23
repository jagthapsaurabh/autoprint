// Cross-platform printer abstraction.
// - On Windows: uses `pdf-to-printer` (SumatraPDF under the hood) for real,
//   silent printing to any installed Windows printer (USB/network/PDF).
// - On Linux/macOS: falls back to CUPS `lp`/`lpstat` if available.
// - If neither is available (e.g. this sandbox with no printer), falls back
//   to a "virtual printer" that just logs + writes a copy to ./prints so the
//   whole pipeline can still be demoed end-to-end.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const execFileAsync = promisify(execFile);
const PLATFORM = process.platform;
const VIRTUAL_DIR = path.join(process.cwd(), "prints");

async function hasCups() {
  try {
    await execFileAsync("which", ["lpstat"]);
    return true;
  } catch {
    return false;
  }
}

export async function listPrinters() {
  if (PLATFORM === "win32") {
    try {
      const { getPrinters } = await import("pdf-to-printer");
      const printers = await getPrinters();
      return printers.map((p) => p.name);
    } catch (err) {
      console.error("Failed to list Windows printers:", err.message);
      return [];
    }
  }

  if (await hasCups()) {
    try {
      const { stdout } = await execFileAsync("lpstat", ["-p"]);
      return stdout
        .split("\n")
        .map((l) => l.match(/^printer (\S+)/))
        .filter(Boolean)
        .map((m) => m[1]);
    } catch {
      return [];
    }
  }

  return ["Virtual PDF Printer (demo mode - no real printer detected)"];
}

export async function printFile(filePath, { printer, copies = 1, colorMode = "GRAY" } = {}) {
  if (PLATFORM === "win32") {
    const { print } = await import("pdf-to-printer");
    await print(filePath, {
      printer: printer || undefined,
      copies,
      monochrome: colorMode === "GRAY",
    });
    return { engine: "pdf-to-printer" };
  }

  if (await hasCups()) {
    const args = ["-d", printer || "", "-n", String(copies), filePath].filter(Boolean);
    await execFileAsync("lp", args);
    return { engine: "cups" };
  }

  // Virtual fallback (dev/demo without a real printer attached)
  fs.mkdirSync(VIRTUAL_DIR, { recursive: true });
  const dest = path.join(VIRTUAL_DIR, `${Date.now()}-${path.basename(filePath)}`);
  fs.copyFileSync(filePath, dest);
  console.log(`[virtual-printer] "Printed" ${copies} cop${copies > 1 ? "ies" : "y"} -> ${dest}`);
  return { engine: "virtual", output: dest };
}

export function osInfo() {
  return `${os.platform()} ${os.release()} (${os.hostname()})`;
}
