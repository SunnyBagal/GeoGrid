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
        // "pending" on first run; "processing"/"failed" when BullMQ retries a
        // job that crashed mid-flight — those must be reprocessed, not dropped.
        if (!tile || !["pending", "processing", "failed"].includes(tile.status)) {
          return { skipped: true };
        }

        tile.status = "processing";
        await tile.save();

        const rings = parseRings(polygon);

        let apiResult;
        try {
          apiResult = await searchTile(
            { south: tile.south, north: tile.north, west: tile.west, east: tile.east },
            category
          );
        } catch (error) {
          // A timeout usually means the tile is too large/dense for the
          // server right now. Split it honestly (no fabricated counts) if we
          // can; otherwise let BullMQ retry the same tile.
          if (error.isOverpassTimeout) {
            const children = await subdivideTile(tile, rings);
            if (children && children.length > 0) {
              logger.warn(`Tile ${tileId} timed out — split into ${children.length} children`);
              await enqueueChildren(children, scanId, category, threshold, polygon);
              await updateScanProgress(scanId);
              return { subdividedOnTimeout: true, children: children.length };
            }
          }
          throw error;
        }

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

          const children = await subdivideTile(tile, rings);

          if (children && children.length > 0) {
            await enqueueChildren(children, scanId, category, threshold, polygon);
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

        const attemptsAllowed = job.opts.attempts || 1;
        const isFinalAttempt = job.attemptsMade >= attemptsAllowed - 1;

        if (isFinalAttempt) {
          // Out of retries: mark failed and still check completion, otherwise
          // a scan whose last tile fails hangs in "scanning" forever.
          await Tile.findByIdAndUpdate(tileId, { status: "failed", error: error.message });
          await updateScanProgress(scanId);
          await checkScanComplete(scanId, category);
        } else {
          await Tile.findByIdAndUpdate(tileId, { status: "pending", error: error.message });
        }
        throw error;
      }
    },
    { connection: redis, concurrency: CONCURRENCY }
  );

  worker.on("failed", (job, err) => logger.error(`Job ${job?.id} failed: ${err.message}`));

  setTimeout(reconcileScans, 5000);
  setInterval(reconcileScans, RECONCILE_INTERVAL_MS).unref();

  logger.info("Tile worker ready");
  return worker;
}

function parseRings(polygon) {
  if (!polygon) return null;
  const parsed = typeof polygon === "string" ? JSON.parse(polygon) : polygon;
  if (!Array.isArray(parsed) || !parsed.length) return null;
  // Legacy single-ring payloads are [[lng,lat],...]; multi-ring is [ring, ...]
  return Array.isArray(parsed[0][0]) ? parsed : [parsed];
}

async function enqueueChildren(children, scanId, category, threshold, polygon) {
  const jobs = children.map(child => ({
    name: "process-tile",
    data: { tileId: child._id.toString(), scanId, category, threshold, polygon },
    // jobId = tileId → duplicate enqueues of the same tile are no-ops
    opts: { priority: child.depth, jobId: child._id.toString() },
  }));
  await tileQueue.addBulk(jobs);
}

// Self-healing: a crash or nodemon restart can leave tiles "pending" or
// "processing" in Mongo with no job in Redis (e.g. killed between insertMany
// and addBulk) — the scan then hangs below 100% forever. Every sweep,
// re-enqueue such orphans and re-check completion for active scans.
const RECONCILE_INTERVAL_MS = 120000;
const STALE_PROCESSING_MS = 3 * 60 * 1000;

async function reconcileScans() {
  try {
    const active = await ScanJob.find(
      { status: "scanning" },
      { category: 1, threshold: 1, polygons: 1, polygon: 1 }
    ).lean();
    if (!active.length) return;

    const jobs = await tileQueue.getJobs(["waiting", "active", "delayed", "prioritized"]);
    const queued = new Set(jobs.filter(Boolean).map(j => j.data?.tileId));

    for (const scan of active) {
      const scanId = scan._id.toString();
      const staleCutoff = new Date(Date.now() - STALE_PROCESSING_MS);
      const stuck = await Tile.find({
        scanId: scan._id,
        $or: [
          { status: "pending" },
          { status: "processing", updatedAt: { $lt: staleCutoff } },
        ],
      }, { _id: 1 }).lean();

      const orphans = stuck.filter(t => !queued.has(t._id.toString()));
      if (orphans.length) {
        const polygon = scan.polygons
          ? JSON.stringify(scan.polygons)
          : (scan.polygon ? JSON.stringify([scan.polygon]) : null);
        await Tile.updateMany(
          { _id: { $in: orphans.map(t => t._id) }, status: "processing" },
          { status: "pending" }
        );
        await tileQueue.addBulk(orphans.map(t => ({
          name: "process-tile",
          data: { tileId: t._id.toString(), scanId, category: scan.category, threshold: scan.threshold, polygon },
          // fresh jobId: the original tileId job may sit in completed history
          opts: { jobId: `${t._id}:r${Date.now()}` },
        })));
        logger.warn(`Reconciler: re-enqueued ${orphans.length} orphaned tile(s) for scan ${scanId}`);
      } else if (!stuck.length) {
        await checkScanComplete(scanId, scan.category);
      }
    }
  } catch (err) {
    logger.error(`Reconciler error: ${err.message}`);
  }
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
  // Any in-flight tile can still subdivide, so require zero of both. The
  // atomic status flip guarantees enrichment is enqueued exactly once.
  if (stats.pending === 0 && stats.processing === 0) {
    const flipped = await ScanJob.findOneAndUpdate(
      { _id: scanId, status: "scanning" },
      { status: "enriching" }
    );
    if (flipped) {
      logger.info(`Scan ${scanId} tiles done → enrichment`);
      await aiQueue.add("enrich-scan", { scanId, category });
    }
  }
}

if (require.main === module) {
  startWorker().catch(err => { logger.error("Worker failed:", err); process.exit(1); });
}
module.exports = { startWorker };
