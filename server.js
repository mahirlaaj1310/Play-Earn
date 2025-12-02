// server.js
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const admin = require("firebase-admin");

const SERVICE_ACCOUNT_PATH = "./serviceAccount.json"; // download from Firebase console
const DATABASE_URL = "https://playandearn-2b56b-default-rtdb.firebaseio.com";

admin.initializeApp({
  credential: admin.credential.cert(require(SERVICE_ACCOUNT_PATH)),
  databaseURL: DATABASE_URL
});

const db = admin.database();

const app = express();
app.use(cors());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" } // during dev allow all; restrict in prod
});

/**
 * CONFIG
 */
const ROUND_LENGTH_MS = 60 * 1000;    // 60 seconds per round (adjustable)
const WIN_MULTIPLIER = 9;             // winner gets amount * WIN_MULTIPLIER (tweak as needed)
const PORT = process.env.PORT || 3000;

/**
 * Utility helpers
 */
async function getCurrentRound() {
  const snap = await db.ref("currentRound").get();
  if (!snap.exists()) return null;
  return snap.val();
}

async function setCurrentRound(obj) {
  await db.ref("currentRound").set(obj);
  // also push to a small "rounds" history node (optional)
  await db.ref("rounds").push(obj);
  io.emit("round:updated", obj);
}

async function pushChartNumber(n) {
  await db.ref("chart").push({ num: n, ts: Date.now() });
  // also trim chart to last N elements? optional
  io.emit("chart:updated", { num: n });
}

/**
 * API: register
 * POST /api/register
 * body: { username, password }
 */
app.post("/api/register", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).send("Bad");

    const userRef = db.ref("users/" + username);
    const snap = await userRef.get();

    if (snap.exists()) return res.send("User exists");

    await userRef.set({
      username,
      password,
      balance: 1000,         // starting balance (tweak)
      createdAt: Date.now()
    });

    res.send("Registered");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error");
  }
});

/**
 * API: login
 * POST /api/login
 * body: { username, password }
 */
app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const snap = await db.ref("users/" + username).get();
    if (!snap.exists()) return res.send("Invalid");

    const user = snap.val();
    if (user.password !== password) return res.send("Invalid");

    res.send("OK");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error");
  }
});

/**
 * API: balance
 * GET /api/balance?username=..&password=..
 */
app.get("/api/balance", async (req, res) => {
  try {
    const { username, password } = req.query;
    const snap = await db.ref("users/" + username).get();
    if (!snap.exists()) return res.json({});

    const user = snap.val();
    if (user.password !== password) return res.json({});

    res.json({ balance: user.balance || 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({});
  }
});

/**
 * API: currentRound
 * GET /api/currentRound
 */
app.get("/api/currentRound", async (req, res) => {
  try {
    const round = await getCurrentRound();
    if (!round) return res.json({});
    res.json(round);
  } catch (err) {
    console.error(err);
    res.status(500).json({});
  }
});

/**
 * API: chart
 * GET /api/chart
 * returns array of last N numbers (simple)
 */
app.get("/api/chart", async (req, res) => {
  try {
    const snap = await db.ref("chart").orderByChild("ts").limitToLast(200).get();
    const arr = [];
    if (snap.exists()) {
      snap.forEach(s => arr.push(s.val().num));
    }
    res.json(arr);
  } catch (err) {
    console.error(err);
    res.status(500).json([]);
  }
});

/**
 * API: placeBet
 * POST /api/placeBet
 * body: { username, password, number, amount }
 */
app.post("/api/placeBet", async (req, res) => {
  try {
    const { username, password, number, amount } = req.body;
    const num = parseInt(number);
    const amt = parseFloat(amount);

    if (!username || !password || !num || !amt) return res.status(400).send("Bad");

    // check user & balance
    const userSnap = await db.ref("users/" + username).get();
    if (!userSnap.exists()) return res.send("Error");
    const user = userSnap.val();
    if (user.password !== password) return res.send("Error");

    // check current round & betting window
    const current = await getCurrentRound();
    if (!current) return res.send("NoRound");
    const now = Date.now();
    if (now >= current.endsAt) return res.send("BettingClosed");

    if ((user.balance || 0) < amt) return res.send("Insufficient");

    // deduct balance
    await db.ref("users/" + username + "/balance").set((user.balance || 0) - amt);

    // record bet
    const bet = {
      username,
      number: num,
      amount: amt,
      roundId: current.roundId,
      ts: now
    };
    await db.ref("bets").push(bet);

    io.emit("bet:placed", bet);

    res.send("OK");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error");
  }
});

/**
 * API: history
 * GET /api/history?username=..&password=..
 * returns user's bet history (recent)
 */
app.get("/api/history", async (req, res) => {
  try {
    const { username, password } = req.query;
    const userSnap = await db.ref("users/" + username).get();
    if (!userSnap.exists()) return res.json([]);
    const user = userSnap.val();
    if (user.password !== password) return res.json([]);

    const snap = await db.ref("bets").orderByChild("ts").limitToLast(200).get();
    const arr = [];
    if (snap.exists()) {
      snap.forEach(s => {
        const b = s.val();
        if (b.username === username) arr.push({
          round: b.roundId,
          num: b.number,
          amt: b.amount,
          ts: new Date(b.ts).toLocaleString()
        });
      });
    }
    // sort desc by ts
    arr.sort((a,b)=> (new Date(b.ts)) - (new Date(a.ts)));
    res.json(arr);
  } catch (err) {
    console.error(err);
    res.status(500).json([]);
  }
});

/**
 * ROUND GENERATOR + RESOLVER
 * Creates a new round every ROUND_LENGTH_MS, sets endsAt, and resolves previous round bets.
 */
async function startRoundLoop() {
  // create initial round if none
  let current = await getCurrentRound();
  if (!current) {
    const r = {
      roundId: Date.now(),
      startAt: Date.now(),
      endsAt: Date.now() + ROUND_LENGTH_MS,
      winNumber: null,
      status: "open" // open -> betting allowed
    };
    await setCurrentRound(r);
    current = r;
  }

  setInterval(async () => {
    try {
      const now = Date.now();

      // If current round is still open and endsAt not reached, do nothing
      const cur = await getCurrentRound();
      if (!cur) return;

      // If round hasn't ended yet, and endsAt > now, do nothing
      if (now < cur.endsAt) {
        // still betting window
        return;
      }

      // CLOSE current round and decide win number
      const winNum = Math.floor(Math.random() * 10) + 1; // 1..10
      const closedRound = {
        ...cur,
        winNumber: winNum,
        status: "closed",
        closedAt: now
      };

      // save closed result
      await db.ref("resolvedRounds/" + cur.roundId).set(closedRound);
      io.emit("round:closed", closedRound);

      // fetch bets for this round
      const betsSnap = await db.ref("bets").orderByChild("roundId").equalTo(cur.roundId).get();
      const winners = [];
      if (betsSnap.exists()) {
        const updates = []; // for updating user balances
        betsSnap.forEach(bsnap => {
          const b = bsnap.val();
          if (b.number === winNum) {
            winners.push(b);
          }
        });

        // distribute winnings
        for (const w of winners) {
          const userRef = db.ref("users/" + w.username + "/balance");
          const userSnap2 = await userRef.get();
          const prevBal = (userSnap2.exists() ? userSnap2.val() : 0);
          const payout = w.amount * WIN_MULTIPLIER;
          const newBal = prevBal + payout;
          await userRef.set(newBal);

          // also write to a 'history' or 'wins' node
          await db.ref("wins").push({
            username: w.username,
            roundId: w.roundId,
            number: w.number,
            amountBet: w.amount,
            payout,
            ts: Date.now()
          });
        }
      }

      // push to chart and resolved rounds
      await pushChartNumber(winNum);

      // start next round immediately
      const nextRound = {
        roundId: Date.now(),
        startAt: Date.now(),
        endsAt: Date.now() + ROUND_LENGTH_MS,
        winNumber: null,
        status: "open"
      };
      await setCurrentRound(nextRound);
    } catch (err) {
      console.error("Round loop error:", err);
    }
  }, 2000); // check every 2s; actual rounds driven by endsAt
}

/**
 * Socket.IO basic handlers (optional)
 */
io.on("connection", (socket) => {
  console.log("socket connected:", socket.id);

  socket.on("subscribe", async (data) => {
    // optional: user can subscribe to their username channel etc.
    // example: socket.join(`user:${data.username}`);
  });

  socket.on("disconnect", () => {
    // console.log("socket disconnected", socket.id);
  });
});

/**
 * Start everything
 */
startRoundLoop().then(() => {
  server.listen(PORT, () => {
    console.log("Server started on port", PORT);
  });
});