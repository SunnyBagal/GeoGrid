require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const cookieParser = require("cookie-parser");
const path = require("path");
const { connectDB } = require("./src/config/database");
const logger = require("./src/utils/logger");
const errorHandler = require("./src/middleware/errorHandler");
const { startWorker } = require("./src/workers/tileWorker");
const { startAIWorker } = require("./src/workers/aiWorker");

const app = express();
const PORT = process.env.PORT || 5000;

app.post("/api/payments/webhook",
  express.raw({ type: "application/json" }),
  require("./src/routes/payments").stack
    ? (req, res, next) => next()
    : (req, res, next) => next()
);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(morgan("short", { stream: { write: m => logger.info(m.trim()) } }));

app.use("/api/auth", require("./src/routes/auth"));
app.use("/api/scan", require("./src/routes/scan"));
app.use("/api/categories", require("./src/routes/categories"));
app.use("/api/payments", require("./src/routes/payments"));

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", version: "3.0.0", features: ["polygon_boundaries", "stripe_payments", "osm_free"] });
});

app.use(express.static(path.join(__dirname, "client")));
app.get("*", (req, res) => {
  if (!req.path.startsWith("/api")) res.sendFile(path.join(__dirname, "client", "index.html"));
});

app.use(errorHandler);

async function boot() {
  await connectDB();
  app.listen(PORT, () => {
    logger.info(`
╔═══════════════════════════════════════════════════════╗
║            GEOGRID INDIA v3 — API SERVER              ║
╠═══════════════════════════════════════════════════════╣
║  Port:       ${String(PORT).padEnd(42)}║
║  Features:   Polygon boundaries, Stripe, OSM${" ".repeat(12)}║
║  Admin:      admin@geogrid.com / Admin@123${" ".repeat(13)}║
║  Seed:       npm run seed${" ".repeat(30)}║
║  Dashboard:  http://localhost:${PORT}${" ".repeat(Math.max(0, 24 - String(PORT).length))}║
╚═══════════════════════════════════════════════════════╝`);
  });

  if (process.env.NODE_ENV !== "production") {
    try {
      await startWorker();
      await startAIWorker();
      logger.info("Workers started in-process");
    } catch (err) {
      logger.warn("Workers failed — run: npm run worker");
    }
  }
}

boot().catch(err => { logger.error("Boot failed:", err); process.exit(1); });
