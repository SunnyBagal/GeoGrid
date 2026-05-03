require("dotenv").config();
const { Worker } = require("bullmq");
const { redis } = require("../config/redis");
const { connectDB } = require("../config/database");
const ScanJob = require("../models/ScanJob");
const Business = require("../models/Business");
const { enrichScanBusinesses } = require("../services/aiEnricher");
const logger = require("../utils/logger");

async function startAIWorker() {
  await connectDB();
  logger.info("AI enrichment worker starting...");

  const worker = new Worker(
    "ai-enrichment",
    async (job) => {
      const { scanId, category } = job.data;
      try {
        await enrichScanBusinesses(scanId, category);
        const enriched = await Business.countDocuments({ scanId, aiEnriched: true });
        const scan = await ScanJob.findById(scanId);
        const dur = scan.startedAt ? Date.now() - scan.startedAt.getTime() : 0;
        await ScanJob.findByIdAndUpdate(scanId, {
          status: "complete", completedAt: new Date(), durationMs: dur,
          "progress.enrichedBusinesses": enriched,
        });
        logger.info(`Scan ${scanId} COMPLETE: ${enriched} businesses in ${(dur / 1000).toFixed(1)}s`);
        return { enriched };
      } catch (err) {
        logger.error(`AI enrichment failed for ${scanId}:`, err.message);
        await ScanJob.findByIdAndUpdate(scanId, { status: "failed", error: err.message });
        throw err;
      }
    },
    { connection: redis, concurrency: 1 }
  );

  worker.on("failed", (job, err) => logger.error(`AI job ${job?.id} failed: ${err.message}`));
  logger.info("AI worker ready");
  return worker;
}

if (require.main === module) {
  startAIWorker().catch(err => { logger.error("AI worker failed:", err); process.exit(1); });
}
module.exports = { startAIWorker };
