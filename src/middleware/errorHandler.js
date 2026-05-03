const logger = require("../utils/logger");

function errorHandler(err, req, res, _next) {
  logger.error(`${req.method} ${req.path} → ${err.message}`);
  if (err.name === "ValidationError") {
    return res.status(400).json({ error: "Validation failed", details: Object.values(err.errors).map(e => e.message) });
  }
  if (err.name === "CastError") return res.status(400).json({ error: "Invalid ID format" });
  if (err.code === 11000) return res.status(409).json({ error: "Duplicate entry" });
  res.status(err.statusCode || 500).json({
    error: process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
  });
}
module.exports = errorHandler;
