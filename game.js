const API = location.origin + "/api";

function start() {
  let u = localStorage.getItem('g_user'),
      p = localStorage.getItem('g_pass');

  if (!u || !p) {
    location.href = 'index.html';
    return;
  }

  document.getElementById('who').innerText = u;

  // Load balance
  fetch(API + '/balance?username=' + encodeURIComponent(u) + '&password=' + encodeURIComponent(p))
    .then(r => r.text())
    .then(t => {
      try {
        let j = JSON.parse(t);
        document.getElementById('bal').innerText = j.balance;
      } catch (e) {}
    });

  // Load round
  fetch(API + '/currentRound')
    .then(r => r.text())
    .then(t => {
      try {
        let j = JSON.parse(t);
        document.getElementById('round').innerText = j.roundId;
      } catch (e) {}
    });

  loadHistory();
  loadChart();

  // Auto refresh
  setInterval(() => {
    fetch(API + '/currentRound')
      .then(r => r.text())
      .then(t => {
        try {
          let j = JSON.parse(t);
          document.getElementById('round').innerText = j.roundId;
        } catch (e) {}
      });

    fetch(API + '/chart')
      .then(r => r.text())
      .then(t => {
        try {
          let arr = JSON.parse(t);
          renderChart(arr);
        } catch (e) {}
      });

    fetch(API + '/balance?username=' + encodeURIComponent(u) + '&password=' + encodeURIComponent(p))
      .then(r => r.text())
      .then(t => {
        try {
          let j = JSON.parse(t);
          document.getElementById('bal').innerText = j.balance;
        } catch (e) {}
      });

  }, 5000);
}

function placeBet() {
  let u = localStorage.getItem('g_user'),
      p = localStorage.getItem('g_pass');

  let num = document.getElementById('num').value;
  let amt = document.getElementById('amt').value;

  fetch(API + '/placeBet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'username=' + encodeURIComponent(u) +
            '&password=' + encodeURIComponent(p) +
            '&number=' + encodeURIComponent(num) +
            '&amount=' + encodeURIComponent(amt)
    })
    .then(r => r.text())
    .then(t => {
      if (t.indexOf("Insufficient") >= 0) {
        document.getElementById('msg').innerText = 'Insufficient balance';
      } else {
        document.getElementById('msg').innerText = 'Bet placed';
        loadHistory();
      }
    })
    .catch(e => document.getElementById('msg').innerText = 'Error');
}

function loadHistory() {
  let u = localStorage.getItem('g_user'),
      p = localStorage.getItem('g_pass');

  fetch(API + '/history?username=' + encodeURIComponent(u) + '&password=' + encodeURIComponent(p))
    .then(r => r.text())
    .then(t => {
      try {
        let arr = JSON.parse(t);
        let s = '';
        arr.forEach(x => s += 'Round ' + x.round + ' | Num ' + x.num + ' | ₹' + x.amt + ' | ' + x.ts + '\n');
        document.getElementById('hist').innerText = s;
      } catch (e) {}
    });
}

function loadChart() {
  fetch(API + '/chart')
    .then(r => r.text())
    .then(t => {
      try {
        let arr = JSON.parse(t);
        renderChart(arr);
      } catch (e) {}
    });
}

function renderChart(arr) {
  document.getElementById('chart').innerText = arr.slice(-20).join(', ');
}

function logout() {
  localStorage.removeItem('g_user');
  localStorage.removeItem('g_pass');
  location.href = 'index.html';
}

start();