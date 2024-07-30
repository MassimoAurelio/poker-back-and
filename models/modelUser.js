const mongoose = require("mongoose");
const { type } = require("os");

const userSchema = new mongoose.Schema(
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
    roomId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Room",
      required: true,
    },
    isDealer: {
      type: Boolean,
      default: false,
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
    allIn: {
      type: Boolean,
      default: null,
    },
    allInColl: {
      type: Boolean,
      default: null,
    },
    loser: {
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

module.exports = mongoose.model("User", userSchema);
