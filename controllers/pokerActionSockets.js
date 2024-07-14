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

  //Функция перемешивания карт
  const shuffleDeck = async () => {
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
  };

  const dealCards = async (deck, players) => {
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
  };

  //Очистка карт на столе
  async function clearTable() {
    return (tableCards.length = 0);
  }

  // Функция для раздачи трех карт (флопа)
  async function dealFlopCards() {
    tableCards.push(deckWithoutPlayerCards.pop());
    tableCards.push(deckWithoutPlayerCards.pop());
    tableCards.push(deckWithoutPlayerCards.pop());
  }
  // Функция для раздачи одной карты (терна,ривера)
  async function dealOneCard() {
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

  //ТРИГГЕР ФЛОПА
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
          if (!isDealingFlopCard) {
            console.log(
              `ВЫЗЫВАЕМ giveFlop в позиции ${JSON.stringify(isTrueFlopCard)}`
            );
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
  //ВЫДАЧА ФЛОПА
  async function dealFlopCard(roomId) {
    if (tableCards.length >= 3) {
      return;
    }
    if (isDealingFlopCard) {
      return;
    }

    isDealingFlopCard = true;

    try {
      await User.updateMany(
        { roomId: roomId },
        { $set: { currentPlayerId: false } }
      );
      const players = await User.find({ fold: false, roomId: roomId });
      await clearTable();
      await dealFlopCards();

      const lastCurrentPlayer = players.find(
        (player) => player.currentPlayerId === true
      );

      if (lastCurrentPlayer) {
        await User.updateOne(
          { _id: lastCurrentPlayer._id },
          { $set: { currentPlayerId: false } }
        );
      }

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
      io.emit("dealError", {
        message: "Ошибка при получении списка игроков",
        error: error.message,
      });
      console.error("Error in dealFlopCard event:", error);
    } finally {
      isDealingFlopCard = false;
      console.log(`Сбрасываем isDealingFlopCard в finally блоке`);
    }
  }

  async function handleGiveFlop(roomId) {
    const shouldDealFlop = await giveFlop(roomId);
    if (shouldDealFlop) {
      const delayedFunction = async () => {
        await dealFlopCard(roomId);
      };
      setTimeout(async () => {
        await delayedFunction();
      }, 1000);
    }
  }

  let isTrueTurnCard = false;
  let isDealingTurnCard = false;
  //ТРИГГЕР ТЕРНА
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
            `ВЫЗЫВАЕМ giveTurn в позиции ${JSON.stringify(isTrueTurnCard)}`
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
      await dealOneCard();

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
      const delayedFunction = async () => {
        await dealTurnCard(roomId);
      };

      setTimeout(async () => {
        await delayedFunction();
      }, 1000);
    }
  }

  let isTrueRiverCard = false;
  let isDealingRiverCard = false;
  //ТРИГГЕР РИВЕР
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
          `ВЫЗЫВАЕМ giveRiver в позиции ${JSON.stringify(isTrueRiverCard)}`
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

  //ВЫДАЧА РИВЕРА
  async function dealRiver(roomId) {
    if (tableCards.length >= 5) {
      return;
    }
    if (isDealingRiverCard) {
      return;
    }
    isDealingRiverCard = true;
    try {
      await dealOneCard();
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
      const delayedFunction = async () => {
        await dealRiver(roomId);
      };
      setTimeout(async () => {
        await delayedFunction();
      });
    }
  }

  //НАЧАЛО НОВОГО РАУНДА
  let newRoundBlocker = false;
  async function startNewRound(roomId) {
    if (newRoundBlocker) {
      return;
    }
    newRoundBlocker = true;
    try {
      await User.updateMany(
        { roomId: roomId },
        {
          $set: {
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
      console.log("Начинаем новый раунд");
      clearTable();
      io.emit("startNewRound", "Начинаем новый раунд");
    } catch (error) {
      console.error(error);
    } finally {
      newRoundBlocker = false;
    }
  }

  // ТРИГГЕР ОБНОВЛЕНИЯ ПОЗИЦИЙ НАЧАЛА НОВОГО РАУНДА
  let updatePositionTriggerBlocker = false;
  let repeateUpdatePosBlock = false;

  async function updatePositionTrigger(roomId) {
    if (updatePositionTriggerBlocker) {
      return;
    }
    updatePositionTriggerBlocker = true;

    try {
      const players = await User.find({ roomId: roomId });

      if (players.length === 0) {
        updatePositionTriggerBlocker = false;
        return false;
      }

      const activePlayers = players.filter((player) => player.fold === false);

      if (
        activePlayers.length === 1 &&
        ["flop", "turn", "river"].includes(activePlayers[0].roundStage)
      ) {
        console.log("updatePositionTrigger вернул true");
        updatePositionTriggerBlocker = false;
        return true;
      }

      const roundStage = players.every(
        (player) => player.roundStage === "river"
      );

      if (roundStage) {
        const turnPlayers = players.filter(
          (player) => player.fold === false && player.roundStage === "river"
        );

        if (turnPlayers.length === 0) {
          updatePositionTriggerBlocker = false;
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

        updatePositionTriggerBlocker = false;
        return allSameMaxBet;
      }
    } catch (error) {
      console.error("Error in updatePositionTrigger event:", error);
    } finally {
      updatePositionTriggerBlocker = false;
    }
  }

  //ОБНОВЛЕНИЕ ПОЗИЦИЙ НАЧАЛА НОВОГО РАУНДА

  async function updatePos(roomId) {
    if (repeateUpdatePosBlock) {
      return;
    }
    repeateUpdatePosBlock = true;
    try {
      const players = await User.find({ roomId: roomId });

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

      clearTable();
      await startCardDistribution(roomId);
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

  // ОПРЕДЕЛЯЕМ ПОБЕДИТЕЛЯ
  let findWinnerBlocker = false;

  async function findWinnerRiver(roomId) {
    if (findWinnerBlocker) {
      return;
    }
    findWinnerBlocker = true;

    try {
      const players = await User.find({ roomId: roomId });

      if (players.length === 0) {
        throw new Error("No players found in the room");
      }

      let countFoldFalse = 0;
      let lastStandingPlayer = null;

      for (let player of players) {
        if (player.fold === false) {
          countFoldFalse++;
          lastStandingPlayer = player;
        }
      }

      if (countFoldFalse === 1 && lastStandingPlayer) {
        let totalBets = 0;
        players.forEach((player) => {
          totalBets +=
            player.preFlopLastBet +
            player.flopLastBet +
            player.turnLastBet +
            player.riverLastBet;
        });

        lastStandingPlayer.stack += totalBets;
        await lastStandingPlayer.save();

        console.log(
          `Победитель: ${lastStandingPlayer.name} выиграл ${totalBets}`
        );

        return { winners: [lastStandingPlayer.name], winnerSum: totalBets };
      }

      const activePlayers = players.filter((player) => player.fold === false);
      const communityCards = tableCards;
      const hands = activePlayers.map((player) => {
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
          totalBet:
            player.preFlopLastBet +
            player.flopLastBet +
            player.turnLastBet +
            player.riverLastBet,
        };
      });

      const winningHand = Hand.winners(hands.map((h) => h.hand));

      let totalBets = 0;
      players.forEach((player) => {
        totalBets +=
          player.preFlopLastBet +
          player.flopLastBet +
          player.turnLastBet +
          player.riverLastBet;
      });

      const winners = hands
        .filter((h) => winningHand.includes(h.hand))
        .map((h) => h.player);

      if (winners.length > 0) {
        const potSize = totalBets;
        const winningsPerWinner = potSize / winners.length;

        for (const winner of winners) {
          const winnerPlayer = await User.findOne({ name: winner });
          if (winnerPlayer) {
            winnerPlayer.stack += winningsPerWinner;
            await winnerPlayer.save();
          }
        }

        console.log(
          `Победитель: ${winners.join(", ")} выиграл ${winningsPerWinner}`
        );
        return { winners, winnerSum: potSize };
      } else {
        console.log(`Нет победителей`);
        return { winners: [], winnerSum: 0 };
      }
    } catch (error) {
      console.error(`Ошибка при определении победителя: ${error}`);
    } finally {
      findWinnerBlocker = false;
    }
  }

  io.on("connection", (socket) => {
    console.log("New client connected");
    socket.on("getPlayers", async (roomId) => {
      try {
        const players = await User.find({ roomId: roomId });
        await handleGiveFlop(roomId);
        await handleGiveTurn(roomId);
        await handleGiveRiver(roomId);
        const updatePosition = await updatePositionTrigger(roomId);
        gameState.updatePosition = updatePosition;

        if (gameState.updatePosition) {
          await findWinnerRiver(roomId);
          await updatePos(roomId);
        }
        if (players.length === 0) {
          io.emit("clearTableCards");
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
          await startNewRound(roomId);
          await startCardDistribution(roomId);
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
