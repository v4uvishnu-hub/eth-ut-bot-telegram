const https = require("https");

const SYMBOL = "ETHUSDT";
const INTERVAL = "15m";
const ATR_PERIOD = 10;
const KEY_VALUE = 1;

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

let lastAlert = null;

function getJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = "";

      res.on("data", chunk => {
        data += chunk;
      });

      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on("error", reject);
  });
}

function calculateATR(candles, period) {
  const tr = [];

  for (let i = 1; i < candles.length; i++) {
    const high = Number(candles[i][2]);
    const low = Number(candles[i][3]);
    const previousClose = Number(candles[i - 1][4]);

    tr.push(
      Math.max(
        high - low,
        Math.abs(high - previousClose),
        Math.abs(low - previousClose)
      )
    );
  }

  const atr = [];

  for (let i = period; i <= tr.length; i++) {
    const section = tr.slice(i - period, i);
    const average =
      section.reduce((a, b) => a + b, 0) / period;

    atr.push(average);
  }

  return atr;
}

function calculateUTBot(candles) {
  const atr = calculateATR(candles, ATR_PERIOD);

  const stops = [];
  const signals = [];

  for (let i = ATR_PERIOD + 1; i < candles.length; i++) {

    const close = Number(candles[i][4]);
    const previousClose = Number(candles[i - 1][4]);

    const atrIndex = i - ATR_PERIOD - 1;

    if (atrIndex < 0 || atrIndex >= atr.length) {
      continue;
    }

    const loss = KEY_VALUE * atr[atrIndex];

    let previousStop =
      stops.length > 0
        ? stops[stops.length - 1]
        : previousClose - loss;

    let stop;

    if (
      close > previousStop &&
      previousClose > previousStop
    ) {
      stop = Math.max(
        previousStop,
        close - loss
      );
    } else if (
      close < previousStop &&
      previousClose < previousStop
    ) {
      stop = Math.min(
        previousStop,
        close + loss
      );
    } else if (close > previousStop) {
      stop = close - loss;
    } else {
      stop = close + loss;
    }

    stops.push(stop);

    let signal = null;

    if (
      previousClose <= previousStop &&
      close > stop
    ) {
      signal = "BUY";
    }

    if (
      previousClose >= previousStop &&
      close < stop
    ) {
      signal = "SELL";
    }

    signals.push({
      signal,
      close,
      stop,
      candleTime: candles[i][0]
    });
  }

  return signals;
}

function sendTelegram(message) {

  const data = JSON.stringify({
    chat_id: TELEGRAM_CHAT_ID,
    text: message
  });

  const options = {
    hostname: "api.telegram.org",
    path: `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(data)
    }
  };

  const req = https.request(options, res => {

    let body = "";

    res.on("data", chunk => {
      body += chunk;
    });

    res.on("end", () => {
      console.log("Telegram:", body);
    });

  });

  req.on("error", error => {
    console.error("Telegram error:", error);
  });

  req.write(data);
  req.end();
}

async function checkUTBot() {

  try {

    const url =
      "https://api.binance.com/api/v3/klines" +
      "?symbol=ETHUSDT" +
      "&interval=15m" +
      "&limit=200";

    const candles = await getJSON(url);

    if (!Array.isArray(candles)) {
      console.log("Invalid Binance response");
      return;
    }

    /*
      Binance returns the last candle as the currently
      forming candle.

      Therefore we use the previous candle.
    */

    const closedCandles = candles.slice(0, -1);

    const signals = calculateUTBot(closedCandles);

    if (!signals.length) {
      return;
    }

    const latest = signals[signals.length - 1];

    if (!latest.signal) {
      console.log(
        new Date().toISOString(),
        "No new signal"
      );

      return;
    }

    const alertID =
      `${latest.candleTime}-${latest.signal}`;

    if (alertID === lastAlert) {
      return;
    }

    lastAlert = alertID;

    const emoji =
      latest.signal === "BUY"
        ? "🟢"
        : "🔴";

    const message =
`${emoji} UT BOT ${latest.signal}

📊 ETH/USDT
⏱ Timeframe: 15m

💰 Price: ${latest.close.toFixed(2)}
📈 UT Stop: ${latest.stop.toFixed(2)}

ATR Period: 10
Key Value: 1

✅ Candle CLOSED
📡 Source: Binance`;

    console.log(message);

    sendTelegram(message);

  } catch (error) {

    console.error(
      "Error:",
      error.message
    );

  }
}

console.log(
  "ETH/USDT UT Bot Telegram Alert started"
);

checkUTBot();

setInterval(
  checkUTBot,
  30 * 1000
);
