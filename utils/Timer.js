class Timer {
  constructor(seconds) {
    this.seconds = seconds;
    this.remainingTime = seconds;
    this.intervalId = null;
  }

  start() {
    this.intervalId = setInterval(() => {
      console.log(`Осталось: ${this.remainingTime} секунд`);
      this.remainingTime -= 1;

      if (this.remainingTime < 0) {
        this.stop();
        console.log("Таймер завершён!");
      }
    }, 1000);
  }

  stop() {
    clearInterval(this.intervalId);
  }

  reset() {
    this.stop();
    this.remainingTime = this.seconds;
  }
}

module.exports = Timer;
