const socketio = require("socket.io");
const User = require("../models/modelUser");
const { Hand } = require("pokersolver");
const Room = require("../models/room");
const { shuffleDeck, dealCards } = require("./deckUtils");
const { withBlocker } = require("./blockers");
const {
  dealFlopCards,
  dealOneCard,
  clearTable,
  setTableCards,
  setDeckCards,
} = require("./gameUtils");

function initializeSocket(server) {
  const io = socketio(server, {
    cors: {
      origin: "http://localhost:3000",
      methods: ["GET", "POST"],
    },
  });

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

  setTableCards(tableCards);
  setDeckCards(deckWithoutPlayerCards);

  function handleDealFlop() {
    dealFlopCards();
  }

  function handleDealOneCard() {
    dealOneCard();
  }

  function handleClearTable() {
    clearTable();
  }

  async function fetchPlayers(roomId) {
    try {
      return await User.find({ roomId: roomId });
    } catch (error) {
      console.error(`Ошибка при запросе игроков: ${error}`);
      return [];
    }
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

      await dealCards(deck, players, playerCards, deckWithoutPlayerCards);

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

      if (activePlayers.length > 1) {
        const allInPlayer = players.find((player) => player.allIn);
        if (!allInPlayer) {
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
      handleClearTable;
      handleDealFlop();

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

      if (turnPlayers.length > 0) {
        const maxBet = turnPlayers.reduce((maxSum, currentPlayer) =>
          maxSum.flopLastBet > currentPlayer.flopLastBet
            ? maxSum
            : currentPlayer
        );
        console.log(`maxBet ${JSON.stringify(maxBet)}`);
        const allSameMaxBet = turnPlayers.every(
          (player) =>
            player.flopLastBet === maxBet.flopLastBet &&
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
      handleDealOneCard();

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

  // ТРИГГЕР РИВЕР
  async function giveRiver(roomId) {
    return withBlocker("operationInProgress", async () => {
      try {
        const players = await User.find({ roomId: roomId, fold: false });
        const turnPlayers = players.filter(
          (player) => !player.fold && player.roundStage === "turn"
        );

        if (turnPlayers.length === 0) {
          return false;
        }

        const maxBet = turnPlayers.reduce((maxSum, currentPlayer) =>
          maxSum.turnLastBet > currentPlayer.turnLastBet
            ? maxSum
            : currentPlayer
        );
        const allSameMaxBet = turnPlayers.every(
          (player) =>
            player.turnLastBet === maxBet.turnLastBet && player.makeTurn
        );

        if (allSameMaxBet) {
          console.log(`ВЫЗЫВАЕМ giveRiver в позиции ${JSON.stringify(true)}`);
          return true;
        } else {
          return false;
        }
      } catch (error) {
        console.error("Error in giveRiver event:", error);
        return false;
      }
    });
  }

  // ВЫДАЧА РИВЕРА
  async function dealRiver(roomId) {
    return withBlocker("taskRunning", async () => {
      if (tableCards.length >= 5) {
        return;
      }
      try {
        handleDealOneCard();
        const players = await User.find({ roomId: roomId, fold: false });
        const bbPlayer = await User.findOne({ position: 2 });
        await User.updateMany({}, { lastBet: 0 });

        if (!bbPlayer) {
          return io.emit("dealError", {
            message: "Игрок на большом блаинде не найден",
          });
        }

        const minPlayer = players.reduce((minPlayer, currentPlayer) =>
          currentPlayer.position < minPlayer.position
            ? currentPlayer
            : minPlayer
        );

        const lastCurrentPlayer = players.find(
          (player) => player.currentPlayerId
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
        console.error("Error in dealRiver event:", error);
        io.emit("dealError", {
          message: "Ошибка при выдаче терна",
          error: error.message,
        });
      }
    });
  }

  // Обработка выдачи Ривера
  async function handleGiveRiver(roomId) {
    return withBlocker("processing", async () => {
      const shouldDealRiver = await giveRiver(roomId);
      if (shouldDealRiver) {
        setTimeout(async () => {
          await dealRiver(roomId);
        }, 0);
      }
    });
  }

  //НАЧАЛО НОВОГО РАУНДА
  async function startNewRound(roomId) {
    return withBlocker("taskRunning", async () => {
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
        handleClearTable();
        io.emit("startNewRound", "Начинаем новый раунд");
      } catch (error) {
        console.error(error);
      }
    });
  }

  // ТРИГГЕР ОБНОВЛЕНИЯ ПОЗИЦИЙ НАЧАЛА НОВОГО РАУНДА
  async function updatePositionTrigger(roomId) {
    return withBlocker("operationInProgress", async () => {
      const players = await User.find({ roomId: roomId });

      if (players.length === 0) {
        return false;
      }
      const activePlayers = players.filter((player) => player.fold === false);
      const winner = activePlayers.some((player) => player.winner === true);
      if (winner) {
        return true;
      }
      return false;
    });
  }

  // ОБНОВЛЕНИЕ ПОЗИЦИЙ НАЧАЛА НОВОГО РАУНДА
  async function updatePos(roomId) {
    return withBlocker("taskRunning", async () => {
      try {
        const players = await User.find({ roomId: roomId }).sort({
          position: 1,
        });

        if (players.length === 0) {
          console.log("Нет игроков для обновления позиций.");
          return;
        }

        setTimeout(() => {});
        for (let i = 0; i < players.length; i++) {
          let newPosition = players[i].position + 1;
          if (newPosition > players.length) {
            newPosition = 1;
          }
          await User.updateOne(
            { _id: players[i]._id },
            { $set: { position: newPosition } }
          );
        }

        await User.updateMany(
          { roomId: roomId },
          {
            $set: {
              lastBet: 0,
              preFlopLastBet: 0,
              currentPlayerId: false,
              flopLastBet: 0,
              turnLastBet: 0,
              riverLastBet: 0,
              fold: false,
              roundStage: "preflop",
              allIn: null,
              allInColl: null,
              makeTurn: false,
              loser: false,
              cards: [],
              winner: false,
              isDealer: false,
            },
          }
        );

        const updatedPlayers = await User.find({ roomId: roomId }).sort({
          position: 1,
        });

        const newDealerIndex = updatedPlayers.length - 1;
        await User.updateOne(
          { roomId: roomId, _id: updatedPlayers[newDealerIndex]._id },
          { $set: { isDealer: true } }
        );

        await User.updateMany(
          { position: 3, roomId: roomId },
          { $set: { currentPlayerId: true } }
        );

        const sbPlayer = await User.findOneAndUpdate(
          { position: 1 },
          {
            $inc: { stack: -25 },
            $set: { lastBet: 25, preFlopLastBet: 25 },
          },
          { new: true }
        );
        if (sbPlayer && sbPlayer.stack < 0) {
          await User.updateOne({ _id: sbPlayer._id }, { $set: { fold: true } });
        }

        const bbPlayer = await User.findOneAndUpdate(
          { position: 2 },
          {
            $inc: { stack: -50 },
            $set: { lastBet: 50, preFlopLastBet: 50 },
          },
          { new: true }
        );
        if (bbPlayer && bbPlayer.stack < 0) {
          await User.updateOne({ _id: bbPlayer._id }, { $set: { fold: true } });
        }
        handleClearTable();
        await startCardDistribution(roomId);
        io.emit("updatePositions", "Позиции игроков успешно обновлены.");
        io.emit("clearTableCards");
      } catch (error) {
        console.error(`Ошибка при обновлении позиции: ${error}`);
      }
    });
  }

  async function giveWinner(roomId) {
    return withBlocker("operationInProgress", async () => {
      const players = await fetchPlayers(roomId);

      if (players.length > 1) {
        const activePlayers = players.filter((player) => !player.fold);
        if (activePlayers.length === 1) {
          return true;
        }

        const allMadeTurn = players.every(
          (player) => player.makeTurn && player.roundStage === "river"
        );
        if (allMadeTurn) {
          console.log("Попали в giveWinner");
          return true;
        }
      }

      return false;
    });
  }

  // ОПРЕДЕЛЯЕМ ПОБЕДИТЕЛЯ
  async function findWinner(roomId) {
    return withBlocker("taskRunning", async () => {
      try {
        const players = await User.find({ roomId: roomId });
        const activePlayers = players.filter(
          (player) => !player.fold && player.makeTurn
        );
        if (players.length === 0) {
          throw new Error("No players found in the room");
        }

        const lastWinner = activePlayers.filter((player) => !player.fold);

        if (lastWinner.length === 1) {
          let totalBets = 0;
          players.forEach((player) => {
            totalBets +=
              player.preFlopLastBet +
              player.flopLastBet +
              player.turnLastBet +
              player.riverLastBet;
          });

          const winner = lastWinner[0];

          winner.stack += totalBets;
          await winner.save();
          await User.updateOne({ _id: winner._id }, { $set: { winner: true } });

          console.log(
            `Победитель ${JSON.stringify(
              winner.name
            )} после того как все скинули`
          );

          return { winners: [winner.name], winnerSum: totalBets };
        }

        if (activePlayers.length > 0) {
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
                await User.updateOne(
                  { _id: winnerPlayer._id },
                  { $set: { winner: true } }
                );
                await winnerPlayer.save();
              }
            }

            await User.updateMany(
              { stack: { $lte: 0 } },
              { $set: { loser: true } }
            );

            console.log(`Победа после вскрытия карты оказались самые сильные`);

            return { winners, winnerSum: potSize };
          } else {
            console.log("Нет победителей");
            return { winners: [], winnerSum: 0 };
          }
        }
      } catch (error) {
        console.error(`Ошибка при определении победителя: ${error}`);
      }
    });
  }

  async function handleGiveWinner(roomId) {
    return withBlocker("processing", async () => {
      const winner = await giveWinner(roomId);
      if (winner) {
        await findWinner(roomId);
      }
    });
  }

  io.on("connection", (socket) => {
    console.log("New client connected");
    socket.on("getPlayers", async (roomId) => {
      try {
        const players = await User.find({ roomId: roomId });
        await handleGiveFlop(roomId);
        await handleGiveTurn(roomId);
        await handleGiveRiver(roomId);
        await handleGiveWinner(roomId);
        const updatePosition = await updatePositionTrigger(roomId);
        gameState.updatePosition = updatePosition;

        if (gameState.updatePosition) {
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
            { $set: { currentPlayerId: true, isDealer: true } }
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
