let tableCards = [];
let deckWithoutPlayerCards = [];

function dealOneCard() {
  tableCards.push(deckWithoutPlayerCards.pop());
  console.log("Выдаем одну карту");
}

function dealFlopCards() {
  tableCards.push(deckWithoutPlayerCards.pop());
  tableCards.push(deckWithoutPlayerCards.pop());
  tableCards.push(deckWithoutPlayerCards.pop());
  console.log("Выдаем карты флопа");
}

function clearTable() {
  tableCards.length = 0;
}

module.exports = {
  dealOneCard,
  dealFlopCards,
  clearTable,
  setTableCards(cards) {
    tableCards = cards;
  },
  setDeckCards(cards) {
    deckWithoutPlayerCards = cards;
  },
};
