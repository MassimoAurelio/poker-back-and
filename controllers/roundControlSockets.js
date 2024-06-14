const socketio = require("socket.io");
const User = require("../models/modelUser");

function initializeSocket(server) {
  const io = socketio(server, {
    cors: {
      origin: "http://localhost:3000",
      methods: ["GET", "POST"],
    },
  });

  
}
