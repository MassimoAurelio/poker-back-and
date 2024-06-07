const io = require('socket.io');
const User = require("../models/modelUser");

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
  
  });
  
  module.exports = io;