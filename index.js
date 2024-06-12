const express = require("express");
require("dotenv").config();
const mongoose = require("mongoose");
const cors = require("cors");
const userRoutes = require("./routes/userRoutes");
const socketio = require("socket.io");
const http = require("http");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const User = require("../back-end/models/modelUser");
const Room = require("../back-end/models/room");

const PORT = process.env.PORT || 5000;

const app = express();
const server = http.createServer(app);
const io = socketio(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
  },
});

app.use(express.json());
app.use(cors({ origin: "http://localhost:3000" }));
app.use(cookieParser());
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: { secure: true },
  })
);

app.use(userRoutes);

mongoose
  .connect(process.env.BD_CONNECT)
  .then(() => {
    console.log("Connected to DB");
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.log("Error connecting to DB:", error.message);
  });

const suits = ["♥", "♠", "♦", "♣"];
const values = [
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
  "A",
];

const tableCards = [];
const deckWithoutPlayerCards = [];
const playerCards = [];

// Функция для перемешивания карт в колоде
function shuffleDeck() {
  const deck = [];
  suits.forEach((suit) => {
    values.forEach((value) => {
      deck.push({ value, suit });
    });
  });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  return deck;
}

// Функция для раздачи двух карт каждому игроку
function dealCards(deck, players) {
  for (let i = 0; i < players.length; i++) {
    const cards = [deck.pop(), deck.pop()];
    playerCards.push({ playerId: players[i]._id, cards });
  }
  while (deck.length > 0) {
    deckWithoutPlayerCards.push(deck.pop());
  }
  return playerCards;
}

function clearFlop() {
  return (tableCards.length = 0);
}

// Функция для раздачи трех карт (флопа)
function dealFlopCards() {
  for (let i = 0; i < 3; i++) {
    tableCards.push(deckWithoutPlayerCards.pop());
  }
  return tableCards;
}
io.on("connection", (socket) => {
  console.log("New client connected");

  socket.on("getPlayers", async (roomId) => {
    try {
      const players = await User.find({ roomId: roomId });
      io.to(socket.id).emit("playersData", players);
    } catch (error) {
      console.error("Error fetching players:", error.message);
      socket.emit("error", {
        message: "Ошибка при получении списка игроков",
        error: error.message,
      });
    }
  });

  socket.on("requestDeal", async ({ roomId }) => {
    try {
      const players = await User.find({ roomId: roomId });
      const deck = shuffleDeck();

      const playerCards = dealCards(deck, players);

      for (const { playerId, cards } of playerCards) {
        await User.updateOne({ _id: playerId }, { $set: { cards: cards } });
        socket.to(playerId).emit("dealCards", cards);
      }

      console.log(`Broadcasting deal success to room ${roomId}`);
      socket.broadcast.to(roomId).emit("dealSuccess", "Карты успешно разданы");
    } catch (error) {
      console.error("Error during card dealing:", error.message);
      socket.emit("dealError", {
        message: "Ошибка при раздаче карт",
        error: error.message,
      });
    }
  });

  socket.on("dealFlop", async () => {
    try {
      await User.updateMany({}, { $set: { makeTurn: false } });
      clearFlop();
      const flopCards = dealFlopCards();
      console.log(flopCards);
      await User.updateMany({}, { lastBet: 0, roundStage: "flop" });

      const dataToSend = {
        flop: { tableCards: flopCards },
      };
      socket.emit("dealFlop", dataToSend);
    } catch (error) {
      console.error("Error in dealFlop event:", error);
      socket.emit("dealError", {
        message: "Ошибка при выдаче флопа",
        error: error.message,
      });
    }
  });
});

module.exports = io;
