// server.js
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const admin = require('firebase-admin');
const path = require('path');
const bcrypt = require('bcryptjs');
const http = require('http');
const { Server } = require("socket.io");
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;
const FIRE_DB_URL = process.env.FIRE_DB_URL || "https://playandearn-2b56b-default-rtdb.firebaseio.com";
const SERVICE_ACCOUNT_PATH = process.env.SA_PATH || './playandearn-2b56b-firebase-adminsdk-fbsvc-c1da8ff8b0.json';
const ROUND_MS = parseInt(process.env.ROUND_MS) || 60000;
const WIN_MULTIPLIER = parseInt(process.env.WIN_MULTIPLIER) || 9;

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(require(SERVICE_ACCOUNT_PATH)),
  databaseURL: FIRE_DB_URL
});

const db = admin.database();

app.use(cors());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname))); // serve frontend files

// ------------------- Auth API -------------------

// Register user
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.send("Enter creds");
  const ref = db.ref("users/" + username);
  const snapshot = await ref.once("value");
  if (snapshot.exists()) return res.send("User exists");
  const hash = await bcrypt.hash(password, 10);
  await ref.set({ password: hash, balance: 1000 }); // default balance
  res.send("Registered");
});

// Login user
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.send("Enter creds");
  const snapshot = await db.ref("users/" + username).once("value");
  if (!snapshot.exists()) return res.send("Invalid");
  const user = snapshot.val();
  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.send("Invalid");
  res.send("Success");
});

// Get balance
app.get('/api/balance', async (req, res) => {
  const { username, password } = req.query;
  if (!username || !password) return res.send(JSON.stringify({ balance: 0 }));
  const snapshot = await db.ref("users/" + username).once("value");
  if (!snapshot.exists()) return res.send(JSON.stringify({ balance: 0 }));
  const user = snapshot.val();
  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.send(JSON.stringify({ balance: 0 }));
  res.send(JSON.stringify({ balance: user.balance || 0 }));
});

// ------------------- Betting & Rounds -------------------

let currentRound = { roundId: 1, bets: [] };

// Place bet
app.post('/api/placeBet', async (req, res) => {
  const { username, password, number, amount } = req.body;
  const amt = parseInt(amount);
  if (!username || !password || !number || !amount) return res.send("Invalid");

  const snap = await db.ref("users/" + username).once("value");
  if (!snap.exists()) return res.send("Invalid");
  const user = snap.val();
  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.send("Invalid");

  if (user.balance < amt) return res.send("Insufficient");

  // Deduct balance
  await db.ref("users/" + username + "/balance").set(user.balance - amt);

  // Save bet
  const bet = { username, number: parseInt(number), amt, ts: new Date().toISOString(), round: currentRound.roundId };
  currentRound.bets.push(bet);

  // Broadcast bet placed
  io.emit('bet:placed', bet);

  res.send("Bet placed");
});

// History
app.get('/api/history', async (req, res) => {
  const { username } = req.query;
  if (!username) return res.send("[]");
  const snap = await db.ref("users/" + username + "/history").once("value");
  res.send(JSON.stringify(snap.val() || []));
});

// Current round
app.get('/api/currentRound', (req, res) => {
  res.send(JSON.stringify({ roundId: currentRound.roundId }));
});

// Chart
app.get('/api/chart', (req, res) => {
  const recent = currentRound.bets.slice(-20).map(b => b.number);
  res.send(JSON.stringify(recent));
});

// ------------------- Multiplayer Round Timer -------------------

setInterval(async () => {
  if (currentRound.bets.length === 0) {
    currentRound.roundId++;
    currentRound.bets = [];
    io.emit('round:updated', currentRound);
    return;
  }

  const winningNumber = Math.floor(Math.random() * 10) + 1;
  io.emit('round:closed', { roundId: currentRound.roundId, winningNumber });

  // Payout winners
  for (const bet of currentRound.bets) {
    if (bet.number === winningNumber) {
      const snap = await db.ref("users/" + bet.username).once("value");
      if (!snap.exists()) continue;
      const user = snap.val();
      const newBal = (user.balance || 0) + bet.amt * WIN_MULTIPLIER;
      await db.ref("users/" + bet.username + "/balance").set(newBal);
      // Save to history
      const histRef = db.ref("users/" + bet.username + "/history");
      const histSnap = await histRef.once("value");
      const hist = histSnap.val() || [];
      hist.push(bet);
      await histRef.set(hist);
    }
  }

  currentRound.roundId++;
  currentRound.bets = [];
  io.emit('round:updated', currentRound);
}, ROUND_MS);

// ------------------- Start server -------------------

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});