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
const RegUser = require("../back-end/models/regUser");
const jwt = require("jsonwebtoken");

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

  socket.on("getPlayers", async () => {
    try {
      const players = await User.find({});
      io.to(socket.id).emit("playersData", players);
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
