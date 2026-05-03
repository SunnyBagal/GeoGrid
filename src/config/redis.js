const IORedis = require("ioredis");
const logger = require("../utils/logger");

const redis = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  retryStrategy(times) { return Math.min(times * 200, 5000); },
});
redis.on("connect", () => logger.info("Redis connected"));
redis.on("error", (err) => logger.error("Redis error:", err.message));

const cache = {
  async get(key) {
    const val = await redis.get(key);
    if (!val) return null;
    try { return JSON.parse(val); } catch { return val; }
  },
  async set(key, value, ttl = 3600) {
    const s = typeof value === "string" ? value : JSON.stringify(value);
    ttl ? await redis.setex(key, ttl, s) : await redis.set(key, s);
  },
  async del(key) { await redis.del(key); },
};

module.exports = { redis, cache };
