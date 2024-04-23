const express = require("express");
const mongoose = require("mongoose");
const app = express();
const User = require("./models/modelUser");
const cors = require("cors");
const PORT = process.env.PORT || 5000;

app.use(express.json());

app.use(
  cors({
    origin: "http://localhost:3000",
  })
);

// Маршрут для добавления игрока в стол
app.post("/join", async (req, res) => {
  const { player, position, stack } = req.body;
  try {
    const existingPlayer = await User.findOne({ name: player });
    if (existingPlayer) {
      return res.status(400).json("Такой игрок уже сидит за столом");
    }
    const positionPlayer = await User.findOne({ position: position });
    if (positionPlayer) {
      return res.status(400).json("Это место на столе уже занято");
    }
    const newPlayer = new User({ name: player, position, stack });
    await newPlayer.save();
    res
      .status(200)
      .json(`Игрок ${player} присоединился к столу на позицию ${position}.`);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Маршрут для удаления игрока из стола
app.post("/leave", async (req, res) => {
  const playerName = req.body.player;
  try {
    await User.findOneAndDelete({ name: playerName });
    res.status(200).send(`Игрок ${playerName} покинул стол.`);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Ошибка при удалении игрока", error: error.message });
  }
});

// Маршрут для получения списка игроков
app.get("/players", async (req, res) => {
  try {
    const players = await User.find({});
    if (players.length === 0) {
      return res.status(200).json(`Стол пуст`);
    }
    res.status(200).json(players);
  } catch (error) {
    res.status(500).json({
      message: "Ошибка при получении списка игроков",
      error: error.message,
    });
  }
});

mongoose
  .connect(
    "mongodb+srv://nynnwork:l4JWJjy9jKmRGuYF@poker.elzua26.mongodb.net/Poker-API?retryWrites=true&w=majority&appName=poker"
  )
  .then(() => {
    console.log("Connected to DB");
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.log("Error connecting to DB:", error.message);
  });
