const User = require("../models/modelUser");
const Round = require("../models/modelRound");

// Сесть за стол
exports.join = async (req, res) => {
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

//Поднимаем ставку
exports.raise = async (req, res) => {
  try {
    const { name, raiseAmount } = req.body;

    const player = await User.findOne({ name });

    if (!player) {
      return res.status(404).json(`Игрок ${name} не найден`);
    }

    if (player.stack < raiseAmount) {
      return res
        .status(400)
        .json({ message: "Недостаточно средств для рейза" });
    }

    await User.updateOne({ name }, { $inc: { stack: -raiseAmount } });

    res.status(200).json({ message: "Ставка рейза успешно выполнена" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

//Сбрасываем карты
exports.fold = async (req, res) => {
  try {
    const { name } = req.body;

    // Находим игрока по имени
    const player = await User.findOne({ name });

    if (!player) {
      return res.status(404).json({ message: "Игрок не найден" });
    }

    // Устанавливаем поле fold игрока в true
    await User.updateOne({ _id: player._id }, { fold: true });

    res.status(200).json({ message: `Игрок ${name} пропустил ход` });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Передача слова следующему игроку
exports.nextTurnPlayer = async (req, res) => {
  try {
    // Шаг 1: Найти текущего игрока
    const currentTurn = await User.findOne({ currentPlayerId: true });

    if (!currentTurn) {
      return res.status(404).json({ message: "Текущий игрок не найден" });
    }

    // Шаг 2: Снять currentPlayerId с текущего игрока
    await User.updateOne({ _id: currentTurn._id }, { currentPlayerId: false });

    // Шаг 3: Найти следующего игрока
    let nextTurn;

    // Проверяем, находится ли текущий игрок на последней позиции
    if (currentTurn.position === 6) {
      // Если текущий игрок на последней позиции, переходим к первому игроку
      nextTurn = await User.findOne({
        position: 1,
        currentPlayerId: false,
        fold: false,
      });

      res.status(200).json("OK");
    } else {
      // Иначе ищем следующего игрока с позицией больше текущей
      nextTurn = await User.findOne({
        position: { $gt: currentTurn.position },
        currentPlayerId: false,
        fold: false,
      });
    }

    if (!nextTurn) {
      return res.status(404).json({ message: "Следующий игрок не найден" });
    }

    // Шаг 4: Установить следующему игроку currentPlayerId: true
    await User.updateOne({ _id: nextTurn._id }, { currentPlayerId: true });

    // Шаг 5: Отправить ответ
    res.json({
      message: `Ход передан следующему игроку ${currentTurn.name}`,
      nextPlayer: nextTurn,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
