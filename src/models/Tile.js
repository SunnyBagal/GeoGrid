const mongoose = require("mongoose");

const tileSchema = new mongoose.Schema(
  {
    scanId: { type: mongoose.Schema.Types.ObjectId, ref: "ScanJob", required: true, index: true },
    south: { type: Number, required: true },
    north: { type: Number, required: true },
    west: { type: Number, required: true },
    east: { type: Number, required: true },
    depth: { type: Number, default: 0 },
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: "Tile" },
    quadrant: { type: String, enum: ["root", "nw", "ne", "sw", "se"], default: "root" },
    status: {
      type: String,
      enum: ["pending", "processing", "complete", "subdivided", "failed", "skipped"],
      default: "pending",
    },
    intersectsPolygon: { type: Boolean, default: true },
    resultCount: { type: Number, default: 0 },
    apiCallsMade: { type: Number, default: 0 },
    processedAt: Date,
    error: String,
  },
  { timestamps: true }
);

tileSchema.index({ scanId: 1, status: 1 });
module.exports = mongoose.model("Tile", tileSchema);
