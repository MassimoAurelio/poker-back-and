let tableCards = [];
let deckWithoutPlayerCards = [];

function dealOneCard() {
  if (deckWithoutPlayerCards.length > 0) {
    const card = deckWithoutPlayerCards.pop();
    console.log("Выдаем одну карту:", card);
    return card;
  } else {
    console.log("Колода пуста, невозможно выдать карту.");
    return null;
  }
}

function dealFlopCards() {
  tableCards.push(deckWithoutPlayerCards.pop());
  tableCards.push(deckWithoutPlayerCards.pop());
  tableCards.push(deckWithoutPlayerCards.pop());
  console.log("Выдаем карты флопа");
}

module.exports = {
  dealOneCard,
  dealFlopCards,
  setTableCards(cards) {
    tableCards = cards;
  },
  setDeckWithoutPlayerCards(deck) {
    deckWithoutPlayerCards = deck;
  },
};
