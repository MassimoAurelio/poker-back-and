const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
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
    lastBet: {
      type: Number,
      default: 0,
    },
    preFlopLastBet: {
      type: Number,
      default: 0,
    },
    flopLastBet: {
      type: Number,
      default: 0,
    },
    turnLastBet: {
      type: Number,
      default: 0,
    },
    riverLastBet: {
      type: Number,
      default: 0,
    },
    makeTurn: {
      type: Boolean,
      default: false,
    },
    cards: [
      {
        value: String,
        suit: String,
      },
    ],
    roundStage: {
      type: String,
      enum: ["preflop", "flop", "turn", "river"],
      default: "preflop",
    },
  },
  {
    timestamps: true,
  }
);

const User = mongoose.model("User", UserSchema);

module.exports = User;
