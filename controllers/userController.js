const User = require("../models/modelUser");
const Room = require("../models/room");

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

// Встать из стола
exports.leave = async (req, res) => {
  const { player, roomId } = req.body;
  try {
    const user = await User.findOne({ name: player, roomId: roomId });
    if (!user) {
      return res
        .status(404)
        .json(`Игрок ${player} не найден в комнате ${roomId}.`);
    }

    await Room.updateOne({ _id: roomId }, { $pull: { users: user._id } });

    await User.findOneAndDelete({ _id: user._id });

    res.status(200).send(`Игрок ${player} покинул стол в комнате ${roomId}.`);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Ошибка при удалении игрока", error: error.message });
  }
};

// Поднимаем ставку
exports.raise = async (req, res) => {
  try {
    const { name, raiseAmount } = req.body;
    const players = await User.find({});
    const player = await User.findOne({ name });
    const lastBitBet = players.reduce((minBet, currentLastBet) => {
      return currentLastBet.lastBet > minBet.lastBet ? currentLastBet : minBet;
    });

    if (raiseAmount <= lastBitBet) {
      return res.status(404).json(`Невозможно сделать рейз с такой суммой`);
    }
    if (!player) {
      return res.status(404).json(`Игрок ${name} не найден`);
    }
    if (raiseAmount)
      if (player.stack < raiseAmount) {
        return res
          .status(400)
          .json({ message: "Недостаточно средств для рейза" });
      }

    let updateData = {
      $inc: { stack: -raiseAmount },
      $set: { makeTurn: true },
    };

    const currentRoundStage = player.roundStage;
    switch (currentRoundStage) {
      case "preflop":
        updateData.$inc.preFlopLastBet = raiseAmount;
        updateData.$set.lastBet = (player.preFlopLastBet || 0) + raiseAmount;
        break;
      case "flop":
        updateData.$inc.flopLastBet = raiseAmount;
        updateData.$set.lastBet = (player.flopLastBet || 0) + raiseAmount;
        break;
      case "turn":
        updateData.$inc.turnLastBet = raiseAmount;
        updateData.$set.lastBet = (player.turnLastBet || 0) + raiseAmount;
        break;
      case "river":
        updateData.$inc.riverLastBet = raiseAmount;
        updateData.$set.lastBet = (player.riverLastBet || 0) + raiseAmount;
        break;
      default:
        return res.status(400).json({ message: "Неизвестная стадия игры" });
    }

    // Обновляем основные данные игрока
    await User.updateOne({ _id: player._id }, updateData);

    // Проверяем стек игрока после обновления
    const updatedPlayer = await User.findById(player._id).lean();
    if (updatedPlayer.stack === 0) {
      await User.updateOne(
        { _id: player._id },
        { $set: { allIn: true, makeTurn: true } }
      );
    }

    res.status(200).json({ message: "Ставка рейза успешно выполнена" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Сбрасываем карты
exports.fold = async (req, res) => {
  try {
    const { name } = req.body;
    const player = await User.findOne({ name });
    if (!player) {
      return res.status(404).json({ message: "Игрок не найден" });
    }

    const players = await User.find({});

    const allInPlayer = players.find((p) => p.allIn);
    if (allInPlayer) {
      await User.updateOne(
        { _id: player._id },
        { $set: { fold: true, allIn: false, makeTurn: true } }
      );
    } else {
      await User.updateOne(
        { _id: player._id },
        { $set: { fold: true, makeTurn: true } }
      );
    }
    res.status(200).json({ message: `Игрок ${name} пропустил ход` });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

//Чекаем
exports.check = async (req, res) => {
  try {
    const { name } = req.body;
    const player = await User.findOne({ name });
    await User.updateOne({ _id: player._id }, { $set: { makeTurn: true } });
    if (!player) {
      return res.status(404).json({ message: `Игрок ${name} не найден` });
    }
    const lastBigBetUser = await User.findOne({}).sort({ lastBet: -1 });

    if (lastBigBetUser.lastBet !== player.lastBet) {
      return res.status(404).json({ message: `Невозможно сделать чек` });
    }

    res.status(200).json({ message: `Игрок ${player.name} сделал чек` });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Коллируем в зависимости от стадии игры
exports.coll = async (req, res) => {
  try {
    const { name } = req.body;
    const player = await User.findOne({ name });
    const players = await User.find({});
    await User.updateOne({ _id: player._id }, { $set: { makeTurn: true } });

    if (!player) {
      return res.status(404).json({ message: "Юзер не найден" });
    }
    if (players.length === 0) {
      return res.status(404).json({ message: "Юзеры не найдены" });
    }

    const allInPlayers = players.filter((p) => p.allIn === true);

    const currentRoundStage = player.roundStage;

    const maxPreflopLastBet = players.reduce((a, b) =>
      a.preFlopLastBet > b.preFlopLastBet ? a : b
    );
    const maxFlopLastBet = players.reduce((a, b) =>
      a.flopLastBet > b.flopLastBet ? a : b
    );
    const maxTurnLastBet = players.reduce((a, b) =>
      a.turnLastBet > b.turnLastBet ? a : b
    );
    const maxRiverLastBet = players.reduce((a, b) =>
      a.riverLastBet > b.riverLastBet ? a : b
    );

    let bet;
    if (currentRoundStage === "preflop") {
      bet = maxPreflopLastBet.preFlopLastBet;
    } else if (currentRoundStage === "flop") {
      bet = maxFlopLastBet.flopLastBet;
    } else if (currentRoundStage === "turn") {
      bet = maxTurnLastBet.turnLastBet;
    } else if (currentRoundStage === "river") {
      bet = maxRiverLastBet.riverLastBet;
    } else {
      return res.status(400).json({ message: "Неверная стадия игры" });
    }

    if (bet === 0) {
      return res
        .status(400)
        .json({ message: "Нет предыдущих ставок для колла" });
    }

    const callAmount = bet - player.lastBet;

    if (player.stack < callAmount) {
      return res.status(400).json({
        message: `У ${player.name} недостаточно фишек для этого колла`,
      });
    }

    if (callAmount === 0) {
      return res.status(200).json("Игрок уже уровнял самую большую ставку");
    }

    let updateField = {};
    if (currentRoundStage === "preflop") {
      updateField = { preFlopLastBet: bet };
    } else if (currentRoundStage === "flop") {
      updateField = { flopLastBet: bet };
    } else if (currentRoundStage === "turn") {
      updateField = { turnLastBet: bet };
    } else if (currentRoundStage === "river") {
      updateField = { riverLastBet: bet };
    }

    await User.updateOne(
      { _id: player._id },
      {
        $inc: { stack: -callAmount },
        $set: {
          lastBet: player.lastBet + callAmount,
          ...updateField,
        },
      }
    );

    const updatedPlayer = await User.findById(player._id).lean();
    if (updatedPlayer.stack === 0) {
      await User.updateOne({ _id: player._id }, { $set: { allIn: true } });
    } else if (allInPlayers.length > 0 && player.stack >= callAmount) {
      await User.updateOne({ _id: player._id }, { $set: { allInColl: true } });
    }

    res.status(200).json("OK");
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

//Передача хода следующему активному игроку
exports.nextTurnPlayer = async (req, res) => {
  try {
    const players = await User.find({ fold: false }).sort({ position: 1 });

    const currentTurn = await User.findOne({ currentPlayerId: true });

    if (!currentTurn) {
      return res.status(404).json({ message: "Текущий игрок не найден" });
    }

    await User.updateOne({ _id: currentTurn._id }, { currentPlayerId: false });

    let nextTurn;

    const playerMaxPosition = players[0];

    if (currentTurn.position === playerMaxPosition.position) {
      const nextPlayers = players.filter(
        (player) => player.position > currentTurn.position
      );
      nextTurn = nextPlayers.find((player) => !player.fold);
    } else {
      nextTurn = players.find(
        (player) => player.position > currentTurn.position && !player.fold
      );

      if (!nextTurn) {
        nextTurn = players.find((player) => !player.fold);
      }
    }

    if (!nextTurn) {
      return res.status(404).json({ message: "Следующий игрок не найден" });
    }

    await User.updateOne({ _id: nextTurn._id }, { currentPlayerId: true });

    res.status(200).json({
      message: `Ход передан следующему игроку ${currentTurn.name}`,
      nextPlayer: nextTurn,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
