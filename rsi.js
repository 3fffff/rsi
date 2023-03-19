'use strict'

export default class RSI {
	
  calculate(values, period, callback) {
    this.values = values.reverse();
    this.data = [];
    this.period = period;
    return this.lossOrGain()
      .then(() => this.getAverages('gain'))
      .then(() => this.getAverages('loss'))
      .then(() => this.calculateRS())
      .then(() => this.calculateRSI())
      .then(result => callback(null, result))
  }

  async lossOrGain() {
    this.values.forEach((val, idx) => {
        const change = this.toFixed((val.close - val.open), 2);
        this.data.push({
          value: val.close,
          change: change,
          gain: (change > 0) ? change : 0,
          loss: (change < 0) ? Math.abs(change) : 0
        });
    });
    return this.data
  }

  async getAverages(key) {
    let sum = 0;
    let avg = 0;
    let overallAvg = 0;
    const upperCaseKey = key.charAt(0).toUpperCase() + key.substr(1);
    this.data.forEach((val, idx) => {
      if (idx < this.period) {
        sum += val[key];
      } else if (idx === this.period) {
        sum += val[key];
        avg = sum / this.period;
        this.data[idx][`avg${upperCaseKey}`] = avg;
      } else {
        overallAvg =
          (this.data[idx - 1][`avg${upperCaseKey}`] * (this.period - 1) + val[key]) / this.period;
        this.data[idx][`avg${upperCaseKey}`] = overallAvg;
      }
    });
    return this.data;
  }

  async calculateRS() {
    this.data.forEach((val, idx) => {
      if (val.avgGain !== undefined && val.avgLoss !== undefined &&
        !isNaN(parseFloat(val.avgGain)) && !isNaN(parseFloat(val.avgLoss))) {
        val.rs = val.avgGain / val.avgLoss;
      }
    });
    return this.data;
  }

  async calculateRSI() {
    this.data.forEach((val, idx) => {
      if (val.avgLoss) {
        this.data[idx].rsi = 100 - 100 / (1 + val.rs);
      } else if (val.rs != undefined) {
        this.data[idx].rsi = 100;
      }
    });
    return this.data;
  }
  toFixed(number, decimals) {
    return Math.round(number * Math.pow(10, decimals)) / (Math.pow(10, decimals));
  };
}
