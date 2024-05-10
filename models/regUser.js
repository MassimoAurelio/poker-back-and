const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
});

const RegUser = mongoose.model("RegUser", userSchema);

module.exports = RegUser;