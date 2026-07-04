// Drains all queued tile/enrichment jobs and marks their unfinished scans as
// failed. Use when stale scans from previous sessions resume on boot and
// burn Overpass quota:  npm run queue:clear
require("dotenv").config();
const { tileQueue, aiQueue } = require("../src/config/queues");
const { connectDB } = require("../src/config/database");
const ScanJob = require("../src/models/ScanJob");

(async () => {
  await connectDB();

  const before = await tileQueue.getJobCounts();
  const backlog = (before.waiting || 0) + (before.prioritized || 0) + (before.delayed || 0) + (before.active || 0);

  await tileQueue.obliterate({ force: true });
  await aiQueue.obliterate({ force: true });

  const stale = await ScanJob.updateMany(
    { status: { $in: ["pending", "geocoding", "gridding", "scanning", "enriching"] } },
    { status: "failed", error: "Cancelled — job queue cleared" }
  );

  console.log(`Cleared ${backlog} queued tile job(s).`);
  console.log(`Marked ${stale.modifiedCount} unfinished scan(s) as failed.`);
  process.exit(0);
})().catch(err => { console.error("queue:clear failed:", err.message); process.exit(1); });
