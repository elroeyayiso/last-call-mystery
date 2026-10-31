const $ = (id) => document.getElementById(id);
const sessionKey = 'last-call-session-v1';
let session = null, snapshot = null, poller = null, timerLoop = null, toastTimeout = null;

function readSession() { try { return JSON.parse(localStorage.getItem(sessionKey)); } catch { return null; } }
function saveSession(s) { session = s; localStorage.setItem(sessionKey, JSON.stringify(s)); }
function clearSession() { session = null; snapshot = null; localStorage.removeItem(sessionKey); clearInterval(poller); clearInterval(timerLoop); $('game').classList.add('hidden'); $('home').classList.remove('hidden'); }
function showToast(message) { const t = $('toast'); t.textContent = message; t.classList.add('show'); clearTimeout(toastTimeout); toastTimeout = setTimeout(() => t.classList.remove('show'), 2200); }
function errorAtEntry(message) { $('entry-error').textContent = message; }
async function api(path, options = {}) {
  const headers = { 'content-type': 'application/json', ...(options.headers || {}) };
  if (session?.token) headers['x-player-token'] = session.token;
  const res = await fetch(path, { ...options, headers });
  let data; try { data = await res.json(); } catch { data = {}; }
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}
async function createRoom() {
  errorAtEntry(''); const name = $('nickname').value.trim(); if (!name) return errorAtEntry('Add a nickname to enter the case.');
  try { const data = await api('/api/rooms', { method: 'POST', body: JSON.stringify({ name }) }); saveSession({ code: data.code, token: data.token, playerId: data.playerId }); openGame(); }
  catch (e) { errorAtEntry(e.message); }
}
async function joinRoom() {
  errorAtEntry(''); const name = $('nickname').value.trim(), code = $('room-code').value.trim().toUpperCase();
  if (!name) return errorAtEntry('Add a nickname to enter the case.'); if (code.length !== 6) return errorAtEntry('Room codes have six characters.');
  try { const data = await api(`/api/rooms/${encodeURIComponent(code)}/join`, { method: 'POST', body: JSON.stringify({ name }) }); saveSession({ code: data.code, token: data.token, playerId: data.playerId }); openGame(); }
  catch (e) { errorAtEntry(e.message); }
}
function openGame() { $('home').classList.add('hidden'); $('game').classList.remove('hidden'); refresh(); clearInterval(poller); poller = setInterval(refresh, 1200); clearInterval(timerLoop); timerLoop = setInterval(updateTimer, 250); }
async function refresh() {
  if (!session) return;
  try { snapshot = await api(`/api/rooms/${session.code}`); $('connection').textContent = 'CONNECTED'; render(); }
  catch (e) { $('connection').textContent = 'RECONNECTING…'; if (/Room not found|seat could not be restored/i.test(e.message)) { clearSession(); errorAtEntry(`${e.message} Create a new room or join again.`); } }
}
function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
function render() {
  const s = snapshot; if (!s) return;
  $('display-code').textContent = s.code; $('player-count').textContent = `${s.players.length} / 6`; $('roster-count').textContent = String(s.players.length).padStart(2, '0'); $('round-label').textContent = `ROUND ${String(s.round || 1).padStart(2, '0')}`;
  $('phase-label').textContent = phaseNames[s.phase] || s.phase.toUpperCase(); $('game-title').textContent = s.scenario?.title || 'The case begins.';
  $('game-subtitle').textContent = s.scenario ? `${s.duelMode ? 'DUEL MODE · ' : ''}The ${s.scenario.item} disappeared from ${s.scenario.place}.` : 'Waiting for the room to fill. Share your code with the crew.';
  $('lobby-panel').classList.toggle('hidden', s.phase !== 'lobby'); $('round-panel').classList.toggle('hidden', s.phase === 'lobby' || s.phase === 'reveal'); $('reveal-panel').classList.toggle('hidden', s.phase !== 'reveal');
  renderPlayers(); renderRoster(); if (s.phase === 'lobby') renderLobby(); else if (s.phase === 'reveal') renderReveal(); else renderRound(); updateTimer();
}
const phaseNames = { lobby: 'LOBBY', investigation: 'INVESTIGATION', chaos: 'CHAOS ROUND', voting: 'FINAL ACCUSATION', runoff: 'RUNOFF VOTE', reveal: 'THE REVEAL' };
function renderPlayers() {
  const s = snapshot, list = $('players'); list.replaceChildren();
  s.players.forEach(p => { const row = el('div', 'player-row'), avatar = el('div', 'avatar', p.name.slice(0, 1).toUpperCase()), detail = el('div', ''), name = el('div', 'player-name', p.name), sub = el('div', 'player-sub', p.online ? 'IN THE MANSION' : 'DISCONNECTED'); detail.append(name, sub); row.append(avatar, detail); if (p.id === s.hostId) row.append(el('span', 'player-badge host', 'HOST')); list.append(row); });
}
function renderRoster() {
  const s = snapshot, list = $('roster'); list.replaceChildren();
  s.players.forEach(p => { const row = el('div', `roster-item${p.online ? '' : ' offline'}`); row.append(el('span', 'live-dot'), el('span', '', p.name)); if (p.role) row.append(el('span', 'roster-role', p.role.toUpperCase())); else if (['voting', 'runoff'].includes(s.phase)) row.append(el('span', 'roster-role', p.hasVoted ? 'VOTED' : 'THINKING')); list.append(row); });
}
function button(text, action, cls = 'button-inline') { const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', action); return b; }
function renderLobby() {
  const s = snapshot, actions = $('lobby-actions'); actions.replaceChildren();
  if (s.playerId === s.hostId) { const b = button(s.players.length < 2 ? 'WAITING FOR YOUR CREW…' : 'START THE CASE  ↗', async () => runAction(`/api/rooms/${s.code}/start`, {}), 'button button-primary'); b.disabled = s.players.length < 2; actions.append(b); }
  else actions.append(el('p', 'vote-status', 'Waiting for the host to start the case…'));
}
function renderRound() {
  const s = snapshot, content = $('phase-content'), pc = $('private-card'); $('scenario-line').textContent = `${s.scenario.title} · ${s.scenario.time}`;
  pc.replaceChildren(); const role = el('div', 'role', `YOUR ROLE · ${s.private?.role || '—'}`), clue = el('p', '', s.private?.clue || 'Your private clue will appear here.'), hint = el('div', 'hint', 'KEEP THIS CARD PRIVATE.'); pc.append(role, clue, hint);
  content.replaceChildren();
  const title = el('h2', 'phase-title', phaseTitles[s.phase] || 'The case continues.'), copy = el('p', 'phase-copy', phaseDescriptions[s.phase] || 'Stay sharp.'); content.append(title, copy);
  if (s.phase === 'chaos' && s.chaos) { const event = el('div', 'event-card'); event.append(el('small', '', `✦ EVENT CARD · ${s.chaos.title.toUpperCase()}`), el('p', '', s.chaos.text)); content.append(event); }
  const evidence = el('div', 'section-label', 'PUBLIC EVIDENCE'); evidence.append(el('span', '', `${s.publicEvidence.length} CLUE${s.publicEvidence.length === 1 ? '' : 'S'}`)); content.append(evidence);
  const list = el('ul', 'evidence-list'); s.publicEvidence.forEach(item => list.append(el('li', '', item))); content.append(list);
  if (['investigation', 'chaos'].includes(s.phase)) { const reveal = button(s.private?.revealedClue ? 'YOUR CLUE IS ON THE BOARD' : 'REVEAL MY CLUE', () => runAction(`/api/rooms/${s.code}/reveal-clue`, {})); reveal.disabled = Boolean(s.private?.revealedClue); content.append(reveal); }
  if (['voting', 'runoff'].includes(s.phase)) renderVoting(content, s);
  if (s.phase === 'reveal' && s.result) renderReveal();
}
const phaseTitles = { investigation: 'Compare your clues.', chaos: 'A twist in the story.', voting: 'Who took the diamond?', runoff: 'The room is split.' };
const phaseDescriptions = { investigation: 'Talk it out. Share your clue when you are ready, or keep it close. The public evidence updates for everyone.', chaos: 'A new event has turned the room upside down. Use the time to question alibis and rethink the evidence.', voting: 'Choose one suspect. Your vote is private and locks when you submit it.', runoff: 'The first accusation was tied. Cast one final vote; a second tie lets the thief escape.' };
function renderVoting(content, s) {
  const grid = el('div', 'vote-grid');
  if (s.players.find(p => p.id === s.playerId)?.hasVoted) { content.append(el('p', 'vote-status', 'Your vote is locked. Waiting for the rest of the room…')); }
  else s.players.filter(p => p.id !== s.playerId).forEach(p => { const b = el('button', 'vote-choice'); b.append(document.createTextNode(p.name), el('small', '', 'CAST SECRET VOTE')); b.addEventListener('click', () => runAction(`/api/rooms/${s.code}/vote`, { targetId: p.id })); grid.append(b); });
  content.append(grid, el('p', 'vote-status', `${s.voteCount} of ${s.players.length} votes in. Votes stay hidden until the reveal.`));
}
function renderReveal() {
  const s = snapshot, panel = $('reveal-panel'); panel.replaceChildren(); panel.append(el('div', 'section-label', 'CASE CLOSED · FINAL REPORT'));
  const banner = el('div', 'reveal-banner'); banner.append(el('strong', '', s.result?.caught ? 'Mystery solved.' : 'The thief got away.'), el('p', '', s.result?.message || 'The round has ended.')); panel.append(banner);
  s.players.forEach(p => { const row = el('div', 'reveal-player'); row.append(el('span', '', `${p.name} · ${p.role}`), el('span', 'score', `${p.score} PTS`)); panel.append(row); });
  if (s.playerId === s.hostId) panel.append(button('PLAY ANOTHER ROUND  ↗', () => runAction(`/api/rooms/${s.code}/replay`, {}), 'button button-primary'));
  else panel.append(el('p', 'vote-status', 'Waiting for the host to open another case…'));
}
async function runAction(path, payload) { try { await api(path, { method: 'POST', body: JSON.stringify(payload) }); await refresh(); } catch (e) { showToast(e.message); } }
function updateTimer() {
  if (!snapshot?.phaseEndsAt) { $('timer').textContent = snapshot?.phase === 'lobby' ? '—:—' : '00:00'; return; }
  const remaining = Math.max(0, snapshot.phaseEndsAt - Date.now()), min = Math.floor(remaining / 60000), sec = Math.floor((remaining % 60000) / 1000);
  $('timer').textContent = `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
$('create-room').addEventListener('click', createRoom); $('join-room').addEventListener('click', joinRoom);
$('room-code').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
$('room-code').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); }); $('nickname').addEventListener('keydown', e => { if (e.key === 'Enter') createRoom(); });
$('copy-code').addEventListener('click', async () => { try { await navigator.clipboard.writeText(snapshot.code); showToast('Room code copied. Send it to your crew.'); } catch { showToast(`Room code: ${snapshot.code}`); } });
$('leave-room').addEventListener('click', () => { clearSession(); });
$('nickname').value = localStorage.getItem('last-call-name') || '';
$('nickname').addEventListener('change', () => localStorage.setItem('last-call-name', $('nickname').value.trim()));
session = readSession(); if (session?.code && session?.token) openGame();
