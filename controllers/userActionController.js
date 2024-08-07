const User = require("../models/modelUser");
const Room = require("../models/modelRoom");

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
    const bB = 50;
    const lastBigBet = players.reduce((minBet, currentLastBet) => {
      return currentLastBet.lastBet > minBet.lastBet ? currentLastBet : minBet;
    });
    //минимальный рейз lastBet+bb
    const minRaise = lastBigBet.lastBet + bB;
    //если сумма рейза меньше минимальный рейз выходить из функции
    if (raiseAmount < minRaise) {
      return;
    }
    //если игрок не найден возвращаем ошибку
    if (!player) {
      return res.status(404).json(`Игрок ${name} не найден`);
    }
    //если стак игрока меньше суммы рейза возвращаем ошибку
    if (raiseAmount)
      if (player.stack + player.lastBet < raiseAmount) {
        return res
          .status(400)
          .json({ message: "Недостаточно средств для рейза" });
      }

    let updateData = {
      $inc: { stack: -raiseAmount },
      $set: { makeTurn: true },
    };

    const additionalStack =
      player.position === 1 ? 25 : player.position === 2 ? 50 : 0;

    const currentRoundStage = player.roundStage;
    switch (currentRoundStage) {
      case "preflop":
        // Вычитает уже поставленные блайнды из суммы raiseAmount и сохраняет результат в preFlopLastBet
        updateData.$inc.preFlopLastBet = raiseAmount - additionalStack;

        // Если игрок на позиции малого блайнда (position === 1), возвращает ему поставленный малый блайнд (25)
        if (player.position === 1) {
          updateData.$inc.stack = (updateData.$inc.stack || 0) + 25;
        }
        // Если игрок на позиции большого блайнда (position === 2), возвращает ему поставленный большой блайнд (50)
        else if (player.position === 2) {
          updateData.$inc.stack = (updateData.$inc.stack || 0) + 50;
        }

        // Устанавливает значение последней ставки игрока в raiseAmount
        updateData.$set.lastBet = raiseAmount;
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

    await User.updateOne({ _id: player._id }, updateData);

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
    const lastBigBet = players.reduce((minBet, currentLastBet) => {
      return currentLastBet.lastBet > minBet.lastBet ? currentLastBet : minBet;
    });

    if (!player) {
      return res.status(404).json({ message: "Юзер не найден" });
    }
    if (players.length === 0) {
      return res.status(404).json({ message: "Юзеры не найдены" });
    }

    await User.updateOne({ _id: player._id }, { $set: { makeTurn: true } });

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

    if (bet < lastBigBet) {
      return;
    }

    if (bet === 0) {
      return res
        .status(400)
        .json({ message: "Нет предыдущих ставок для колла" });
    }

    const callAmount = bet - player.lastBet;

    if (callAmount === 0) {
      return res.status(200).json("Игрок уже уровнял самую большую ставку");
    }

    let actualCallAmount = callAmount;
    if (player.stack < callAmount) {
      actualCallAmount = player.stack;
    }

    let updateField = {};
    if (currentRoundStage === "preflop") {
      updateField = { preFlopLastBet: player.lastBet + actualCallAmount };
    } else if (currentRoundStage === "flop") {
      updateField = { flopLastBet: player.lastBet + actualCallAmount };
    } else if (currentRoundStage === "turn") {
      updateField = { turnLastBet: player.lastBet + actualCallAmount };
    } else if (currentRoundStage === "river") {
      updateField = { riverLastBet: player.lastBet + actualCallAmount };
    }

    await User.updateOne(
      { _id: player._id },
      {
        $inc: { stack: -actualCallAmount },
        $set: {
          lastBet: player.lastBet + actualCallAmount,
          ...updateField,
        },
      }
    );

    const updatedPlayer = await User.findById(player._id).lean();
    if (updatedPlayer.stack === 0) {
      await User.updateOne({ _id: player._id }, { $set: { allIn: true } });
    } else if (allInPlayers.length > 0 && player.stack >= actualCallAmount) {
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
