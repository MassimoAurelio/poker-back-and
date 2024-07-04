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

      const deck = shuffleDeck();

      const playerCards = dealCards(deck, players);

      for (const { playerId, cards } of playerCards) {
        await User.updateOne({ _id: playerId }, { $set: { cards: cards } });
        io.to(playerId).emit("dealCards", cards);
      }

      console.log(`Раздаем карты ${roomId}, ${JSON.stringify(playerCards)}`);
      io.to(roomId).emit("dealSuccess", "Карты успешно разданы");
    } catch (error) {
      console.error("Error during card dealing:", error.message);
      io.to(roomId).emit("dealError", {
        message: "Ошибка при раздаче карт",
        error: error.message,
      });
    }
  }

  function clearFlop() {
    return (tableCards.length = 0);
  }

  // Функция для раздачи трех карт (флопа)
  function dealFlopCards() {
    for (let i = 0; i < 3; i++) {
      tableCards.push(deckWithoutPlayerCards.pop());
    }
    return tableCards;
  }
  // Функция для раздачи одной карты (терна)
  function dealTernCard() {
    for (let i = 0; i < 1; i++) {
      tableCards.push(deckWithoutPlayerCards.pop());
    }
    return tableCards;
  }

  io.on("connection", (socket) => {
    console.log("New client connected");
    //Информация о столе
    socket.on("getPlayers", async (roomId) => {
      try {
        const players = await User.find({ roomId: roomId });
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
          console.log("Три игрока сидят за столом. Раздача карт...");
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


    //Выдача фропа
    socket.on("dealFlop", async () => {
      try {
        if (tableCards.length === 3) {
          return socket.emit("dealError", {
            message: "Флоп карты уже раздана",
          });
        }
        clearFlop();
        dealFlopCards();

        const players = await User.find({ fold: false });
        const bbPlayer = await User.findOne({ position: 2 });
        await User.updateMany({}, { lastBet: 0 });

        if (!bbPlayer) {
          return socket.emit("dealError", {
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
        console.error("Error in dealTurn event:", error);
        socket.emit("dealError", {
          message: "Ошибка при выдаче терна",
          error: error.message,
        });
      }
    });

    //Выдача терна
    socket.on("dealTurn", async () => {
      try {
        if (tableCards.length === 4) {
          return socket.emit("dealError", {
            message: "Терн карта уже раздана",
          });
        }

        dealTernCard();

        const players = await User.find({ fold: false });
        const bbPlayer = await User.findOne({ position: 2 });
        await User.updateMany({}, { lastBet: 0 });

        if (!bbPlayer) {
          return socket.emit("dealError", {
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
        socket.emit("dealError", {
          message: "Ошибка при выдаче терна",
          error: error.message,
        });
      }
    });

    //Выдача ривера
    socket.on("dealRiver", async () => {
      try {
        if (tableCards.length === 5) {
          return socket.emit("dealError", {
            message: "Ривер карта уже раздана",
          });
        }

        dealTernCard();

        const players = await User.find({ fold: false });
        const bbPlayer = await User.findOne({ position: 2 });
        await User.updateMany({}, { lastBet: 0 });

        if (!bbPlayer) {
          return socket.emit("dealError", {
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
        socket.emit("dealError", {
          message: "Ошибка при выдаче терна",
          error: error.message,
        });
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

    // Обновляем позиции игроков перед следующим раундом
    socket.on("updatePositions", async () => {
      try {
        const players = await User.find({});
        const preflopPlayer = players.every(
          (player) => player.cards.length === 0
        );

        if (preflopPlayer) {
          return socket.emit("dealError", {
            message: "Игроки уже сменили позиции",
          });
        }
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
        socket.emit("updatePositions", "Позиции игроков успешно обновлены.");
      } catch (error) {
        console.error(error);
        socket.emit("dealError", {
          message: "Ошибка при смене позиций игроков",
          error: error.message,
        });
      }
    });

    socket.on("resetFlop", async () => {
      try {
        console.log("Очищаем флоп");
        io.emit("resetFlop", tableCards);
      } catch (error) {
        console.error(error);
        io.emit("dealError", {
          message: "Ошибка при очистке карт стола",
        });
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
