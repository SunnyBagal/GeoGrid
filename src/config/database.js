const mongoose = require("mongoose");
const logger = require("../utils/logger");

async function connectDB() {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    logger.info(`MongoDB connected: ${conn.connection.host}/${conn.connection.name}`);
    mongoose.connection.on("error", (err) => logger.error("MongoDB error:", err));
    return conn;
  } catch (error) {
    logger.error("MongoDB connection failed:", error.message);
    process.exit(1);
  }
}
module.exports = { connectDB };