const API = location.origin + "/api";

function login() {
  let u = document.getElementById('li_user').value.trim();
  let p = document.getElementById('li_pass').value.trim();

  if (!u || !p) {
    document.getElementById('li_msg').innerText = 'Enter creds';
    return;
  }

  fetch(API + '/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'username=' + encodeURIComponent(u) + '&password=' + encodeURIComponent(p)
  })
    .then(r => r.text())
    .then(t => {
      if (t.startsWith("Invalid")) {
        document.getElementById('li_msg').innerText = 'Invalid';
        return;
      }

      localStorage.setItem('g_user', u);
      localStorage.setItem('g_pass', p);
      window.location.href = 'game.html';
    })
    .catch(e => document.getElementById('li_msg').innerText = 'Error');
}


function registerUser() {
  let u = document.getElementById('re_user').value.trim();
  let p = document.getElementById('re_pass').value.trim();

  if (!u || !p) {
    document.getElementById('re_msg').innerText = 'Enter';
    return;
  }

  fetch(API + '/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'username=' + encodeURIComponent(u) + '&password=' + encodeURIComponent(p)
  })
    .then(r => r.text())
    .then(t => {
      if (t.indexOf("User exists") >= 0)
        document.getElementById('re_msg').innerText = 'User exists';
      else
        document.getElementById('re_msg').innerText = 'Registered. Login above.';
    })
    .catch(e => document.getElementById('re_msg').innerText = 'Error');
}