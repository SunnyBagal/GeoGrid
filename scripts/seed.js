require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../src/models/User");

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB");

  const adminEmail = "admin@geogrid.com";
  const existing = await User.findOne({ email: adminEmail });

  if (existing) {

    existing.role = "admin";
    existing.plan = "enterprise";
    existing.scanLimit = 999999;
    await existing.save();
    console.log(`✅ Admin user updated: ${adminEmail}`);
  } else {
    await User.create({
      name: "GeoGrid Admin",
      email: adminEmail,
      password: "Admin@123",
      role: "admin",
      plan: "enterprise",
      scanLimit: 999999,
    });
    console.log(`✅ Admin user created: ${adminEmail} / Admin@123`);
  }

  const testEmail = "user@geogrid.com";
  const testUser = await User.findOne({ email: testEmail });
  if (!testUser) {
    await User.create({
      name: "Test User",
      email: testEmail,
      password: "User@123",
      role: "user",
      plan: "free",
      scanLimit: 3,
    });
    console.log(`✅ Test user created: ${testEmail} / User@123`);
  }

  console.log("\nSeeded accounts:");
  console.log("  Admin:  admin@geogrid.com / Admin@123");
  console.log("  User:   user@geogrid.com  / User@123");

  await mongoose.disconnect();
  process.exit(0);
}

seed().catch(err => { console.error("Seed failed:", err); process.exit(1); });
