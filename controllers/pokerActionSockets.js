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

  let tableCards = [];
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
    // Очистка массивов перед раздачей
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
        io.to(socket.id).emit("playersData", players);
      } catch (error) {
        console.error("Error fetching players:", error.message);
        socket.emit("error", {
          message: "Ошибка при получении списка игроков",
          error: error.message,
        });
      }
    });

    // Раздача карт каждому игроку
    socket.on("requestDeal", async ({ roomId }) => {
      try {
        const players = await User.find({ roomId: roomId });

        const emptyCards = players.every((player) => {
          return player.cards.length === 0;
        });

        if (!emptyCards) {
          return socket.emit("dealError", {
            message: "Карты уже разданы",
          });
        }

        const deck = shuffleDeck();

        const playerCards = dealCards(deck, players);

        for (const { playerId, cards } of playerCards) {
          await User.updateOne({ _id: playerId }, { $set: { cards: cards } });
          socket.to(playerId).emit("dealCards", cards);
        }
        console.log(`Раздаем карты ${roomId}, ${JSON.stringify(playerCards)}`);
        io.to(roomId).emit("dealSuccess", "Карты успешно разданы");
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

    //Определение победителя
    socket.on("findWinner", async () => {
      try {
        // Получаем всех игроков, которые еще не сложили карты
        const players = await User.find({
          fold: false,
        });

        const playersInPreFlop = players.every(
          (player) => player.roundStage === "preflop"
        );

        if (playersInPreFlop) {
          return socket.emit("dealError", {
            message: "Победитель уже определен",
          });
        }

        // Фильтруем игроков, у которых есть действительные карты
        const validPlayers = players.filter((player) =>
          Array.isArray(player.cards)
        );

        if (validPlayers.length === 0) {
          return socket.emit("dealError", {
            message: "ОШИБКА",
          });
        }

        // Сбрасываем флаг makeTurn для всех пользователей
        await User.updateMany({}, { $set: { makeTurn: false } });

        // Обрабатываем общие карты и руки каждого игрока
        const communityCards = tableCards; // Предполагается, что tableCards уже определен где-то выше
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

        // Находим победную руку
        const winningHand = Hand.winners(hands.map((h) => h.hand));

        // Рассчитываем сумму ставок для определения размера выигрыша
        let winnerSum = 0;
        const playersInRound = await User.find({});
        playersInRound.forEach((item) => {
          winnerSum +=
            item.preFlopLastBet +
            item.flopLastBet +
            item.turnLastBet +
            item.riverLastBet;
        });

        // Определяем победителей
        const winners = hands 
          .filter((h) => winningHand.includes(h.hand))
          .map((h) => h.player);

        // Обновляем стек победителей
        for (const winner of winners) {
          const winnerPlayer = await User.findOne({ name: winner });
          if (winnerPlayer) {
            winnerPlayer.stack += winnerSum;
            await winnerPlayer.save();
          }
        }

        // Сброс значений для всех пользователей
        await User.updateMany(
          {},
          {
            $set: {
              roundStage: "preflop",
            },
          }
        );

        // Проверяем, остался ли только один игрок
        if (players.length === 1) {
          // Если да, то он автоматически выигрывает
          const lastPlayer = players[0];
          lastPlayer.stack += winnerSum; // Добавляем к его стеке сумму ставок
          await lastPlayer.save(); // Сохраняем изменения
          // Сброс значений для всех пользователей
          await User.updateMany(
            {}, 
            {
              $set: {
                roundStage: "preflop",
              },
            }
          );

          // Эмитим событие с информацией о последнем игроке как победителе
          console.log(
            `Юзер остался один, все остальные сбросили, он победитель ${winnerSum}`
          );
          io.emit("findWinner", { lastPlayer, winnerSum });
        } else {
          // Если есть несколько победителей, эмитим их
          console.log(`Игроки дошли до ривера и вскрыли карты ${winnerSum}`);
          io.emit("findWinner", { winners, winnerSum });
        }
      } catch (error) {
        console.error("Error in FindWinner event", error);
        socket.emit("dealError", {
          message: "Ошибка при поиске победителя",
          error: error.message,
        });
      }
    });

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

        // Сброс значений для всех пользователей
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
              makeTurn: false,
              cards: [],
            },
          }
        );

        // Найти игрока с самой высокой позицией
        let highPositionPlayer = players.reduce((a, b) => {
          return a.position > b.position ? a : b;
        }, players[0]);

        // Создать новый объект с обновленными позициями
        let updatedPositions = {};
        for (let player of players) {
          updatedPositions[player._id] =
            player.position === highPositionPlayer.position
              ? 1
              : player.position + 1;
        }

        // Обновить позиции пользователей за один запрос
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
  });
}

module.exports = initializeSocket;
