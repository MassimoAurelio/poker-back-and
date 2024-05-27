const express = require("express");
require("dotenv").config();
const mongoose = require("mongoose");
const cors = require("cors");
const userRoutes = require("./routes/userRoutes");
const socketio = require("socket.io");
const http = require("http");

const PORT = process.env.PORT || 5000;

const app = express();
const server = http.createServer(app);
const io = require("socket.io")(server, {
  cors: {
    origin: "http://localhost:3000", // Добавьте здесь домены, которым разрешено подключаться
    methods: ["GET", "POST"],
  },
});
app.use(express.json());
app.use(cors({ origin: "http://localhost:3000" }));
app.use(userRoutes);

mongoose
  .connect(
    "mongodb+srv://nynnwork:l4JWJjy9jKmRGuYF@poker.elzua26.mongodb.net/Poker-API?retryWrites=true&w=majority&appName=poker"
  )
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

  // Пример события для отправки информации о действии игрока
  socket.on("playerAction", (actionData) => {
    // Отправить информацию о действии всем подключенным клиентам
    io.emit("playerAction", actionData);
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected");
  });
});

module.exports = io;
