const Tile = require("../models/Tile");
const logger = require("../utils/logger");
const { rectIntersectsPolygon } = require("../utils/geometry");

const MIN_TILE_SIZE = parseFloat(process.env.MIN_TILE_SIZE_DEG) || 0.002;
const MAX_DEPTH = parseInt(process.env.MAX_SUBDIVISION_DEPTH) || 6;

async function createInitialGrid(scanId, bbox, gridSize = 4, polygon = null) {
  const { south, north, west, east } = bbox;
  const rows = gridSize, cols = gridSize;
  const latStep = (north - south) / rows;
  const lngStep = (east - west) / cols;

  const pendingDocs = [];
  const skippedDocs = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let tS = south + r * latStep;
      let tN = south + (r + 1) * latStep;
      let tW = west + c * lngStep;
      let tE = west + (c + 1) * lngStep;

      if (r === 0) tS = south;
      if (r === rows - 1) tN = north;
      if (c === 0) tW = west;
      if (c === cols - 1) tE = east;

      const tileRect = { south: tS, north: tN, west: tW, east: tE };

      const intersects = polygon
        ? rectIntersectsPolygon(tileRect, polygon)
        : true;

      const doc = {
        scanId,
        south: tS, north: tN, west: tW, east: tE,
        depth: 0, quadrant: "root",
        status: intersects ? "pending" : "skipped",
        intersectsPolygon: intersects,
      };

      if (intersects) pendingDocs.push(doc);
      else skippedDocs.push(doc);
    }
  }

  const allDocs = [...pendingDocs, ...skippedDocs];
  const tiles = await Tile.insertMany(allDocs);

  const pendingCount = pendingDocs.length;
  const skippedCount = skippedDocs.length;

  logger.info(
    `Grid: ${rows}×${cols} = ${rows * cols} tiles | ` +
    `${pendingCount} inside polygon, ${skippedCount} skipped`
  );

  return {
    tiles: tiles.filter(t => t.status === "pending"),
    totalTiles: allDocs.length,
    pendingTiles: pendingCount,
    skippedTiles: skippedCount,
  };
}

async function subdivideTile(parentTile, polygon = null) {
  const { scanId, south, north, west, east, depth } = parentTile;
  const newDepth = depth + 1;
  const latSpan = north - south;
  const lngSpan = east - west;

  if (latSpan / 2 < MIN_TILE_SIZE || lngSpan / 2 < MIN_TILE_SIZE) {
    logger.warn(`Tile ${parentTile._id} too small to subdivide`);
    return null;
  }
  if (newDepth > MAX_DEPTH) {
    logger.warn(`Tile ${parentTile._id} hit max depth ${MAX_DEPTH}`);
    return null;
  }

  const midLat = (south + north) / 2;
  const midLng = (west + east) / 2;

  const childBounds = [
    { q: "sw", s: south, n: midLat, w: west, e: midLng },
    { q: "se", s: south, n: midLat, w: midLng, e: east },
    { q: "nw", s: midLat, n: north, w: west, e: midLng },
    { q: "ne", s: midLat, n: north, w: midLng, e: east },
  ];

  const children = childBounds.map(cb => {
    const rect = { south: cb.s, north: cb.n, west: cb.w, east: cb.e };
    const intersects = polygon ? rectIntersectsPolygon(rect, polygon) : true;

    return {
      scanId, depth: newDepth, parentId: parentTile._id,
      quadrant: cb.q,
      south: cb.s, north: cb.n, west: cb.w, east: cb.e,
      status: intersects ? "pending" : "skipped",
      intersectsPolygon: intersects,
    };
  });

  await Tile.findByIdAndUpdate(parentTile._id, { status: "subdivided" });
  const tiles = await Tile.insertMany(children);

  const pendingChildren = tiles.filter(t => t.status === "pending");
  logger.debug(`Subdivided → ${pendingChildren.length}/4 children inside polygon at depth ${newDepth}`);

  return pendingChildren;
}

async function getTileStats(scanId) {
  const mongoose = require("mongoose");
  const stats = await Tile.aggregate([
    { $match: { scanId: new mongoose.Types.ObjectId(scanId) } },
    { $group: { _id: "$status", count: { $sum: 1 }, totalResults: { $sum: "$resultCount" } } },
  ]);
  const r = { pending: 0, processing: 0, complete: 0, subdivided: 0, failed: 0, skipped: 0, totalResults: 0 };
  stats.forEach(s => { r[s._id] = s.count; r.totalResults += s.totalResults; });
  r.total = r.pending + r.processing + r.complete + r.subdivided + r.failed + r.skipped;
  return r;
}

module.exports = { createInitialGrid, subdivideTile, getTileStats };
