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

io.on("connection", (socket) => {
  console.log("New client connected");

  socket.on("join", async (data) => {
    try {
      const { player, position, stack } = data;

      const existingPlayer = await User.findOne({ name: player });
      if (existingPlayer) {
        socket.emit("error", {
          message: "Такой игрок уже сидит за столом",
        });
        return;
      }

      const positionPlayer = await User.findOne({ position: position });
      if (positionPlayer) {
        socket.emit("error", {
          message: "Это место на столе уже занято",
        });
        return;
      }

      const newPlayer = new User({ name: player, position, stack });
      await newPlayer.save();

      let betAmount;
      if (position === 1) {
        betAmount = 25;
        await User.updateOne(
          { _id: newPlayer._id },
          { $inc: { stack: -betAmount }, $set: { lastBet: betAmount } }
        );
      } else if (position === 2) {
        betAmount = 50;
        await User.updateOne(
          { _id: newPlayer._id },
          { $inc: { stack: -betAmount }, $set: { lastBet: betAmount } }
        );
      }

      if (position === 3) {
        await User.updateMany(
          { position: 3 },
          { $set: { currentPlayerId: true } }
        );
      }

      socket.emit(
        "success",
        `Игрок ${player} присоединился к столу на позицию ${position}.`
      );
    } catch (error) {
      console.error("Error joining player:", error.message);
      socket.emit("error", {
        message: "Ошибка при присоединении игрока",
        error: error.message,
      });
    }
  });

  socket.on("getPlayers", async () => {
    try {
      const players = await User.find({});
      io.emit("playersData", players);
    } catch (error) {
      console.error("Error fetching players:", error.message);
      socket.emit("error", {
        message: "Ошибка при получении списка игроков",
        error: error.message,
      });
    }
  });
});

module.exports = io;
