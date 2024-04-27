const { Timestamp } = require("mongodb");
const mongoose = require("mongoose");

const RoundShema = new mongoose.Schema(
  {
    word: {
      type: String,
    },
    stack: {
      type: Number,
    },
    position: {
      type: Number,
    },
    active: {
      type: Boolean,
    },
  },
  {
    timestamps: true,
  }
);

const Round = mongoose.model("Round", RoundShema);

module.exports = Round;
