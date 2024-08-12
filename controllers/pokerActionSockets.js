const socketio = require("socket.io");
const User = require("../models/modelUser");
const { Hand } = require("pokersolver");
const Room = require("../models/modelRoom");
const { shuffleDeck, dealCards } = require("../utils/deckUtils");
const { withBlocker } = require("../utils/blockers");
const {
  dealFlopCards,
  dealOneCard,
  clearTable,
  setTableCards,
  setDeckCards,
} = require("../utils/gameUtils");

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
      }, players[0]);

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
      const players = await User.find({ roomId: roomId });
      const turnPlayers = players.filter(
        (player) => player.fold === false && player.roundStage === "flop"
      );
      const activePlayers = players.filter((player) => !player.fold);
      const allMakeTurn = activePlayers.every((player) => player.makeTurn);

      if (!allMakeTurn) {
        return false;
      }

      if (turnPlayers.length > 0) {
        const maxBet = turnPlayers.reduce((maxSum, currentPlayer) =>
          maxSum.flopLastBet > currentPlayer.flopLastBet
            ? maxSum
            : currentPlayer
        );
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
      const players = await User.find({ roomId: roomId });
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
        const players = await User.find({ roomId: roomId });

        // Получаем всех активных игроков
        const activePlayers = players.filter((player) => !player.fold);

        // Проверяем количество активных игроков
        if (activePlayers.length > 1) {
          const turnPlayers = activePlayers.filter(
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
        console.log("Ривер не выдали потому что уже 5 карт есть");
        return;
      }

      try {
        const players = await User.find({ roomId: roomId });
        const activePlayers = players.filter((player) => !player.fold);
        if (activePlayers.length > 1) {
          handleDealOneCard();
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
        }
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
    /* return withBlocker("taskRunning", async () => { */
    try {
      const players = await User.find({ roomId: roomId });

      const highPosition = players.reduce((a, b) => {
        return a.position > b.position ? a : b;
      });

      // Сбрасываем состояния всех игроков
      await User.updateMany(
        { roomId: roomId },
        {
          $set: {
            loser: false,
          },
        }
      );

      /* await User.updateOne(
        { roomId: roomId, _id: highPosition._id },
        {
          $set: { isDealer: true },
        }
      );
 */
      await User.updateMany(
        { position: 3, roomId: roomId },
        { $set: { currentPlayerId: true } }
      );

      // Устанавливаем small blind и big blind
      const sbPlayer = await User.findOneAndUpdate(
        { position: 1, roomId: roomId },
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
        { position: 2, roomId: roomId },
        { $inc: { stack: -50 }, $set: { lastBet: 50, preFlopLastBet: 50 } },
        { new: true }
      );
      if (bbPlayer && bbPlayer.stack < 0) {
        await User.updateOne({ _id: bbPlayer._id }, { $set: { fold: true } });
      }
      console.log("START NEW ROUND");
      handleClearTable();
      io.emit("clearTableCards");
      await startCardDistribution(roomId);
      io.emit("startNewRound", "Начинаем новый раунд");
    } catch (error) {
      console.error(error);
    }
    /*  }); */
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
        let players = await User.find({ roomId: roomId }).sort({ position: 1 });

        if (players.length === 0) {
          console.log("Нет игроков для обновления позиций.");
          return;
        }

        await User.updateMany(
          { roomId: roomId },
          {
            $set: {
              lastBet: 0,
              preFlopLastBet: 0,
              flopLastBet: 0,
              turnLastBet: 0,
              riverLastBet: 0,
              fold: false,
              makeTurn: false,
              cards: [],
              roundStage: "preflop",
              allIn: null,
              allInColl: null,
              winner: false,
              isDealer: false,
            },
          }
        );

        const firstPositionPlayer = players.find(
          (player) => player.position === 1
        );

        if (firstPositionPlayer && firstPositionPlayer.stack > 0) {
          await User.findOneAndUpdate(
            { roomId: roomId, _id: firstPositionPlayer._id },
            { $set: { isDealer: true } }
          );
          console.log(
            `НАВЕШИВАЕМ isDealer на первого юзера ${firstPositionPlayer.name}`
          );
        } else {
          const nextActivePlayer = players.find(
            (player) => player.position > 1 && player.stack > 0
          );

          if (!nextActivePlayer) {
            console.log("nextActivePlayer позиции не нашли");
            return;
          }

          await User.findOneAndUpdate(
            { roomId: roomId, _id: nextActivePlayer._id },
            { $set: { isDealer: true } }
          );
          console.log(
            `НАВЕШИВАЕМ isDealer на второго юзера ${nextActivePlayer.name}`
          );
        }

        players = await User.find({ roomId: roomId, loser: false }).sort({
          position: 1,
        });

        if (!players) {
          console.log("players не найдены");
          return;
        }

        let sortPlayers = players.sort((a, b) => {
          if (a.isDealer && !b.isDealer) return 1;
          if (!a.isDealer && b.isDealer) return -1;
          return 0;
        });

        if (!sortPlayers) {
          console.log("sortPlayers не найдены");
          return;
        }

        for (let i = 0; i < sortPlayers.length; i++) {
          const item = sortPlayers[i];
          await User.findOneAndUpdate(
            { roomId: roomId, _id: item._id },
            { $set: { position: i + 1 } }
          );
        }

        await startNewRound(roomId);
        console.log("ОБНОВЛЯЕМ ПОЗИЦИИ");
      } catch (error) {
        console.error(`Ошибка при обновлении позиции: ${error}`);
      }
    });
  }

  //ТРИГГЕР ПОИСКА ПОБЕДИТЕЛЯ
  async function giveWinner(roomId) {
    return withBlocker("operationInProgress", async () => {
      const players = await fetchPlayers(roomId);

      const activePlayers = players.filter((player) => !player.fold);
      if (activePlayers.length === 1) {
        if (activePlayers[0].position === 2) {
          await User.updateOne(
            { _id: activePlayers[0]._id },
            { $set: { makeTurn: true } }
          );
        }
        return true;
      }

      const allMakeTurn = activePlayers.every((player) => player.makeTurn);

      if (players.length > 1) {
        const activePlayers = players.filter((player) => !player.fold);
        if (activePlayers.length === 1) {
          return true;
        }

        const allMadeTurn = activePlayers.every(
          (player) => player.makeTurn && player.roundStage === "river"
        );
        if (allMadeTurn) {
          console.log("Попали в giveWinner");
          return true;
        }

        const allInPlayers = activePlayers.filter((player) => player.allIn);
        const allInOrAllInCollPlayers = activePlayers.filter(
          (player) => player.allIn || player.allInColl
        );

        const hasAllInWithOpponent = allInPlayers.some((player) =>
          allInOrAllInCollPlayers.some((opponent) => opponent !== player)
        );

        if (
          hasAllInWithOpponent &&
          allInOrAllInCollPlayers.length > 0 &&
          allMakeTurn
        ) {
          console.log("giveWinner ALL-IN");
          return true;
        }
      }
    });
  }

  //ОПРЕДЕЛЯЕМ ПОБЕДИТЕЛЯ
  async function findWinner(roomId) {
    return withBlocker("taskRunning", async () => {
      try {
        const players = await User.find({ roomId: roomId });
        //makeTurn не удалять
        const activePlayers = players.filter(
          (player) => !player.fold && player.makeTurn
        );

        if (players.length === 0) {
          throw new Error("No players found in the room");
        }

        // Определяем победителя если все скинули
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

        // Проверяем есть ли игроки, которые пошли в allIn
        const allInPlayers = activePlayers.filter((player) => player.allIn);

        if (allInPlayers.length > 0) {
          if (tableCards.length === 0) {
            await dealFlopCard(roomId);
            dealOneCard();
            io.emit("dealTurn", { flop: { tableCards } });
            dealOneCard();
            io.emit("dealRiver", { flop: { tableCards } });
          }
          if (tableCards.length === 3) {
            await dealTurnCard(roomId);
            io.emit("dealTurn", { flop: { tableCards } });
            await dealRiver(roomId);
            io.emit("dealRiver", { flop: { tableCards } });
          }
          if (tableCards.length === 4) {
            await dealRiver(roomId);
            io.emit("dealRiver", { flop: { tableCards } });
          }

          const communityCards = tableCards;
          const hands = activePlayers.map((player) => {
            const playerCards = player.cards.map((card) => {
              if (card && card.value && card.suit) {
                return `${card.value}${card.suit}`;
              } else {
                console.error("Некорректная карта игрока:", card);
                return "";
              }
            });

            const allCards = [
              ...playerCards,
              ...communityCards.map((card) => {
                if (card && card.value && card.suit) {
                  return `${card.value}${card.suit}`;
                } else {
                  console.error("Некорректная общая карта:", card);
                  return "";
                }
              }),
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

            console.log(`Победа allIN`);

            return { winners, winnerSum: potSize };
          }
        }

        // Определение победителя после вскрытия карт
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

          console.log(`Победа пос
            ле вскрытия карты оказались самые сильные`);

          return { winners, winnerSum: potSize };
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

        if (!roomStates[roomId]) {
          roomStates[roomId] = { playerCount: 0 };
        }
        roomStates[roomId].playerCount++;

        if (roomStates[roomId].playerCount === 3) {
          await startNewRound(roomId);
          await startCardDistribution(roomId);
        }

        socket.emit(
          "joinSuccess",
          `Игрок ${player} присоединился к столу на позицию ${position}.`
        );
      } catch (error) {
        socket.emit("joinError", { message: error.message });
      }
    });
    socket.on("leave", async (data) => {
      const { player, roomId } = data;
      try {
        const user = await User.findOne({ name: player, roomId: roomId });
        if (!user) {
          socket.emit("userNoFound", { message: "User not found" });
          return;
        }

        await Room.updateOne({ _id: roomId }, { $pull: { users: user._id } });

        await User.findOneAndDelete({ _id: user._id });
        socket.emit(
          "leaveSuccess",
          `Игрок ${player} покинул комнату ${roomId}.`
        );
      } catch (error) {
        socket.emit("leaveError", { message: error.message });
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
