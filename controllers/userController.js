const User = require("../models/modelUser");
const Round = require("../models/modelRound");

// Сесть за стол
exports.join = async (req, res) => {
  const { player, position, stack, positions, active } = req.body;
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

    if (position === 1) {
      await User.updateOne({ _id: newPlayer._id }, { $inc: { stack: -50 } });
    } else if (position === 2) {
      await User.updateOne({ _id: newPlayer._id }, { $inc: { stack: -100 } });
    }

    if (position === 3) {
      await User.updateMany(
        { position: 3 },
        { $set: { currentPlayerId: true } }
      );
    }
    res
      .status(200)
      .json(`Игрок ${player} присоединился к столу на позицию ${position}.`);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

//Встать из стола
exports.leave = async (req, res) => {
  const player = req.body.player;
  try {
    await User.findOneAndDelete({ name: player });
    res.status(200).send(`Игрок ${player} покинул стол.`);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Ошибка при удалении игрока", error: error.message });
  }
};

//Информация о столе
exports.getPlayers = async (req, res) => {
  try {
    const players = await User.find({});

    res.status(200).json(players);
  } catch (error) {
    res.status(500).json({
      message: "Ошибка при получении списка игроков",
      error: error.message,
    });
  }
};

//Обновление позиций
exports.updatePositions = async (req, res) => {
  try {
    const players = await User.find({});

    await User.updateOne({ position: 3 }, { $set: { currentPlayerId: false } });

    for (let player of players) {
      player.position = player.position === 1 ? 6 : player.position - 1;
      await player.save();
    }

    await User.updateOne({ position: 3 }, { $set: { currentPlayerId: true } });

    res.status(200).json("Позиции игроков успешно обновлены.");
  } catch (error) {
    res.status(500).json({
      message: "Ошибка при обновлении позиций игроков",
      error: error.message,
    });
  }
};

//Вычитание малого и большого блаинда у первых двух позиций
exports.mbBB = async (req, res) => {
  try {
    await User.updateOne({ position: 1 }, { $inc: { stack: -50 } });
    await User.updateOne({ position: 2 }, { $inc: { stack: -100 } });
    res.status(200).json({ message: "Stack values updated successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

//Начало раунда торгов с третьей позиции
exports.sequenceOfMoves = async (req, res) => {
  try {
    const updatedUser = await User.findOneAndUpdate(
      { position: 3 }, // Фильтр для поиска пользователя на третьей позиции
      { $set: { currentPlayerId: true } }, // Обновление поля currentPlayerId на true
      { new: true } // Возвращаем обновленный документ
    );
    if (!updatedUser) {
      return res.status(401).json("Игрок не найден");
    }
    await updatedUser.save();

    res
      .status(200)
      .json({ message: "Торги начинаются с 3 позиции", updatedUser });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Передача слова следующему игроку
exports.nextTurnPlayer = async (req, res) => {
  try {
    const playerTurn = await User.findOne({ currentPlayerId: true });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
