import WebSocket from 'ws';
import readline from 'readline'
import RSI from './rsi.js'

function getRandom(min, max) {
  return ~~(Math.random() * (max - min) + min);
}

function generateLetters(stringLength) {
  const arr = []
  for (let i = 0; i < stringLength; i++)
    arr.push(String.fromCharCode(i + 97))
  return arr
}

function generateSession() {
  const stringLength = 12
  const letters = generateLetters(26)
  let random_string = ""
  for (let i = 0; i < stringLength; i++)
    random_string += letters[getRandom(0, 25)]
  return random_string
}

function parseMessage(message) {
  if (message.length === 0) return []

  const events = message.toString().split(/~m~\d+~m~/).slice(1)

  return events.map(event => {
    if (event.substring(0, 3) === "~h~")
      return { type: 'ping', data: `~m~${event.length}~m~${event}` }

    const parsed = JSON.parse(event)

    if (parsed['session_id'])
      return { type: 'session', data: parsed }

    return { type: 'event', data: parsed }
  })
}

async function connect() {
  let token = 'unauthorized_user_token'
  const connection = new WebSocket("wss://prodata.tradingview.com/socket.io/websocket", {
    origin: "https://prodata.tradingview.com"
  })

  const subscribers = new Set()

  function subscribe(handler) {
    subscribers.add(handler)
    return () => {
      subscribers.delete(handler)
    }
  }

  function send(name, params) {
    const data = JSON.stringify({ m: name, p: params })
    const message = "~m~" + data.length + "~m~" + data
    connection.send(message)
  }

  async function close() {
    return new Promise((resolve, reject) => {
      connection.on('close', resolve)
      connection.on('error', reject)
      connection.close()
    })
  }

  return new Promise((resolve, reject) => {
    connection.on('error', error => reject(error))

    connection.on('message', message => {
      const payloads = parseMessage(message.toString())

      for (const payload of payloads) {
        switch (payload.type) {
          case 'ping':
            connection.send(payload.data)
            break;
          case 'session':
            send('set_auth_token', [token])
            resolve({ subscribe, send, close })
            break;
          case 'event':
            const event = {
              name: payload.data.m,
              params: payload.data.p
            }
            subscribers.forEach(handler => handler(event))
            break;
          default:
            throw new Error(`unknown payload: ${payload}`)
        }
      }
    })
  })
}

async function getCandles({ connection, symbols, amount, timeframe = 60 }) {
  if (symbols.length === 0) return []
  const MAX_BATCH_SIZE = 5000; // found experimentally
  const chartSession = "cs_" + generateSession()
  const session = "qs_" + generateSession()
  const batchSize = amount && amount < MAX_BATCH_SIZE ? amount : MAX_BATCH_SIZE

  return new Promise(resolve => {
    const allCandles = []
    let currentSymIndex = 0
    let symbol = symbols[currentSymIndex]
    let currentSymCandles = []

    connection.send('chart_create_session', [chartSession, ''])

    connection.send("quote_create_session", [session])
    connection.send("quote_set_fields",
      [session, "ch", "chp", "current_session", "description", "local_description", "language", "exchange", "fractional", "is_tradable", "lp", "lp_time",
        "minmov", "minmove2", "original_name", "pricescale", "pro_name", "short_name", "type", "update_mode", "volume", "currency_code", "rchp", "rtc"])
    connection.send("quote_add_symbols", [session, symbol, { "flags": ['force_permission'] }])
    connection.send("quote_fast_symbols", [session, symbol])

    connection.send('resolve_symbol', [
      chartSession,
      `sds_sym_0`,
      '=' + JSON.stringify({ symbol, adjustment: 'splits' })
    ])
    connection.send('create_series', [
      chartSession, 'sds_1', 's0', 'sds_sym_0', timeframe.toString(), batchSize, ''
    ])

    const unsubscribe = connection.subscribe(event => {
      //console.log(event)
      // received new candles
      if (event.name === 'timescale_update') {
        let newCandles = event.params[1]['sds_1']['s']
        if (newCandles.length > batchSize) {
          // sometimes tradingview sends already received candles
          newCandles = newCandles.slice(0, -currentSymCandles.length)
        }
        currentSymCandles = newCandles.concat(currentSymCandles)
        return
      }

      // loaded all requested candles
      if (['series_completed', 'symbol_error'].includes(event.name)) {
        const loadedCount = currentSymCandles.length
        if (loadedCount > 0 && loadedCount % batchSize === 0 && (!amount || loadedCount < amount)) {
          connection.send('request_more_data', [chartSession, 'sds_1', batchSize])
          return
        }

        // loaded all candles for current symbol

        if (amount) currentSymCandles = currentSymCandles.slice(0, amount)

        const candles = currentSymCandles.map(c => ({
          timestamp: c.v[0],
          open: c.v[1],
          high: c.v[2],
          low: c.v[3],
          close: c.v[4],
          volume: c.v[5]
        }))
        allCandles.push(candles)

        // next symbol
        if (symbols.length - 1 > currentSymIndex) {
          currentSymCandles = []
          currentSymIndex += 1
          symbol = symbols[currentSymIndex]
          connection.send('resolve_symbol', [
            chartSession,
            `sds_sym_${currentSymIndex}`,
            '=' + JSON.stringify({ symbol, adjustment: 'splits' })
          ])

          connection.send('modify_series', [
            chartSession,
            'sds_1',
            `s${currentSymIndex}`,
            `sds_sym_${currentSymIndex}`,
            timeframe.toString(),
            ''
          ])
          return
        }

        // all symbols loaded
        unsubscribe()
        resolve(allCandles)
      }
    })
  })
}
const clearConsole = () => {
  for (let i = 0; i < 40; i++) {
    const blank = '\n'.repeat(process.stdout.rows)
    console.log(blank)
    readline.cursorTo(process.stdout, 0, 0)
    readline.clearScreenDown(process.stdout)
  }

}
(async function () {
  const rsi = new RSI();
  const connection = await connect()
  while (true) {
    const candles = await getCandles({
      connection,
      symbols: ['BINANCE:BTCUSDTPERP'],
      amount: 40,
      timeframe: 60
    })
    //console.log(`Candles for BINANCE:BTCUSDTPERP:`, candles[0])
    //console.log(candles[0].length)
    /*rsi.calculate(candles[0], candles[0].length, (err, data) => {
     const  data1 = [
        362, 385, 432, 341, 382, 409,
        498, 387, 473, 513, 582, 474,
        544, 582, 681, 557, 628, 707,
        773, 592, 627, 725, 854, 661
      ]
        , alpha = 0.5  // overall smoothing component
        , beta = 0.4   // trend smoothing component
        , gamma = 0.6  // seasonal smoothing component
        , period = 4   // # of observations per season
        , m = 4        // # of future observations to forecast

      const predictions = Forecast(data1, alpha, beta, gamma, period, m);
      console.log(predictions)
    })*/
    const result = await rsi.calculate(candles[0], candles[0].length)
    console.log(result)
    await new Promise(resolve => setTimeout(resolve, 10000))
  }
  await connection.close()

}());
