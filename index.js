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

const PORT = process.env.PORT || 5000;

// Создание экземпляров Express и Socket.IO
const app = express();
const server = http.createServer(app);
const io = socketio(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
  },
});

// Настройка middleware
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
  let playerCards = [];
  let deckWithoutPlayerCards = [];
  for (let i = 0; i < players.length; i++) {
    const cards = [deck.pop(), deck.pop()];
    playerCards.push({ playerId: players[i]._id, cards });
  }
  while (deck.length > 0) {
    deckWithoutPlayerCards.push(deck.pop());
  }
  return playerCards;
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
      console.log(`Requesting deal for room: ${roomId}`); // Логирование начала запроса на раздачу

      const players = await User.find({ roomId: roomId });
      console.log(`Found players: ${JSON.stringify(players)}`); // Логирование найденных игроков

      const deck = shuffleDeck();
      console.log("Shuffled deck:", deck); // Логирование результата шаффлинга колоды

      const playerCards = dealCards(deck, players);
      console.log("Dealt cards:", JSON.stringify(playerCards)); // Логирование разданной колоды

      // Отправляем данные о картах каждому игроку через сокет
      playerCards.forEach(({ playerId, cards }) => {
        console.log(`Sending cards to player: ${playerId}`); // Логирование отправки карт игроку
        socket.to(playerId).emit("dealCards", cards);
      });

      // Также можем отправить общее сообщение всем клиентам, что раздача прошла успешно
      console.log(`Broadcasting deal success to room: ${roomId}`); // Логирование подготовки к широковещательной рассылке
      socket.broadcast.to(roomId).emit("dealSuccess", "Карты успешно разданы");
    } catch (error) {
      console.error("Error during card dealing:", error.message);
      // Отправляем ошибку клиенту, если что-то пошло не так
      socket.emit("dealError", {
        message: "Ошибка при раздаче карт",
        error: error.message,
      });
    }
  });
});

module.exports = io;
