const User = require("../models/modelUser");
const Room = require("../models/room");
const { Hand } = require("pokersolver");
const suits = ["♥", "♠", "♦", "♣"];
const values = [
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
  "A",
];
const tableCards = [];
const deckWithoutPlayerCards = [];
const playerCards = [];

// Функция для перемешивания карт в колоде
function shuffleDeck() {
  const deck = [];
  suits.forEach((suit) => {
    values.forEach((value) => {
      deck.push({ value, suit });
    });
  });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  return deck;
}

// Функция для раздачи двух карт каждому игроку
function dealCards(deck, players) {
  playerCards.length = 0;
  for (let i = 0; i < players.length; i++) {
    const cards = [deck.pop(), deck.pop()];
    playerCards.push({ playerId: players[i]._id, cards });
  }
  while (deck.length > 0) {
    deckWithoutPlayerCards.push(deck.pop());
  }
  return playerCards;
}

// Раздача карт игрокам
exports.deal = async (req, res) => {
  try {
    const players = await User.find({});
    const deck = shuffleDeck();
    const playerCards = dealCards(deck, players);
    await Promise.all(
      playerCards.map(async (playerCard) => {
        await User.updateOne(
          { _id: playerCard.playerId },
          { $set: { cards: playerCard.cards } }
        );
      })
    );
    res.status(200).json("Карты успешно разданы");
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Функция для раздачи трех карт (флопа)
function dealFlopCards() {
  for (let i = 0; i < 3; i++) {
    tableCards.push(deckWithoutPlayerCards.pop());
  }
  return tableCards;
}

//Функция выдачи 1 карты на флоп
function dealTernCard() {
  for (let i = 0; i < 1; i++) {
    tableCards.push(deckWithoutPlayerCards.pop());
  }
  return tableCards;
}
//Функция выдачи 1 карты на флоп
function dealRiverCard() {
  for (let i = 0; i < 1; i++) {
    tableCards.push(deckWithoutPlayerCards.pop());
  }
  return tableCards;
}

function clearFlop() {
  return (tableCards.length = 0);
}

//Выдача флопа
exports.dealFlopCards = async (req, res) => {
  try {
    const players = await User.find({ fold: false });
    await User.updateMany({}, { $set: { makeTurn: false } });
    clearFlop();
    const flopCards = dealFlopCards();

    await User.updateMany({}, { lastBet: 0 });

    const bbPlayer = await User.findOne({ position: 2 });
    if (!bbPlayer) {
      return res
        .status(404)
        .json({ message: `Игрок на большом блаинде не найден` });
    }

    const minPlayer = players.reduce((minPlayer, currentPlayer) => {
      return currentPlayer.position < minPlayer.position
        ? currentPlayer
        : minPlayer;
    });

    const lastCurrentPlayerId = players.find((player) => {
      return player.currentPlayerId === true;
    });

    if (!lastCurrentPlayerId) {
      return res.status(400).json({ message: "Последний игрок не найден" });
    }

    await User.updateOne({ _id: bbPlayer._id }, { preflopEnd: false });

    await User.updateOne(
      { _id: lastCurrentPlayerId._id },
      { $set: { currentPlayerId: false } }
    );

    await User.updateOne(
      { _id: minPlayer._id },
      { $set: { currentPlayerId: true } }
    );

    await User.updateMany({}, { roundStage: "flop" });
    res.status(200).json({ flopCards });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

//Tern
exports.turn = async (req, res) => {
  try {
    if (tableCards === 4) {
      res.status(400).json("Карта уже раздана");
    }
    const turnCards = dealTernCard();

    const players = await User.find({ fold: false });
    const bbPlayer = await User.findOne({ position: 2 });
    await User.updateMany({}, { lastBet: 0 });
    if (!bbPlayer) {
      return res.status(404).json({ message: `Игрок ${bbPlayer} не найден` });
    }
    const minPlayer = players.reduce((minPlayer, currentPlayer) => {
      return currentPlayer.position < minPlayer.position
        ? currentPlayer
        : minPlayer;
    });
    const lastCurrentPlayerId = players.find((player) => {
      return player.currentPlayerId === true;
    });
    await User.updateOne({ _id: bbPlayer._id }, { flopEnd: false });

    await User.updateOne(
      { name: lastCurrentPlayerId.name },
      { $set: { currentPlayerId: false } }
    );

    await User.updateOne(
      { name: minPlayer.name },
      { $set: { currentPlayerId: true } }
    );
    await User.updateMany({}, { $set: { makeTurn: false } });
    await User.updateMany({}, { roundStage: "turn" });
    console.log(JSON.stringify(turnCards));
    res.status(200).json({ turnCards });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

//river
exports.river = async (req, res) => {
  try {
    const players = await User.find({ fold: false });
    await User.updateMany({}, { $set: { makeTurn: false } });
    await User.updateMany({}, { lastBet: 0 });
    const riverCards = dealRiverCard();
    const bbPlayer = await User.findOne({ position: 2 });

    if (!bbPlayer) {
      return res.status(404).json({ message: `Игрок ${bbPlayer} не найден` });
    }
    const minPlayer = players.reduce((minPlayer, currentPlayer) => {
      return currentPlayer.position < minPlayer.position
        ? currentPlayer
        : minPlayer;
    });
    const lastCurrentPlayerId = players.find((player) => {
      return player.currentPlayerId === true;
    });

    await User.updateOne(
      { name: lastCurrentPlayerId.name },
      { $set: { currentPlayerId: false } }
    );

    await User.updateOne(
      { name: minPlayer.name },
      { $set: { currentPlayerId: true } }
    );
    await User.updateOne({ _id: bbPlayer._id }, { ternEnd: false });

    await User.updateMany({}, { roundStage: "river" });
    res.status(200).json({ riverCards });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Определение победителя
exports.findWinner = async (req, res) => {
  try {
    const players = await User.find({ fold: false, roundStage: "river" });
    await User.updateMany({}, { $set: { makeTurn: false } });
    const communityCards = flopCards;
    const hands = players.map((player) => {
      const playerCards = player.cards.map(
        (card) => `${card.value}${card.suit}`
      );
      const allCards = [
        ...playerCards,
        ...communityCards.map((card) => `${card.value}${card.suit}`),
      ];
      return {
        player: player.name,
        hand: Hand.solve(allCards),
      };
    });

    const winningHand = Hand.winners(hands.map((h) => h.hand));
    let winnerSum = 0;

    const playersInRound = await User.find({});
    playersInRound.forEach((item) => {
      winnerSum +=
        item.preFlopLastBet +
        item.flopLastBet +
        item.turnLastBet +
        item.riverLastBet;
    });

    const winners = hands
      .filter((h) => winningHand.includes(h.hand))
      .map((h) => h.player);

    for (const winner of winners) {
      const winnerPlayer = await User.findOne({ name: winner });
      if (winnerPlayer) {
        winnerPlayer.stack += winnerSum;
        await winnerPlayer.save();
      }
    }
    await User.updateMany({}, { lastBet: 0 });
    res.status(200).json({ winners, winnerSum });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Сесть за стол
exports.join = async (req, res) => {
  const { player, position, stack, roomId } = req.body;
  try {
    // Проверяем, не сидит ли игрок уже в другой комнате
    const existingPlayerInOtherRoom = await User.findOne({
      name: player,
      roomId: { $ne: roomId },
    });
    if (existingPlayerInOtherRoom) {
      // Удаляем игрока из предыдущей комнаты
      await Room.updateOne(
        { _id: existingPlayerInOtherRoom.roomId },
        { $pull: { users: existingPlayerInOtherRoom._id } }
      );
      existingPlayerInOtherRoom.roomId = null;
      await existingPlayerInOtherRoom.save();
    }

    // Проверяем, не сидит ли игрок уже за столом в текущей комнате
    const existingPlayer = await User.findOne({ name: player, roomId: roomId });
    if (existingPlayer) {
      return res.status(400).json("Такой игрок уже сидит за столом");
    }

    // Проверяем, не занята ли позиция
    const positionPlayer = await User.findOne({
      position: position,
      roomId: roomId,
    });
    if (positionPlayer) {
      return res.status(400).json("Это место на столе уже занято");
    }

    // Создаем нового игрока
    const newPlayer = new User({
      name: player,
      position,
      stack,
      roomId: roomId,
    });
    await newPlayer.save();

    // Добавляем игрока в новую комнату
    await Room.updateOne(
      { _id: roomId },
      { $addToSet: { users: newPlayer._id } }
    );

    // Логика ставок и обновления состояния игрока в зависимости от позиции
    if (position === 1 || position === 2) {
      await User.updateOne(
        { _id: newPlayer._id },
        {
          $inc: { stack: -(25 * position) },
          $set: {
            preFlopLastBet: 25 * position,
            lastBet: 25 * position,
           /*  makeTurn: true, */
          },
        }
      );
    }

    if (position === 3) {
      await User.updateMany(
        { position: 3, roomId: roomId },
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

// Встать из стола
exports.leave = async (req, res) => {
  const { player, roomId } = req.body;
  try {
    // Находим игрока по имени и roomId
    const user = await User.findOne({ name: player, roomId: roomId });
    if (!user) {
      return res
        .status(404)
        .json(`Игрок ${player} не найден в комнате ${roomId}.`);
    }

    // Удаляем игрока из комнаты
    await Room.updateOne({ _id: roomId }, { $pull: { users: user._id } });

    // Удаляем игрока из базы данных
    await User.findOneAndDelete({ _id: user._id });

    res.status(200).send(`Игрок ${player} покинул стол в комнате ${roomId}.`);
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

// Обновление позиций
exports.updatePositions = async (req, res) => {
  try {
    const players = await User.find({});

    await User.updateMany(
      {},
      {
        $set: {
          lastBet: 0,
          preFlopLastBet: 0,
          flopLastBet: 0,
          turnLastBet: 0,
          riverLastBet: 0,
        },
      }
    );

    await User.updateOne({ position: 3 }, { $set: { currentPlayerId: false } });

    for (let player of players) {
      player.position = player.position === 1 ? 6 : player.position - 1;
      await player.save();
    }

    await User.updateOne({ position: 3 }, { $set: { currentPlayerId: true } });
    const bbPlayer = await User.findOne({ position: 2 });
    if (!bbPlayer) {
      return res.status(404).json({ message: `Игрок ${bbPlayer} не найден` });
    }
    await User.updateOne({ _id: bbPlayer._id }, { riverEnd: false });

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
    const mbBet = await User.updateOne(
      { position: 1 },
      { $inc: { stack: -25 } }
    );
    const bBBet = await User.updateOne(
      { position: 2 },
      { $inc: { stack: -50 } }
    );

    res.status(200).json({
      message: `Малый ${mbBet.stack} и большой блаинд ${bBBet.stack} высчитались из первой и второй позиции`,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

//Поднимаем ставку
exports.raise = async (req, res) => {
  try {
    const { name, raiseAmount } = req.body;

    const player = await User.findOne({ name });

    await User.updateOne({ _id: player._id }, { $set: { makeTurn: true } });

    if (!player) {
      return res.status(404).json(`Игрок ${name} не найден`);
    }

    if (player.stack < raiseAmount) {
      return res
        .status(400)
        .json({ message: "Недостаточно средств для рейза" });
    }

    let updateData = {
      $inc: { stack: -raiseAmount },
      $set: {},
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

    await User.updateOne({ name }, updateData);

    res.status(200).json({ message: "Ставка рейза успешно выполнена" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

//Сбрасываем карты
exports.fold = async (req, res) => {
  try {
    const { name } = req.body;

    const player = await User.findOne({ name });
    await User.updateOne({ _id: player._id }, { $set: { makeTurn: true } });

    if (!player) {
      return res.status(404).json({ message: "Игрок не найден" });
    }

    await User.updateOne({ _id: player._id }, { fold: true });

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
    await User.updateOne({ _id: player._id }, { $set: { makeTurn: true } });
    const players = await User.find({});

    if (!player) {
      return res.status(404).json({ message: "Юзер не найден" });
    }
    if (players.length === 0) {
      return res.status(404).json({ message: "Юзеры не найдены" });
    }

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
