require("dotenv").config();
const { Worker } = require("bullmq");
const { redis } = require("../config/redis");
const { tileQueue, aiQueue } = require("../config/queues");
const { connectDB } = require("../config/database");
const Tile = require("../models/Tile");
const ScanJob = require("../models/ScanJob");
const Business = require("../models/Business");
const { searchTile } = require("../services/overpassAPI");
const { subdivideTile, getTileStats } = require("../services/gridEngine");
const { deduplicateBatch, validateBusiness } = require("../utils/deduplicator");
const logger = require("../utils/logger");

const CONCURRENCY = parseInt(process.env.TILE_CONCURRENCY) || 2;

async function startWorker() {
  await connectDB();
  logger.info(`Tile worker v3 (concurrency: ${CONCURRENCY})`);

  const worker = new Worker(
    "tile-processing",
    async (job) => {
      const { tileId, scanId, category, threshold, polygon } = job.data;

      try {
        const tile = await Tile.findById(tileId);
        if (!tile || tile.status !== "pending") return { skipped: true };

        tile.status = "processing";
        await tile.save();

        const apiResult = await searchTile(
          { south: tile.south, north: tile.north, west: tile.west, east: tile.east },
          category
        );

        tile.resultCount = apiResult.results;
        tile.apiCallsMade = 1;

        if (apiResult.results === 0) {

          tile.status = "complete";
          tile.processedAt = new Date();
          await tile.save();

          await ScanJob.findByIdAndUpdate(scanId, {
            $inc: { "progress.emptyTiles": 1 },
          });

          logger.debug(`Tile ${tileId} EMPTY (0 results) — skipping subdivision`);
          await updateScanProgress(scanId);
          await checkScanComplete(scanId, category);
          return { empty: true, results: 0 };
        }

        if (apiResult.results >= threshold) {

          const parsedPoly = polygon ? (typeof polygon === "string" ? JSON.parse(polygon) : polygon) : null;
          const children = await subdivideTile(tile, parsedPoly);

          if (children && children.length > 0) {
            for (const child of children) {
              await tileQueue.add("process-tile", {
                tileId: child._id.toString(),
                scanId, category, threshold, polygon,
              }, { priority: child.depth });
            }
            await updateScanProgress(scanId);
            return { subdivided: true, results: apiResult.results, children: children.length };
          }

          logger.warn(`Tile ${tileId}: ${apiResult.results} results but can't subdivide — storing as-is`);
        }

        if (apiResult.places.length > 0) {
          const existing = await Business.find(
            { scanId },
            { osmId: 1, placeId: 1, name: 1, latitude: 1, longitude: 1 }
          ).lean();

          const { unique } = deduplicateBatch(apiResult.places, existing);

          const validBiz = unique.map(biz => {
            const v = validateBusiness(biz);
            return {
              scanId, tileId: tile._id,
              osmId: biz.osmId, placeId: biz.placeId || biz.osmId,
              name: biz.name, address: biz.address,
              city: biz.city, state: biz.state, pincode: biz.pincode,
              latitude: biz.latitude, longitude: biz.longitude,
              category, types: biz.types,
              website: biz.website, phone: biz.phone, email: biz.email,
              openingHours: biz.openingHours, cuisine: biz.cuisine, brand: biz.brand,
              osmTags: biz.osmTags,
              rating: biz.rating, totalReviews: biz.totalReviews,
              businessStatus: biz.businessStatus,
              isValid: v.isValid, validationFlags: v.flags, isDuplicate: false,
            };
          });

          if (validBiz.length > 0) {
            const ops = validBiz.map(b => ({
              updateOne: {
                filter: { scanId: b.scanId, osmId: b.osmId },
                update: { $setOnInsert: b },
                upsert: true,
              },
            }));
            await Business.bulkWrite(ops, { ordered: false });
          }
        }

        tile.status = "complete";
        tile.processedAt = new Date();
        await tile.save();
        await updateScanProgress(scanId);
        await checkScanComplete(scanId, category);

        return { results: apiResult.results, depth: tile.depth };

      } catch (error) {
        logger.error(`Tile ${tileId} failed:`, error.message);
        await Tile.findByIdAndUpdate(tileId, { status: "failed", error: error.message });
        throw error;
      }
    },
    { connection: redis, concurrency: CONCURRENCY }
  );

  worker.on("failed", (job, err) => logger.error(`Job ${job?.id} failed: ${err.message}`));
  logger.info("Tile worker ready");
  return worker;
}

async function updateScanProgress(scanId) {
  const stats = await getTileStats(scanId);
  const uniqueCount = await Business.countDocuments({ scanId, isDuplicate: false });
  await ScanJob.findByIdAndUpdate(scanId, {
    "progress.totalTiles": stats.total,
    "progress.processedTiles": stats.complete,
    "progress.subdividedTiles": stats.subdivided,
    "progress.skippedTiles": stats.skipped,
    "progress.totalBusinesses": stats.totalResults,
    "progress.uniqueBusinesses": uniqueCount,
  });
}

async function checkScanComplete(scanId, category) {
  const stats = await getTileStats(scanId);
  if (stats.pending === 0 && stats.processing <= 1) {
    logger.info(`Scan ${scanId} tiles done → enrichment`);
    await aiQueue.add("enrich-scan", { scanId, category });
    await ScanJob.findByIdAndUpdate(scanId, { status: "enriching" });
  }
}

if (require.main === module) {
  startWorker().catch(err => { logger.error("Worker failed:", err); process.exit(1); });
}
module.exports = { startWorker };
