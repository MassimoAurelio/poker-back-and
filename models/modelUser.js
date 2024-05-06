const { Timestamp } = require("mongodb");
const mongoose = require("mongoose");

const UserShema = new mongoose.Schema(
  {
    name: {
      type: String,
    },
    stack: {
      type: Number,
    },
    position: {
      type: Number,
    },
    currentPlayerId: {
      type: Boolean,
      default: false,
    },
    fold: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

const User = mongoose.model("User", UserShema);

module.exports = User;
