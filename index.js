const express = require("express");
const mongoose = require("mongoose");
const http = require("http");
const cors = require("cors");
const userRoutes = require("./routes/userRoutes");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const initializeSocket = require("./controllers/socketHandlers");
require("dotenv").config();

const PORT = process.env.PORT || 5000;

const app = express();
const server = http.createServer(app);

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

initializeSocket(server);
