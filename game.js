// game.js

const API = location.origin + "/api";
const socket = io(); // ensure socket.io server running

function start() {
  let u = localStorage.getItem('g_user'), p = localStorage.getItem('g_pass');
  if (!u || !p) { location.href = 'index.html'; return; }
  document.getElementById('who').innerText = u;

  loadBalance();
  loadCurrentRound();
  loadHistory();
  loadChart();
}

// ----------------- Fetch functions -----------------

function loadBalance() {
  let u = localStorage.getItem('g_user'), p = localStorage.getItem('g_pass');
  fetch(`${API}/balance?username=${encodeURIComponent(u)}&password=${encodeURIComponent(p)}`)
    .then(r => r.json())
    .then(j => document.getElementById('bal').innerText = j.balance);
}

function loadCurrentRound() {
  fetch(`${API}/currentRound`)
    .then(r => r.json())
    .then(j => document.getElementById('round').innerText = j.roundId);
}

function loadHistory() {
  let u = localStorage.getItem('g_user');
  fetch(`${API}/history?username=${encodeURIComponent(u)}`)
    .then(r => r.json())
    .then(arr => {
      let s = '';
      arr.forEach(x => s += `Round ${x.round} | Num ${x.number} | ₹${x.amt} | ${x.ts}\n`);
      document.getElementById('hist').innerText = s;
    });
}

function loadChart() {
  fetch(`${API}/chart`).then(r => r.json()).then(arr => {
    document.getElementById('chart').innerText = arr.slice(-20).join(', ');
  });
}

// ----------------- Place Bet -----------------

function placeBet() {
  let u = localStorage.getItem('g_user'), p = localStorage.getItem('g_pass');
  let num = document.getElementById('num').value, amt = document.getElementById('amt').value;
  fetch(`${API}/placeBet`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `username=${encodeURIComponent(u)}&password=${encodeURIComponent(p)}&number=${encodeURIComponent(num)}&amount=${encodeURIComponent(amt)}`
  }).then(r => r.text()).then(t => {
    if (t.indexOf("Insufficient") >= 0) document.getElementById('msg').innerText = 'Insufficient balance';
    else {
      document.getElementById('msg').innerText = 'Bet placed';
      loadHistory();
      loadChart();
      loadBalance();
    }
  }).catch(e => document.getElementById('msg').innerText = 'Error');
}

// ----------------- Logout -----------------

function logout() {
  localStorage.removeItem('g_user');
  localStorage.removeItem('g_pass');
  location.href = 'index.html';
}

// ----------------- Socket.io realtime updates -----------------

socket.on('round:updated', data => {
  document.getElementById('round').innerText = data.roundId;
  loadChart();
  loadHistory();
  loadBalance();
});

socket.on('round:closed', data => {
  alert(`Round ${data.roundId} closed. Winning number: ${data.winningNumber}`);
  loadBalance();
  loadHistory();
  loadChart();
});

socket.on('bet:placed', bet => {
  loadChart();
  loadHistory();
  loadBalance();
});

// ----------------- Initialize -----------------
start();