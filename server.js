// server.js
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const admin = require('firebase-admin');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

// Firebase service account JSON
const serviceAccount = require('./playandearn-2b56b-firebase-adminsdk-fbsvc-c1da8ff8b0.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://playandearn-2b56b-default-rtdb.firebaseio.com"
});

const db = admin.database();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(cors());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public'))); // frontend folder

const PORT = 3000;

// --- API ENDPOINTS ---

// Register user
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.send('Enter creds');

  const ref = db.ref('users/' + username);
  const snapshot = await ref.get();
  if (snapshot.exists()) return res.send('User exists');

  await ref.set({ password, balance: 100 });
  return res.send('Registered');
});

// Login user
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.send('Enter creds');

  const snapshot = await db.ref('users/' + username).get();
  if (!snapshot.exists() || snapshot.val().password !== password) return res.send('Invalid');

  res.send('Success');
});

// Get balance
app.get('/api/balance', async (req, res) => {
  const { username } = req.query;
  const snapshot = await db.ref('users/' + username).get();
  if (!snapshot.exists()) return res.send(JSON.stringify({ balance: 0 }));
  res.send(JSON.stringify({ balance: snapshot.val().balance }));
});

// Place bet
app.post('/api/placeBet', async (req, res) => {
  const { username, number, amount } = req.body;
  const amt = parseInt(amount);
  const userRef = db.ref('users/' + username);
  const userSnap = await userRef.get();
  if (!userSnap.exists()) return res.send('Invalid user');

  const balance = userSnap.val().balance;
  if (balance < amt) return res.send('Insufficient');

  // Deduct balance
  await userRef.update({ balance: balance - amt });

  // Add to round history
  const roundRef = db.ref('rounds/current/players');
  await roundRef.push({ username, number, amount: amt, ts: Date.now() });

  // Emit to all clients
  io.emit('bet:placed', { username, number, amount: amt });
  res.send('Bet placed');
});

// Get history
app.get('/api/history', async (req, res) => {
  const { username } = req.query;
  const snap = await db.ref('users/' + username + '/history').get();
  res.send(snap.exists() ? JSON.stringify(snap.val()) : '[]');
});

// --- SOCKET.IO ---

io.on('connection', (socket) => {
  console.log('New client connected');
  socket.on('disconnect', () => console.log('Client disconnected'));
});

// --- START SERVER ---

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});