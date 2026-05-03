const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      minlength: 2,
      maxlength: 100,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Invalid email format"],
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: 6,
      select: false,
    },

    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
    },

    plan: {
      type: String,
      enum: ["free", "premium", "pro", "enterprise"],
      default: "free",
    },
    scansUsed: {
      type: Number,
      default: 0,
    },
    scanLimit: {
      type: Number,
      default: 3,
    },

    lastLoginAt: { type: Date },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

userSchema.index({ unique: true });

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.canScan = function () {
  if (this.role === "admin") return true;
  if (this.plan !== "free") return true;
  return this.scansUsed < this.scanLimit;
};

userSchema.methods.incrementScans = async function () {
  this.scansUsed += 1;
  await this.save();
};

userSchema.methods.getPlanInfo = function () {
  const plans = {
    free:       { limit: 3,       label: "Free",       features: ["3 scans", "Basic data", "CSV export"] },
    premium:    { limit: 50,      label: "Premium",    features: ["50 scans/mo", "AI enrichment", "Priority queue"] },
    pro:        { limit: 500,     label: "Pro",        features: ["500 scans/mo", "Full AI enrichment", "API access"] },
    enterprise: { limit: Infinity, label: "Enterprise", features: ["Unlimited scans", "Custom categories", "Dedicated support"] },
  };
  return plans[this.plan] || plans.free;
};

module.exports = mongoose.model("User", userSchema);
