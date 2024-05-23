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
    cards: [{ 
      value: String,
      suit: String
    }],
    actionCount: {
      type: Number,
      default: 0,
    },
    roundStage: { 
      type: String,
      enum: ['preflop', 'flop', 'turn', 'river'],
      default: 'preflop'
    }
  },
  {
    timestamps: true,
  }
);

const User = mongoose.model("User", UserSchema);

module.exports = User;