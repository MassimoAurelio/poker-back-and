const socketio = require("socket.io");
const User = require("../models/modelUser");
const { Hand } = require("pokersolver");

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
    for (let i = 0; i < players.length; i++) {
      const cards = [deck.pop(), deck.pop()];
      playerCards.push({ playerId: players[i]._id, cards });
    }
    while (deck.length > 0) {
      deckWithoutPlayerCards.push(deck.pop());
    }
    return playerCards;
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
  // Функция для раздачи одной карты (ривера)
  function dealRiverCards() {
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
        io.to(socket.id).emit("playersData", players);
      } catch (error) {
        console.error("Error fetching players:", error.message);
        socket.emit("error", {
          message: "Ошибка при получении списка игроков",
          error: error.message,
        });
      }
    });
    //Раздача карт каждому игроку
    socket.on("requestDeal", async ({ roomId }) => {
      try {
        const players = await User.find({ roomId: roomId });
        const deck = shuffleDeck();

        const playerCards = dealCards(deck, players);

        for (const { playerId, cards } of playerCards) {
          await User.updateOne({ _id: playerId }, { $set: { cards: cards } });
          socket.to(playerId).emit("dealCards", cards);
        }

        console.log(`Broadcasting deal success to room ${roomId}`);
        socket.broadcast
          .to(roomId)
          .emit("dealSuccess", "Карты успешно разданы");
      } catch (error) {
        console.error("Error during card dealing:", error.message);
        socket.emit("dealError", {
          message: "Ошибка при раздаче карт",
          error: error.message,
        });
      }
    });
    //Выдача фропа
    socket.on("dealFlop", async () => {
      try {
        const players = await User.find({ fold: false });
        await User.updateMany({}, { $set: { makeTurn: false } });
        clearFlop();
        dealFlopCards();

        await User.updateMany({}, { lastBet: 0 });

        const bbPlayer = await User.findOne({ position: 2 });
        if (!bbPlayer) {
          return socket.emit("dealError", {
            message: "Игрок на большом блаинде не найден",
          });
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
          return socket.emit("dealError", {
            message: "Последний игрок не найден",
          });
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

        const dataToSend = {
          flop: { tableCards: tableCards },
        };
        await User.updateMany({}, { roundStage: "flop" });
        console.log(`FLOP: ${JSON.stringify(tableCards)}`);
        io.emit("dealFlop", dataToSend);
      } catch (error) {
        console.error("Error in dealFlop event:", error);
        socket.emit("dealError", {
          message: "Ошибка при выдаче флопа",
          error: error.message,
        });
      }
    });
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
    socket.on("dealRiver", async () => {
      try {
        const players = await User.find({ fold: false });
        await User.updateMany({}, { $set: { makeTurn: false } });
        await User.updateMany({}, { lastBet: 0 });
        dealRiverCards();
        const bbPlayer = await User.findOne({ position: 2 });
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
        const lastCurrentPlayerId = players.find((player) => {
          return player.currentPlayerId === true;
        });

        if (!lastCurrentPlayerId) {
          return socket.emit("dealError", "lastCurrentPlayerId не найден");
        }

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
        console.log(`RIVER: ${JSON.stringify(tableCards)}`);
        io.emit("dealRiver", { flop: { tableCards } });
      } catch (error) {
        console.error("Error in dealRiver event:", error);
        socket.emit("dealError", {
          message: "Ошибка при выдаче ривера",
          error: error.message,
        });
      }
    });
    socket.on("findWinner", async () => {
      try {
        const players = await User.find({ fold: false, roundStage: "river" });
        await User.updateMany({}, { $set: { makeTurn: false } });
        const communityCards = tableCards;
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
        console.log(`Победитель ${(winners, winnerSum)}`);
        io.emit("findWinner", { winners, winnerSum });
      } catch (error) {
        console.error("Error in FindWinner event", error);
        socket.emit("dealError", {
          message: "Ошибка при поиске победителя",
          error: error.message,
        });
      }
    });
  });
}

module.exports = initializeSocket;
