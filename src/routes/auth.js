const express = require("express");
const router = express.Router();
const User = require("../models/User");
const { authenticate, generateToken } = require("../middleware/auth");
const logger = require("../utils/logger");

router.post("/signup", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: "Name, email, and password are required." });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters." });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ error: "An account with this email already exists." });
    }

    const user = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password,
      role: "user",
      plan: "free",
    });

    const token = generateToken(user._id);

    logger.info(`New user signed up: ${user.email} (${user._id})`);

    res.status(201).json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        plan: user.plan,
        scansUsed: user.scansUsed,
        scanLimit: user.scanLimit,
      },
    });
  } catch (error) {
    logger.error("Signup error:", error);
    if (error.code === 11000) {
      return res.status(409).json({ error: "An account with this email already exists." });
    }
    res.status(500).json({ error: error.message });
  }
});

router.post("/signin", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }

    const user = await User.findOne({ email: email.toLowerCase() }).select("+password");
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    user.lastLoginAt = new Date();
    await user.save();

    const token = generateToken(user._id);

    logger.info(`User signed in: ${user.email}`);

    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        plan: user.plan,
        scansUsed: user.scansUsed,
        scanLimit: user.scanLimit,
      },
    });
  } catch (error) {
    logger.error("Signin error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/me", authenticate, async (req, res) => {
  const user = req.user;
  res.json({
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      plan: user.plan,
      scansUsed: user.scansUsed,
      scanLimit: user.scanLimit,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
    },
  });
});

module.exports = router;
