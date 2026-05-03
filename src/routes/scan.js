const express = require("express");
const router = express.Router();
const ScanJob = require("../models/ScanJob");
const Tile = require("../models/Tile");
const Business = require("../models/Business");
const { geocodeLocation } = require("../services/geocoder");
const { createInitialGrid, getTileStats } = require("../services/gridEngine");
const { tileQueue } = require("../config/queues");
const { authenticate, checkScanLimit } = require("../middleware/auth");
const logger = require("../utils/logger");

router.use(authenticate);

router.post("/", checkScanLimit, async (req, res) => {
  try {
    const { location, category, categoryLabel, gridSize = 4, threshold = 80 } = req.body;
    if (!location || !category) return res.status(400).json({ error: "location and category required." });

    logger.info(`Scan: "${category}" in "${location}" by ${req.user.email}`);

    const geo = await geocodeLocation(location);

    const area = (geo.bbox.north - geo.bbox.south) * (geo.bbox.east - geo.bbox.west);
    let gs = Math.min(Math.max(gridSize, 2), 10);
    if (area > 0.1) gs = Math.max(gs, 6);
    else if (area < 0.001) gs = Math.min(gs, 3);

    const scan = await ScanJob.create({
      userId: req.user._id,
      location, category,
      categoryLabel: categoryLabel || category,
      boundingBox: geo.bbox,
      resolvedName: geo.resolvedName,
      center: geo.center,
      polygon: geo.polygon,
      hasPolygon: geo.hasPolygon,
      gridSize: gs,
      threshold: Math.min(Math.max(threshold, 20), 120),
      status: "gridding",
      startedAt: new Date(),
    });

    const gridResult = await createInitialGrid(
      scan._id, geo.bbox, gs,
      geo.polygonSimplified
    );

    const jobs = gridResult.tiles.map(t => ({
      name: "process-tile",
      data: {
        tileId: t._id.toString(),
        scanId: scan._id.toString(),
        category, threshold: scan.threshold,

        polygon: geo.polygonSimplified ? JSON.stringify(geo.polygonSimplified) : null,
      },
      opts: { priority: 0 },
    }));
    if (jobs.length > 0) await tileQueue.addBulk(jobs);

    scan.status = "scanning";
    scan.progress.totalTiles = gridResult.totalTiles;
    scan.progress.pendingTiles = gridResult.pendingTiles;
    scan.progress.skippedTiles = gridResult.skippedTiles;
    await scan.save();
    await req.user.incrementScans();

    logger.info(`Scan ${scan._id}: ${gridResult.pendingTiles}/${gridResult.totalTiles} tiles (${gridResult.skippedTiles} outside polygon)`);

    res.status(201).json({
      scanId: scan._id,
      status: "scanning",
      location: geo.resolvedName,
      boundingBox: geo.bbox,
      center: geo.center,
      hasPolygon: geo.hasPolygon,
      polygon: geo.polygon,
      totalTiles: gridResult.totalTiles,
      activeTiles: gridResult.pendingTiles,
      skippedTiles: gridResult.skippedTiles,
      gridSize: gs,
      scansRemaining: req.user.role === "admin" ? "∞" : Math.max(0, req.user.scanLimit - req.user.scansUsed),
    });
  } catch (error) {
    logger.error("Scan failed:", error);
    res.status(error.message.includes("No results") ? 404 : 500).json({ error: error.message });
  }
});

router.get("/", async (req, res) => {
  const filter = req.user.role === "admin" ? {} : { userId: req.user._id };
  const { page = 1, limit = 20 } = req.query;
  const [scans, total] = await Promise.all([
    ScanJob.find(filter, { polygon: 0 }).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(+limit).lean(),
    ScanJob.countDocuments(filter),
  ]);
  res.json({ scans, pagination: { page: +page, limit: +limit, total } });
});

router.get("/:id", async (req, res) => {
  const scan = await ScanJob.findById(req.params.id);
  if (!scan) return res.status(404).json({ error: "Not found" });
  if (req.user.role !== "admin" && scan.userId.toString() !== req.user._id.toString())
    return res.status(403).json({ error: "Access denied" });

  let tileStats = {};
  if (["scanning", "enriching"].includes(scan.status)) tileStats = await getTileStats(scan._id.toString());

  res.json({ scan: { ...scan.toObject(), tileStats } });
});

router.get("/:id/tiles", async (req, res) => {
  const tiles = await Tile.find(
    { scanId: req.params.id },
    { south: 1, north: 1, west: 1, east: 1, depth: 1, status: 1, resultCount: 1, intersectsPolygon: 1 }
  ).lean();
  res.json({ tiles, count: tiles.length });
});

router.get("/:id/businesses", async (req, res) => {
  const { page = 1, limit = 50 } = req.query;
  const filter = { scanId: req.params.id, isDuplicate: false, isValid: true };
  const [businesses, total] = await Promise.all([
    Business.find(filter).sort({ confidenceScore: -1 }).skip((page - 1) * limit).limit(+limit).lean(),
    Business.countDocuments(filter),
  ]);
  res.json({ businesses, pagination: { page: +page, limit: +limit, total, pages: Math.ceil(total / limit) } });
});

router.get("/:id/export", async (req, res) => {
  const businesses = await Business.find({
    scanId: req.params.id, isValid: true, isDuplicate: false,
  }).sort({ name: 1 }).lean();
  if (!businesses.length) return res.status(404).json({ error: "No data" });

  const esc = v => { if (v == null) return ""; const s = String(v); return (s.includes(",") || s.includes('"') || s.includes("\n")) ? `"${s.replace(/"/g, '""')}"` : s; };
  const hdr = ["Name","Category","Address","City","State","Pincode","Website","Phone","Email","Description","Size","Age","Confidence","Cuisine","Brand","Hours","Lat","Lng"];
  const rows = businesses.map(b => [b.name, b.correctedCategory||b.category, b.address, b.city, b.state, b.pincode, b.website, b.phone, b.email, b.description, b.estimatedSize, b.estimatedAge, b.confidenceScore, b.cuisine, b.brand, b.openingHours, b.latitude, b.longitude].map(esc).join(","));

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="geogrid_${req.params.id}.csv"`);
  res.send([hdr.join(","), ...rows].join("\n"));
});

module.exports = router;
