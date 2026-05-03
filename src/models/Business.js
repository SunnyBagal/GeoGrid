const mongoose = require("mongoose");

const businessSchema = new mongoose.Schema(
  {
    scanId: { type: mongoose.Schema.Types.ObjectId, ref: "ScanJob", required: true, index: true },
    tileId: { type: mongoose.Schema.Types.ObjectId, ref: "Tile" },

    osmId: { type: String },
    placeId: { type: String },
    name: { type: String, required: true, trim: true },

    address: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    pincode: { type: String, trim: true },
    latitude: Number,
    longitude: Number,

    category: String,
    osmTags: { type: Map, of: String },
    types: [String],
    rating: Number,
    totalReviews: Number,
    website: String,
    phone: String,
    email: String,
    openingHours: String,
    cuisine: String,
    brand: String,

    aiEnriched: { type: Boolean, default: false },
    description: String,
    estimatedSize: {
      type: String,
      enum: ["small", "medium", "large", "unknown"],
      default: "unknown",
    },
    estimatedAge: String,
    correctedCategory: String,
    confidenceScore: Number,

    isValid: { type: Boolean, default: true },
    validationFlags: [String],
    isDuplicate: { type: Boolean, default: false },
    duplicateOf: { type: mongoose.Schema.Types.ObjectId, ref: "Business" },
  },
  { timestamps: true }
);

businessSchema.index({ scanId: 1, osmId: 1 }, { unique: true, sparse: true });
businessSchema.index({ scanId: 1, isValid: 1, isDuplicate: 1 });
businessSchema.index({ name: "text", address: "text" });

module.exports = mongoose.model("Business", businessSchema);
