import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const publicDir = join(root, 'public');
const rooms = new Map();
const PORT = Number(process.env.PORT || 3000);
const TIME_SCALE = Math.max(0.001, Math.min(1, Number(process.env.GAME_TIMING_SCALE || 1)));
const MAX_BODY = 32_000;
const cases = [
  { title: 'The Midnight Diamond', place: 'the mansion ballroom', item: 'the Starling Diamond', time: '12:14 a.m.', clues: ['A smear of blue paint was found on the balcony latch.', 'The display case opened with its key, not force.', 'A camera loop began at 12:11 a.m.', 'A glass of sparkling cider sat untouched beside the case.', 'The east hallway clock stopped at 12:14 a.m.', 'A strip of velvet was caught on the garden gate.'] },
  { title: 'The Vanishing Violin', place: 'the conservatory', item: 'the Bellini violin', time: '10:42 p.m.', clues: ['Rosin dust trails toward the side door.', 'The alarm was silenced with the correct four-digit code.', 'A muddy footprint points toward the greenhouse.', 'The music stand was moved after the lights went out.', 'A guest heard a case latch click at 10:42 p.m.', 'The conservatory window was locked from the inside.'] },
  { title: 'The Missing Moonstone', place: 'the winter garden', item: 'the Moonstone brooch', time: '11:06 p.m.', clues: ['A wet umbrella was left beside the display.', 'The garden lights were switched off from the pantry.', 'A torn silver thread clings to the display velvet.', 'The north door alarm never triggered.', 'A warm cup of tea was found near the service stairs.', 'The display key was returned to its hook.'] },
  { title: 'The Stolen Recipe', place: 'the mansion kitchen', item: 'Madame Vale’s secret recipe', time: '9:37 p.m.', clues: ['Flour footprints lead to the pantry, then stop.', 'The recipe drawer was opened with a hairpin.', 'A timer rang at exactly 9:37 p.m.', 'The back door was bolted from the inside.', 'A burnt sugar smell came from the east stove.', 'One page was copied, but the original stayed behind.'] },
];
const chaosCards = [
  { title: 'The Lights Flicker', text: 'Everyone gives one sentence about where they were when the lights went out. The thief may bluff.' },
  { title: 'A New Clue!', text: 'A torn glove was found near the scene. Discuss who had a reason to be there.' },
  { title: 'Alibi Check', text: 'Choose one suspect and ask them a direct question about their alibi.' },
  { title: 'The Detective’s Hunch', text: 'The detective may reveal their role now, or keep it secret until the vote.' },
  { title: 'Whispers in the Hall', text: 'For one minute, share theories. Then each investigator names their leading suspect.' },
];

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(body));
}
async function body(req) {
  let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > MAX_BODY) throw new Error('Request too large'); }
  return raw ? JSON.parse(raw) : {};
}
function cleanName(v) { return String(v || '').trim().replace(/[<>]/g, '').slice(0, 20); }
function roomCode() { let c; do { c = randomBytes(3).toString('hex').toUpperCase(); } while (rooms.has(c)); return c; }
function findPlayer(room, token) { return room.players.find(p => p.token === token); }
function publicRoom(room, player) {
  const reveal = room.phase === 'reveal';
  return {
    code: room.code, phase: room.phase, phaseEndsAt: room.phaseEndsAt, round: room.round, duelMode: room.duelMode,
    hostId: room.hostId, playerId: player.id, players: room.players.map(p => ({ id: p.id, name: p.name, online: p.online, hasVoted: Boolean(p.vote), score: p.score, role: reveal ? p.role : undefined })),
    scenario: room.scenario ? { title: room.scenario.title, place: room.scenario.place, item: room.scenario.item, time: room.scenario.time } : null,
    publicEvidence: room.publicEvidence, chaos: room.chaos, runoff: room.runoff,
    voteCount: room.players.filter(p => p.vote).length,
    private: player.role ? { role: player.role, clue: player.clue, revealedClue: player.revealedClue } : null,
    result: reveal ? room.result : null,
    rules: ['Share, hide, or bluff about your private clue.', 'Investigators win by voting for the thief. The thief wins by escaping the vote.', 'Votes stay secret until everyone votes. A tie triggers one runoff; a second tie means the thief escapes.'],
  };
}
function getAuth(req, room) {
  const token = req.headers['x-player-token'];
  const player = findPlayer(room, token);
  if (player) { player.online = true; player.lastSeen = Date.now(); }
  return player;
}
function setPhase(room, phase, duration) { room.phase = phase; room.phaseEndsAt = Date.now() + duration * TIME_SCALE; }
function beginRound(room) {
  room.round += 1; room.scenario = cases[randomInt(cases.length)]; room.chaos = null; room.publicEvidence = [];
  room.players.forEach(p => { p.vote = null; p.role = null; p.clue = null; p.revealedClue = false; });
  const order = room.players.slice().sort(() => Math.random() - 0.5);
  order[0].role = 'Thief'; order[1].role = 'Detective';
  for (let i = 2; i < order.length; i++) order[i].role = i === 2 ? 'Witness' : 'Guest';
  const cluePool = room.scenario.clues.slice().sort(() => Math.random() - 0.5);
  order.forEach((p, i) => { p.clue = cluePool[i % cluePool.length]; });
  room.duelMode = room.players.length === 2;
  if (room.duelMode) {
    const detective = order.find(p => p.role === 'Detective');
    const thief = order.find(p => p.role === 'Thief');
    detective.clue = `A reliable witness places ${thief.name} near the scene at ${room.scenario.time}. Can the thief talk their way out of it?`;
  }
  room.publicEvidence.push(`The ${room.scenario.item} vanished from ${room.scenario.place} at ${room.scenario.time}.`);
  room.runoff = false; room.result = null; setPhase(room, 'investigation', 5 * 60_000);
}
function finishVote(room) {
  const counts = new Map(); room.players.forEach(p => counts.set(p.vote, (counts.get(p.vote) || 0) + 1));
  const max = Math.max(...counts.values()); const leaders = [...counts].filter(([, n]) => n === max).map(([id]) => id);
  if (leaders.length > 1 && !room.runoff) {
    room.players.forEach(p => { p.vote = null; }); room.runoff = true; setPhase(room, 'runoff', 30_000); return;
  }
  const accusedId = leaders.length === 1 ? leaders[0] : null;
  const thief = room.players.find(p => p.role === 'Thief');
  const caught = accusedId === thief.id;
  if (caught) room.players.filter(p => p.id !== thief.id).forEach(p => p.score += 2);
  else thief.score += 3;
  room.result = { accusedId, thiefId: thief.id, caught, message: caught ? `${room.players.find(p => p.id === accusedId).name} was the thief. The investigators solved the case!` : 'The thief slipped away. The mystery remains unsolved.' };
  setPhase(room, 'reveal', 0);
}
function updateRoom(room) {
  for (const p of room.players) p.online = Date.now() - p.lastSeen < 15_000;
  if (!room.phaseEndsAt || Date.now() < room.phaseEndsAt) return;
  if (room.phase === 'investigation') { room.chaos = chaosCards[randomInt(chaosCards.length)]; setPhase(room, 'chaos', 3 * 60_000); }
  else if (room.phase === 'chaos') setPhase(room, 'voting', 2 * 60_000);
  else if (room.phase === 'voting' || room.phase === 'runoff') finishVote(room);
}
setInterval(() => { for (const room of rooms.values()) updateRoom(room); }, 500);

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type,x-player-token', 'access-control-allow-methods': 'GET,POST,OPTIONS' }); return res.end(); }
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      if (req.method === 'POST' && url.pathname === '/api/rooms') {
        const data = await body(req); const name = cleanName(data.name); if (!name) return json(res, 400, { error: 'Enter a nickname first.' });
        const code = roomCode(), id = randomUUID(), token = randomBytes(24).toString('hex');
        const player = { id, name, token, online: true, lastSeen: Date.now(), score: 0, vote: null, role: null, clue: null, revealedClue: false };
        const room = { code, hostId: id, players: [player], phase: 'lobby', phaseEndsAt: null, round: 0, scenario: null, chaos: null, publicEvidence: [], runoff: false, result: null, duelMode: false };
        rooms.set(code, room); return json(res, 201, { code, token, playerId: id });
      }
      const match = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]+)(?:\/(join|start|reveal-clue|vote|replay))?$/);
      if (!match) return json(res, 404, { error: 'That route does not exist.' });
      const [, code, action] = match, room = rooms.get(code);
      if (!room) return json(res, 404, { error: 'Room not found. Check the code or create a new room.' });
      if (action === 'join' && req.method === 'POST') {
        const data = await body(req); const name = cleanName(data.name);
        if (!name) return json(res, 400, { error: 'Enter a nickname first.' });
        if (room.phase !== 'lobby' && room.phase !== 'reveal') return json(res, 409, { error: 'This case is already in progress.' });
        if (room.players.length >= 6) return json(res, 409, { error: 'This room is full.' });
        if (room.players.some(p => p.name.toLowerCase() === name.toLowerCase())) return json(res, 409, { error: 'That nickname is already in this room.' });
        const id = randomUUID(), token = randomBytes(24).toString('hex');
        room.players.push({ id, name, token, online: true, lastSeen: Date.now(), score: 0, vote: null, role: null, clue: null, revealedClue: false });
        return json(res, 201, { code, token, playerId: id });
      }
      const player = getAuth(req, room); if (!player) return json(res, 401, { error: 'Your seat could not be restored. Rejoin with the room code.' });
      updateRoom(room);
      if (req.method === 'GET' && !action) return json(res, 200, publicRoom(room, player));
      if (req.method !== 'POST') return json(res, 405, { error: 'Use POST for this action.' });
      if (action === 'start') {
        if (player.id !== room.hostId) return json(res, 403, { error: 'Only the room creator can start the round.' });
        if (room.phase !== 'lobby' && room.phase !== 'reveal') return json(res, 409, { error: 'A round is already in progress.' });
        if (room.players.length < 2) return json(res, 409, { error: 'Invite at least one more player before starting.' });
        if (room.players.some(p => !p.online)) return json(res, 409, { error: 'Wait for everyone to reconnect before starting.' });
        beginRound(room); return json(res, 200, { ok: true });
      }
      if (action === 'reveal-clue') {
        if (room.phase !== 'investigation' && room.phase !== 'chaos') return json(res, 409, { error: 'You can reveal a clue during investigation or the chaos round.' });
        if (player.revealedClue) return json(res, 409, { error: 'You have already revealed your clue this round.' });
        player.revealedClue = true; room.publicEvidence.push(`${player.name} reveals: “${player.clue}”`); return json(res, 200, { ok: true });
      }
      if (action === 'vote') {
        if (room.phase !== 'voting' && room.phase !== 'runoff') return json(res, 409, { error: 'Voting has not opened yet.' });
        if (player.vote) return json(res, 409, { error: 'Your vote is locked in.' });
        const data = await body(req); if (!room.players.some(p => p.id === data.targetId)) return json(res, 400, { error: 'Choose someone in this room.' });
        if (data.targetId === player.id) return json(res, 400, { error: 'You cannot vote for yourself.' });
        player.vote = data.targetId;
        if (room.players.every(p => p.vote)) finishVote(room);
        return json(res, 200, { ok: true });
      }
      if (action === 'replay') {
        if (room.phase !== 'reveal') return json(res, 409, { error: 'Finish the current round first.' });
        if (player.id !== room.hostId) return json(res, 403, { error: 'Only the room creator can start a new round.' });
        beginRound(room); return json(res, 200, { ok: true });
      }
      return json(res, 404, { error: 'That action does not exist.' });
    }
    const path = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
    const file = join(publicDir, path.replace(/^\/+/, ''));
    if (!file.startsWith(publicDir)) return json(res, 403, { error: 'Forbidden' });
    const data = await readFile(file);
    const type = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' }[extname(file)] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' }); res.end(data);
  } catch (err) { json(res, err instanceof SyntaxError ? 400 : 500, { error: err instanceof SyntaxError ? 'Invalid request data.' : 'Something went wrong on the server.' }); }
});

server.listen(PORT, '0.0.0.0', () => console.log(`Last Call is running on http://localhost:${PORT}`));
