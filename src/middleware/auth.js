const jwt = require("jsonwebtoken");
const User = require("../models/User");
const logger = require("../utils/logger");

async function authenticate(req, res, next) {
  try {
    let token = null;
    const auth = req.headers.authorization;
    if (auth?.startsWith("Bearer ")) token = auth.split(" ")[1];
    else if (req.cookies?.token) token = req.cookies.token;

    else if (req.query.token) token = req.query.token;

    if (!token) return res.status(401).json({ error: "Authentication required." });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);
    if (!user || !user.isActive) return res.status(401).json({ error: "Account not found." });

    req.user = user;
    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") return res.status(401).json({ error: "Session expired." });
    if (error.name === "JsonWebTokenError") return res.status(401).json({ error: "Invalid token." });
    logger.error("Auth error:", error);
    res.status(500).json({ error: "Authentication error." });
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admin required." });
  next();
}

function checkScanLimit(req, res, next) {
  if (req.user.canScan()) return next();

  res.status(403).json({
    error: "scan_limit_reached",
    message: "You have used all your free scans.",
    scansUsed: req.user.scansUsed,
    scanLimit: req.user.scanLimit,
    plan: req.user.plan,
  });
}

function generateToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || "7d" });
}

module.exports = { authenticate, requireAdmin, checkScanLimit, generateToken };
