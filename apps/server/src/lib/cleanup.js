// Periodically purges old uploaded files and stale print-job rows so the
// server's disk usage and database don't grow unbounded on a shop PC that
// stays on 24/7. Runs on a cron schedule from index.js.
import fs from "node:fs";
import path from "node:path";
import { prisma, rawDb } from "./prisma.js";

const UPLOAD_DIR = process.env.UPLOAD_DIR || "./uploads";
const FILE_RETENTION_MS = Number(process.env.FILE_RETENTION_MS || 24 * 60 * 60 * 1000); // 24h
const JOB_RECORD_RETENTION_MS = Number(process.env.JOB_RECORD_RETENTION_MS || 30 * 24 * 60 * 60 * 1000); // 30 days

export async function cleanupOldFilesAndJobs() {
  const now = Date.now();

  // 1. Delete uploaded/merged files older than the retention window that no
  //    longer belong to an active (non-terminal) job.
  try {
    const activeFilePaths = new Set(
      (
        await prisma.printJob.findMany({
          where: {},
        })
      )
        .filter((j) => !["PRINTED", "FAILED", "CANCELLED"].includes(j.status))
        .map((j) => path.resolve(j.filePath))
    );

    if (fs.existsSync(UPLOAD_DIR)) {
      const entries = fs.readdirSync(UPLOAD_DIR);
      for (const entry of entries) {
        const fullPath = path.join(UPLOAD_DIR, entry);
        try {
          const stat = fs.statSync(fullPath);
          if (!stat.isFile()) continue;
          const age = now - stat.mtimeMs;
          if (age > FILE_RETENTION_MS && !activeFilePaths.has(path.resolve(fullPath))) {
            fs.unlinkSync(fullPath);
          }
        } catch {
          // file may have been removed concurrently — ignore
        }
      }
    }
  } catch (err) {
    console.error("[cleanup] Failed to purge old files:", err.message);
  }

  // 2. Delete very old finished job records to keep the DB small (the shop
  //    dashboard only ever shows the most recent 100 anyway).
  try {
    const cutoff = new Date(now - JOB_RECORD_RETENTION_MS).toISOString();
    rawDb
      .prepare(
        `DELETE FROM PrintJob WHERE status IN ('PRINTED','FAILED','CANCELLED') AND createdAt < ?`
      )
      .run(cutoff);
  } catch (err) {
    console.error("[cleanup] Failed to purge old job records:", err.message);
  }
}
