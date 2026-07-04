const mongoose = require("mongoose");

const scanJobSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    location: { type: String, required: true, trim: true },
    category: { type: String, required: true },
    categoryLabel: { type: String },

    boundingBox: { south: Number, north: Number, west: Number, east: Number },
    resolvedName: String,
    center: { lat: Number, lng: Number },

    polygon: { type: [[Number]], default: null },
    polygons: { type: [[[Number]]], default: null },
    hasPolygon: { type: Boolean, default: false },

    gridSize: { type: Number, default: 4 },
    threshold: { type: Number, default: 80 },

    status: {
      type: String,
      enum: ["pending", "geocoding", "gridding", "scanning", "enriching", "complete", "failed"],
      default: "pending",
    },
    progress: {
      totalTiles: { type: Number, default: 0 },
      pendingTiles: { type: Number, default: 0 },
      processedTiles: { type: Number, default: 0 },
      subdividedTiles: { type: Number, default: 0 },
      skippedTiles: { type: Number, default: 0 },
      totalBusinesses: { type: Number, default: 0 },
      uniqueBusinesses: { type: Number, default: 0 },
      enrichedBusinesses: { type: Number, default: 0 },
      emptyTiles: { type: Number, default: 0 },
    },

    error: String,
    startedAt: Date,
    completedAt: Date,
    durationMs: Number,
  },
  { timestamps: true }
);

scanJobSchema.index({ userId: 1, createdAt: -1 });
scanJobSchema.index({ status: 1 });

module.exports = mongoose.model("ScanJob", scanJobSchema);
