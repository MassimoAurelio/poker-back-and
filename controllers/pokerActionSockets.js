const socketio = require("socket.io");
const User = require("../models/modelUser");
const { Hand } = require("pokersolver");
const Room = require("../models/room");

function initializeSocket(server) {
  const io = socketio(server, {
    cors: {
      origin: "http://localhost:3000",
      methods: ["GET", "POST"],
    },
  });

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

  let tableCards = [];
  const deckWithoutPlayerCards = [];
  const playerCards = [];
  const roomStates = {};
  let gameState = {
    shouldDealFlop: false,
    shouldDealTurn: false,
    shouldDealRiver: false,
    updatePosition: false,
  };

  // Функция для перемешивания карт в колоде
  async function shuffleDeck() {
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
  async function dealCards(deck, players) {
    playerCards.length = 0;
    deckWithoutPlayerCards.length = 0;

    for (let i = 0; i < players.length; i++) {
      const cards = [deck.pop(), deck.pop()];
      playerCards.push({ playerId: players[i]._id, cards });
    }

    while (deck.length > 0) {
      deckWithoutPlayerCards.push(deck.pop());
    }

    return playerCards;
  }

  async function clearFlop() {
    return (tableCards.length = 0);
  }

  // Функция для раздачи трех карт (флопа)
  async function dealFlopCards() {
    tableCards.push(deckWithoutPlayerCards.pop());
    tableCards.push(deckWithoutPlayerCards.pop());
    tableCards.push(deckWithoutPlayerCards.pop());
  }
  // Функция для раздачи одной карты (терна)
  async function dealTernCard() {
    tableCards.push(deckWithoutPlayerCards.pop());
  }

  // Функция для начала раздачи карт
  async function startCardDistribution(roomId) {
    try {
      const players = await User.find({ roomId: roomId });

      const emptyCards = players.every((player) => {
        return player.cards.length === 0;
      });

      if (!emptyCards) {
        return io.to(roomId).emit("dealError", {
          message: "Карты уже разданы",
        });
      }

      const deck = await shuffleDeck();

      const playerCards = await dealCards(deck, players);

      for (const { playerId, cards } of playerCards) {
        await User.updateOne({ _id: playerId }, { $set: { cards: cards } });
        io.to(playerId).emit("dealCards", cards);
      }

      console.log(`Раздаем карты ${roomId}, ${JSON.stringify(playerCards)}`);
      io.to(roomId).emit("dealSuccess", "Карты успешно разданы");
      if (roomStates[roomId]) {
        roomStates[roomId].playerCount = 0;
      }
    } catch (error) {
      console.error("Error during card dealing:", error.message);
      io.to(roomId).emit("dealError", {
        message: "Ошибка при раздаче карт",
        error: error.message,
      });
    }
  }

  let isTrueFlopCard = false;
  let isDealingFlopCard = false;

  async function giveFlop(roomId) {
    if (isTrueFlopCard) {
      return;
    }

    isTrueFlopCard = true;

    try {
      const players = await User.find({ roomId: roomId, fold: false });
      const activePlayers = players.filter(
        (player) =>
          player.fold === false &&
          player.roundStage === "preflop" &&
          player.makeTurn === true
      );

      const allMakeTurn = players.every((player) => player.makeTurn === true);
      if (!allMakeTurn) {
        return false;
      }

      if (activePlayers.length > 2) {
        const maxBet = activePlayers.reduce((maxSum, currentPlayer) =>
          maxSum.preFlopLastBet > currentPlayer.preFlopLastBet
            ? maxSum
            : currentPlayer
        );

        const allSameMaxBet = activePlayers.every(
          (player) => player.preFlopLastBet === maxBet.preFlopLastBet
        );
        if (allSameMaxBet) {
          console.log(
            `ВЫЗЫВАЕМ giveFlop в позиции ${JSON.stringify(isTrueFlopCard)}`
          );
          if (!isDealingFlopCard) {
            return true;
          }
        }
        return false;
      }
    } catch (error) {
      console.error("Error in giveFlop event:", error);
    } finally {
      isTrueFlopCard = false;
    }
  }

  async function dealFlopCard(roomId) {
    if (tableCards.length >= 3) {
      return;
    }
    if (isDealingFlopCard) {
      return;
    }

    isDealingFlopCard = true;

    try {
      const players = await User.find({ fold: false, roomId: roomId });
      await clearFlop();
      await dealFlopCards();

      const bbPlayer = await User.findOne({ position: 2 });
      await User.updateMany({}, { lastBet: 0 });

      if (!bbPlayer) {
        return io.emit("dealError", {
          message: `Игрок на большом блаинде не найден`,
        });
      }

      const minPlayer = players.reduce((minPlayer, currentPlayer) => {
        return currentPlayer.position < minPlayer.position
          ? currentPlayer
          : minPlayer;
      });

      const lastCurrentPlayer = players.find(
        (player) => player.currentPlayerId === true
      );

      if (lastCurrentPlayer) {
        await User.updateOne(
          { _id: lastCurrentPlayer._id },
          { $set: { currentPlayerId: false } }
        );
      }

      await User.updateOne(
        { _id: minPlayer._id },
        { $set: { currentPlayerId: true } }
      );

      await User.updateMany(
        {},
        { $set: { makeTurn: false, roundStage: "flop" } }
      );

      console.log(`FLOP: ${JSON.stringify(tableCards)}`);
      io.emit("dealFlop", { flop: { tableCards } });
    } catch (error) {
      console.error("Error in dealFlopCard event:", error);
    } finally {
      isDealingFlopCard = false;
    }
  }

  async function handleGiveFlop(roomId) {
    const shouldDealFlop = await giveFlop(roomId);
    if (shouldDealFlop) {
      await dealFlopCard(roomId);
    }
  }

  let isTrueTurnCard = false;
  let isDealingTurnCard = false;

  async function giveTurn(roomId) {
    if (isTrueTurnCard) {
      return;
    }
    isTrueTurnCard = true;
    try {
      const players = await User.find({ roomId: roomId, fold: false });
      const turnPlayers = players.filter(
        (player) => player.fold === false && player.roundStage === "flop"
      );
      const allMakeTurn = players.every((player) => player.makeTurn === true);

      if (!allMakeTurn) {
        return false;
      }

      if (turnPlayers.length > 2) {
        const maxBet = turnPlayers.reduce((maxSum, currentPlayer) =>
          maxSum.turnLastBet > currentPlayer.turnLastBet
            ? maxSum
            : currentPlayer
        );
        const allSameMaxBet = turnPlayers.every(
          (player) =>
            player.turnLastBet === maxBet.turnLastBet &&
            player.makeTurn === true
        );
        if (allSameMaxBet) {
          console.log(
            `ВЫЗЫВАЕМ giveFlop в позиции ${JSON.stringify(isTrueTurnCard)}`
          );
          if (!isDealingTurnCard) {
            return true;
          }
        }
        return false;
      }
    } catch (error) {
      console.error("Error in giveTurn event:", error);
    } finally {
      isTrueTurnCard = false;
    }
  }
  //ВЫДАЧА ТЕРНА
  async function dealTurnCard(roomId) {
    if (tableCards.length >= 4) {
      return;
    }

    if (isDealingTurnCard) {
      return;
    }
    isDealingTurnCard = true;
    try {
      const players = await User.find({ roomId: roomId, fold: false });
      await dealTernCard();

      const bbPlayer = await User.findOne({ position: 2 });
      await User.updateMany({}, { lastBet: 0 });

      if (!bbPlayer) {
        return io.emit("dealError", {
          message: `Игрок на большом блаинде не найден`,
        });
      }

      const minPlayer = players.reduce((minPlayer, currentPlayer) => {
        return currentPlayer.position < minPlayer.position
          ? currentPlayer
          : minPlayer;
      });

      const lastCurrentPlayer = players.find(
        (player) => player.currentPlayerId === true
      );

      if (lastCurrentPlayer) {
        await User.updateOne(
          { _id: lastCurrentPlayer._id },
          { $set: { currentPlayerId: false } }
        );
      }

      await User.updateOne(
        { _id: minPlayer._id },
        { $set: { currentPlayerId: true } }
      );
      await User.updateMany(
        {},
        { $set: { makeTurn: false, roundStage: "turn" } }
      );

      console.log(`TURN: ${JSON.stringify(tableCards)}`);
      io.emit("dealTurn", { flop: { tableCards } });
    } catch (error) {
      console.error("Error in dealTurn event:", error);
      io.emit("dealError", {
        message: "Ошибка при выдаче терна",
        error: error.message,
      });
    } finally {
      isDealingTurnCard = false;
    }
  }

  async function handleGiveTurn(roomId) {
    const shouldDealTurn = await giveTurn(roomId);
    if (shouldDealTurn) {
      await dealTurnCard(roomId);
    }
  }

  let isTrueRiverCard = false;
  let isDealingRiverCard = false;
  async function giveRiver(roomId) {
    if (isTrueRiverCard) {
      return;
    }
    isTrueRiverCard = true;
    try {
      const players = await User.find({ roomId: roomId, fold: false });
      const turnPlayers = players.filter(
        (player) => player.fold === false && player.roundStage === "turn"
      );

      if (turnPlayers.length === 0) {
        return false;
      }

      const maxBet = turnPlayers.reduce((maxSum, currentPlayer) =>
        maxSum.turnLastBet > currentPlayer.turnLastBet ? maxSum : currentPlayer
      );
      const allSameMaxBet = turnPlayers.every(
        (player) =>
          player.turnLastBet === maxBet.turnLastBet && player.makeTurn === true
      );

      if (allSameMaxBet) {
        console.log(
          `ВЫЗЫВАЕМ giveRiver в позиции ${JSON.stringify(isTrueFlopCard)}`
        );
        if (!isDealingRiverCard) {
          return true;
        }
      } else {
        return false;
      }
    } catch (error) {
      console.error("Error in dealTurn event:", error);
    } finally {
      isTrueRiverCard = false;
    }
  }

  async function dealRiver(roomId) {
    if (tableCards.length >= 5) {
      return;
    }
    if (isDealingRiverCard) {
      return;
    }
    isDealingRiverCard = true;
    try {
      await dealTernCard();
      const players = await User.find({ roomId: roomId, fold: false });
      const bbPlayer = await User.findOne({ position: 2 });
      await User.updateMany({}, { lastBet: 0 });

      if (!bbPlayer) {
        return io.emit("dealError", {
          message: `Игрок на большом блаинде не найден`,
        });
      }

      const minPlayer = players.reduce((minPlayer, currentPlayer) => {
        return currentPlayer.position < minPlayer.position
          ? currentPlayer
          : minPlayer;
      });

      const lastCurrentPlayer = players.find(
        (player) => player.currentPlayerId === true
      );

      if (lastCurrentPlayer) {
        await User.updateOne(
          { _id: lastCurrentPlayer._id },
          { $set: { currentPlayerId: false } }
        );
      }

      await User.updateOne(
        { _id: minPlayer._id },
        { $set: { currentPlayerId: true } }
      );

      await User.updateMany(
        {},
        { $set: { makeTurn: false, roundStage: "river" } }
      );

      console.log(`River: ${JSON.stringify(tableCards)}`);
      io.emit("dealRiver", { flop: { tableCards } });
    } catch (error) {
      console.error("Error in dealTurn event:", error);
      io.emit("dealError", {
        message: "Ошибка при выдаче терна",
        error: error.message,
      });
    } finally {
      isDealingRiverCard = false;
    }
  }

  async function handleGiveRiver(roomId) {
    const shouldDealRiver = await giveRiver(roomId);
    if (shouldDealRiver) {
      await dealRiver(roomId);
    }
  }

  let repeateUpdatePosBlock = false;
  async function updatePos(roomId) {
    try {
      const players = await User.find({ roomId: roomId });

      if (repeateUpdatePosBlock) {
        return;
      }
      repeateUpdatePosBlock = true;

      await User.updateMany(
        {},
        {
          $set: {
            lastBet: 0,
            preFlopLastBet: 0,
            flopLastBet: 0,
            turnLastBet: 0,
            riverLastBet: 0,
            fold: false,
            roundStage: "preflop",
            makeTurn: false,
            cards: [],
          },
        }
      );
      let highPositionPlayer = players.reduce((a, b) => {
        return a.position > b.position ? a : b;
      }, players[0]);

      let updatedPositions = {};
      for (let player of players) {
        updatedPositions[player._id] =
          player.position === highPositionPlayer.position
            ? 1
            : player.position + 1;
      }

      for (let [id, newPosition] of Object.entries(updatedPositions)) {
        await User.updateOne({ _id: id }, { position: newPosition });
      }

      await User.updateOne({ position: 1 }, { $inc: { stack: -25 } });
      await User.updateOne({ position: 2 }, { $inc: { stack: -50 } });
      await User.updateOne(
        { position: 1 },
        { $set: { lastBet: 25, preFlopLastBet: 25 } }
      );
      await User.updateOne(
        { position: 2 },
        { $set: { lastBet: 50, preFlopLastBet: 50 } }
      );

      await User.updateMany({}, { $set: { currentPlayerId: false } });

      await User.updateOne(
        { position: 3 },
        { $set: { currentPlayerId: true } }
      );

      console.log("Начинаем новый раунд");
      clearFlop();
      io.emit("updatePositions", "Позиции игроков успешно обновлены.");
      io.emit("clearTableCards");
    } catch (error) {
      console.error(error);
      io.emit("dealError", {
        message: "Ошибка при смене позиций игроков",
        error: error.message,
      });
    } finally {
      repeateUpdatePosBlock = false;
    }
  }

  let findWinnerTriggerBlocker = false;
  async function findWinnerTrigger(roomId) {
    if (findWinnerTriggerBlocker) {
      return;
    }
    findWinnerTriggerBlocker = true;
    try {
      const players = await User.find({ roomId: roomId });

      const turnPlayers = players.filter(
        (player) => player.fold === false && player.roundStage === "river"
      );

      if (turnPlayers.length === 0) {
        return false;
      }

      const maxBet = turnPlayers.reduce((maxSum, currentPlayer) =>
        maxSum.riverLastBet > currentPlayer.riverLastBet
          ? maxSum
          : currentPlayer
      );

      const allSameMaxBet = turnPlayers.every(
        (player) =>
          player.riverLastBet === maxBet.riverLastBet &&
          player.makeTurn === true
      );
      return allSameMaxBet;
    } catch (error) {
      console.error("Error in findWinner event:", error);
    } finally {
      findWinnerTriggerBlocker = false;
    }
  }

  io.on("connection", (socket) => {
    console.log("New client connected");
    //Информация о столе
    socket.on("getPlayers", async (roomId) => {
      try {
        const players = await User.find({ roomId: roomId });

        await handleGiveFlop(roomId);
        await handleGiveTurn(roomId);
        await handleGiveRiver(roomId);

        const updatePosition = await findWinnerTrigger(roomId);
        gameState.updatePosition = updatePosition;

        if (gameState.updatePosition) {
          await updatePos(roomId);
        }

        socket.emit("playersData", players);
      } catch (error) {
        socket.emit("getPlayersError", {
          message: "Ошибка при получении списка игроков",
          error: error.message,
        });
      }
    });

    // Обработка события подключения к комнате (join)
    socket.on("join", async (data) => {
      const { player, position, stack, roomId } = data;
      try {
        const existingPlayerInOtherRoom = await User.findOne({
          name: player,
          roomId: { $ne: roomId },
        });

        if (existingPlayerInOtherRoom) {
          await Room.updateOne(
            { _id: existingPlayerInOtherRoom.roomId },
            { $pull: { users: existingPlayerInOtherRoom._id } }
          );
          existingPlayerInOtherRoom.roomId = null;
          await existingPlayerInOtherRoom.save();
        }

        const existingPlayer = await User.findOne({
          name: player,
          roomId: roomId,
        });
        if (existingPlayer) {
          return socket.emit("joinError", "Такой игрок уже сидит за столом");
        }

        const positionPlayer = await User.findOne({
          position: position,
          roomId: roomId,
        });
        if (positionPlayer) {
          return socket.emit("joinError", "Это место на столе уже занято");
        }

        const newPlayer = new User({
          name: player,
          position,
          stack,
          roomId: roomId,
        });
        await newPlayer.save();

        await Room.updateOne(
          { _id: roomId },
          { $addToSet: { users: newPlayer._id } }
        );

        if (position === 3) {
          await User.updateMany(
            { position: 3, roomId: roomId },
            { $set: { currentPlayerId: true } }
          );
        }

        if (!roomStates[roomId]) {
          roomStates[roomId] = { playerCount: 0 };
        }
        roomStates[roomId].playerCount++;

        if (roomStates[roomId].playerCount === 3) {
          startCardDistribution(roomId);
        }

        if (position === 1 || position === 2) {
          await User.updateOne(
            { _id: newPlayer._id },
            {
              $inc: { stack: -(25 * position) },
              $set: {
                preFlopLastBet: 25 * position,
                lastBet: 25 * position,
              },
            }
          );
        }
        socket.emit(
          "joinSuccess",
          `Игрок ${player} присоединился к столу на позицию ${position}.`
        );
      } catch (error) {
        socket.emit("joinError", { message: error.message });
      }
    });

    // Функция для определения победителя
    async function findWinner(players) {
      const validPlayers = players.filter((player) =>
        Array.isArray(player.cards)
      );

      if (validPlayers.length === 0) {
        throw new Error("No valid players found");
      }

      const communityCards = tableCards;
      const hands = validPlayers.map((player) => {
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

      if (players.length === 1) {
        const lastPlayer = players[0];
        lastPlayer.stack += winnerSum;
        await lastPlayer.save();
        return { lastPlayer, winnerSum };
      } else {
        return { winners, winnerSum };
      }
    }

    socket.on("disconnect", () => {
      console.log("Client disconnected");
      for (const roomId of Object.keys(roomStates)) {
        if (roomStates[roomId].playerCount > 0) {
          roomStates[roomId].playerCount--;
        }
      }
    });
  });
}

module.exports = initializeSocket;
