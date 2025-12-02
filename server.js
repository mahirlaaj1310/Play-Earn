// server.js
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const bcrypt = require('bcryptjs');
const admin = require('firebase-admin');

const SERVICE_ACCOUNT_PATH = process.env.SA_PATH || path.join(__dirname, 'serviceAccountKey.json');
const DATABASE_URL = process.env.FIRE_DB_URL || 'https://playandearn-2b56b-default-rtdb.firebaseio.com';

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
const io = new Server(server, { cors: { origin: '*' } });

/* CONFIG via .env or defaults */
const PORT = process.env.PORT || 3000;
const ROUND_LENGTH_MS = parseInt(process.env.ROUND_MS || '60000', 10); // 60s
const WIN_MULTIPLIER = parseFloat(process.env.WIN_MULTIPLIER || '9');   // payout multiplier
const SALT_ROUNDS = 10;

/* Helpers */
async function getCurrentRound() {
  const snap = await db.ref('currentRound').get();
  return snap.exists() ? snap.val() : null;
}
async function setCurrentRound(obj) {
  await db.ref('currentRound').set(obj);
  await db.ref('rounds').push(obj);
  io.emit('round:updated', obj);
}
async function pushChartNumber(n) {
  await db.ref('chart').push({ num: n, ts: Date.now() });
  io.emit('chart:updated', { num: n });
}

/* API: register */
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).send('Bad');

    const userRef = db.ref('users/' + username);
    const snap = await userRef.get();
    if (snap.exists()) return res.send('User exists');

    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    await userRef.set({ username, passwordHash: hash, balance: 1000, createdAt: Date.now() });
    res.send('Registered');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error');
  }
});

/* API: login */
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const snap = await db.ref('users/' + username).get();
    if (!snap.exists()) return res.send('Invalid');

    const user = snap.val();
    const ok = await bcrypt.compare(password, user.passwordHash || '');
    if (!ok) return res.send('Invalid');

    res.send('OK');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error');
  }
});

/* API: balance */
app.get('/api/balance', async (req, res) => {
  try {
    const { username, password } = req.query;
    const snap = await db.ref('users/' + username).get();
    if (!snap.exists()) return res.json({});
    const user = snap.val();
    const ok = await bcrypt.compare(password, user.passwordHash || '');
    if (!ok) return res.json({});
    res.json({ balance: user.balance || 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({});
  }
});

/* API: currentRound */
app.get('/api/currentRound', async (req, res) => {
  try {
    const round = await getCurrentRound();
    res.json(round || {});
  } catch (err) {
    console.error(err);
    res.status(500).json({});
  }
});

/* API: chart */
app.get('/api/chart', async (req, res) => {
  try {
    const snap = await db.ref('chart').orderByChild('ts').limitToLast(200).get();
    const arr = [];
    if (snap.exists()) snap.forEach(s => arr.push(s.val().num));
    res.json(arr);
  } catch (err) {
    console.error(err);
    res.status(500).json([]);
  }
});

/* API: placeBet */
app.post('/api/placeBet', async (req, res) => {
  try {
    const { username, password, number, amount } = req.body;
    const num = parseInt(number, 10);
    const amt = parseFloat(amount);
    if (!username || !password || !num || !amt) return res.status(400).send('Bad');

    const userSnap = await db.ref('users/' + username).get();
    if (!userSnap.exists()) return res.send('Error');
    const user = userSnap.val();
    const ok = await bcrypt.compare(password, user.passwordHash || '');
    if (!ok) return res.send('Error');

    const current = await getCurrentRound();
    if (!current) return res.send('NoRound');
    const now = Date.now();
    if (now >= current.endsAt) return res.send('BettingClosed');

    if ((user.balance || 0) < amt) return res.send('Insufficient');

    await db.ref('users/' + username + '/balance').set((user.balance || 0) - amt);

    const bet = { username, number: num, amount: amt, roundId: current.roundId, ts: now };
    await db.ref('bets').push(bet);

    io.emit('bet:placed', bet);
    res.send('OK');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error');
  }
});

/* API: history */
app.get('/api/history', async (req, res) => {
  try {
    const { username, password } = req.query;
    const userSnap = await db.ref('users/' + username).get();
    if (!userSnap.exists()) return res.json([]);
    const user = userSnap.val();
    const ok = await bcrypt.compare(password, user.passwordHash || '');
    if (!ok) return res.json([]);

    const snap = await db.ref('bets').orderByChild('ts').limitToLast(500).get();
    const arr = [];
    if (snap.exists()) {
      snap.forEach(s => {
        const b = s.val();
        if (b.username === username) arr.push({ round: b.roundId, num: b.number, amt: b.amount, ts: new Date(b.ts).toLocaleString() });
      });
    }
    arr.sort((a,b)=> new Date(b.ts) - new Date(a.ts));
    res.json(arr);
  } catch (err) {
    console.error(err);
    res.status(500).json([]);
  }
});

/* ROUND loop */
async function startRoundLoop() {
  let current = await getCurrentRound();
  if (!current) {
    const r = { roundId: Date.now(), startAt: Date.now(), endsAt: Date.now() + ROUND_LENGTH_MS, winNumber: null, status: 'open' };
    await setCurrentRound(r);
    current = r;
  }

  setInterval(async () => {
    try {
      const now = Date.now();
      const cur = await getCurrentRound();
      if (!cur) return;
      if (now < cur.endsAt) return;

      // close
      const winNum = Math.floor(Math.random() * 10) + 1;
      const closedRound = { ...cur, winNumber: winNum, status: 'closed', closedAt: now };
      await db.ref('resolvedRounds/' + cur.roundId).set(closedRound);
      io.emit('round:closed', closedRound);

      // process bets
      const betsSnap = await db.ref('bets').orderByChild('roundId').equalTo(cur.roundId).get();
      if (betsSnap.exists()) {
        for (const bs of Object.values(betsSnap.val())) {
          if (bs.number === winNum) {
            const userRef = db.ref('users/' + bs.username + '/balance');
            const userSnap = await userRef.get();
            const prev = (userSnap.exists() ? userSnap.val() : 0);
            const payout = bs.amount * WIN_MULTIPLIER;
            await userRef.set(prev + payout);
            await db.ref('wins').push({ username: bs.username, roundId: bs.roundId, payout, ts: Date.now() });
          }
        }
      }

      await pushChartNumber(winNum);

      const nextRound = { roundId: Date.now(), startAt: Date.now(), endsAt: Date.now() + ROUND_LENGTH_MS, winNumber: null, status: 'open' };
      await setCurrentRound(nextRound);
    } catch (err) {
      console.error('Round loop err', err);
    }
  }, 2000);
}

/* sockets */
io.on('connection', socket => {
  console.log('socket connected', socket.id);
  socket.on('disconnect', () => {});
});

/* start */
startRoundLoop().then(()=> {
  server.listen(PORT, ()=> console.log('Server listening on', PORT));
});