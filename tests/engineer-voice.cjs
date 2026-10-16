const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// The engineer radio (the game's own EngineerRadio class, taken from index.html) against a scripted speech engine:
// a message being spoken always finishes — driving, pit entry, position changes and new events never cancel or
// restart it — queued messages go by priority, merge, expire and never flood, browser failures are handled, and
// leaving the race stops everything.
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const src = html.slice(html.indexOf('class EngineerRadio {'), html.indexOf('\nclass AudioEngine'));

function world({ speakThrows = false } = {}) {
  let now = 0;
  const log = { spoken: [], cancels: 0 }, els = {};
  const el = (id) => els[id] || (els[id] = { id, textContent: '', dataset: {}, attrs: {}, classes: new Set(),
    classList: { add: (c) => els[id].classes.add(c), remove: (c) => els[id].classes.delete(c), contains: (c) => els[id].classes.has(c) },
    setAttribute(k, v) { this.attrs[k] = v; } });
  const synth = {
    speaking: null,
    getVoices: () => [{ lang: 'en-GB', name: 'Test', localService: true }],
    speak(u) { if (speakThrows) throw new Error('blocked'); log.spoken.push(u.text); this.speaking = u; },
    cancel() { log.cancels++; this.speaking = null; },
  };
  function Utterance(text) { this.text = text; }
  const window = { speechSynthesis: synth, SpeechSynthesisUtterance: Utterance };
  const G = { session: null, player: null, attract: false, paused: false, audio: { muted: false } };
  const S = { volume: 70, engineerVoice: 'on' };
  const performance = { now: () => now };
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const Radio = new Function('window', 'G', 'S', '$', 'performance', 'clamp', src + '\nreturn EngineerRadio;')(window, G, S, el, performance, clamp);
  const radio = new Radio(); radio.unlocked = true;
  // a race and a player with a scripted engineer
  const inbox = [];
  const engineer = { collect: () => inbox.splice(0), valid: (m) => !m.invalid && G.session.time <= m.expires };
  const player = { input: { throttle: 0, brake: 0, steer: 0 }, pit: null, position: 5, dnf: false, finished: false, engineer };
  G.player = player; G.session = { time: 100, over: false, lightsOut: true, lightsOutTime: 0 };
  const msg = (key, category, say, extra = {}) => ({ key, category, rank: category === 'critical' ? 3 : category === 'opportunity' ? 2 : 1, say, caption: say.toUpperCase().split(' ').slice(0, 4).join(' '),
    fingerprint: key + (extra.fp || ''), at: G.session.time, expires: G.session.time + (extra.life || 15), ...extra });
  const tick = (ms = 100) => { now += ms; G.session.time += ms / 1000; radio.update(); };
  const finishSpeech = () => { const u = synth.speaking; if (u && u.onend) { synth.speaking = null; u.onend(); } };
  const startSpeech = () => { const u = synth.speaking; if (u && u.onstart) u.onstart(); };
  return { radio, synth, log, els, G, S, inbox, msg, tick, finishSpeech, startSpeech, player };
}

test('a message being spoken finishes: braking, throttle, steering, gears, pit entry, contact, position changes and new events never cut it', () => {
  const w = world();
  w.inbox.push(w.msg('ahead-pace', 'opportunity', 'P6 is losing pace. You are closing.'));
  w.tick(); w.startSpeech();
  assert.deepEqual(w.log.spoken, ['P6 is losing pace. You are closing.']);
  for (let k = 0; k < 60; k++) {
    // the driver does everything at once, the race moves on
    w.player.input.brake = k % 2; w.player.input.throttle = 1 - (k % 2); w.player.input.steer = Math.sin(k);
    if (k === 20) w.player.pit = { phase: 'approach' };
    if (k === 25) w.player.position = 3;
    if (k === 30) w.inbox.push(w.msg('closing', 'opportunity', 'You are gaining four tenths a lap.'));
    if (k === 35) w.inbox.push(w.msg('fwing', 'critical', 'Front wing damaged. Expect understeer.'));
    w.tick(100);
  }
  assert.equal(w.log.cancels, 0, 'nothing cancelled the announcement');
  assert.equal(w.log.spoken.length, 1, 'nothing started over it');
  assert.equal(w.radio.current.message.key, 'ahead-pace');
  w.finishSpeech(); w.tick(800);
  // the critical message goes next, ahead of the opportunity queued before it
  for (let k = 0; k < 40 && w.log.spoken.length < 2; k++) w.tick(100);
  assert.equal(w.log.spoken[1], 'Front wing damaged. Expect understeer.');
  w.startSpeech(); w.finishSpeech(); for (let k = 0; k < 40 && w.log.spoken.length < 3; k++) w.tick(100);
  assert.equal(w.log.spoken[2], 'You are gaining four tenths a lap.');
  assert.equal(w.log.cancels, 0);
  assert.equal(w.radio.stats.finished, 2);
});

test('the queue: priority order, duplicates merged, expired or no-longer-true messages dropped, never more than four', () => {
  const w = world();
  w.inbox.push(w.msg('a', 'strategy', 'First message.')); w.tick(); w.startSpeech();
  w.inbox.push(w.msg('nostop', 'strategy', 'Your tyres may last to the finish.'),
    w.msg('closing', 'opportunity', 'You are gaining two tenths a lap.', { fp: '1' }),
    w.msg('closing', 'opportunity', 'You are gaining five tenths a lap.', { fp: '2' }), // the same situation, newer reading
    w.msg('rain', 'strategy', 'Rain likely in the next few minutes.', { life: 1 }),         // expires before it can be said
    w.msg('puncture', 'critical', 'Puncture. Pit when safe.'),
    w.msg('stale', 'opportunity', 'Car ahead has pitted.', { invalid: true }));                // no longer true
  w.tick();
  assert.ok(w.radio.queue.length <= 4);
  assert.equal(w.radio.queue.filter(m => m.key === 'closing').length, 1, 'merged');
  assert.equal(w.radio.queue.find(m => m.key === 'closing').say, 'You are gaining five tenths a lap.');
  assert.ok(!w.radio.queue.some(m => m.key === 'stale'), 'dropped: no longer true');
  for (let k = 0; k < 30; k++) w.tick(100);
  assert.ok(!w.radio.queue.some(m => m.key === 'rain'), 'dropped: expired');
  const order = []; let guard = 0;
  while ((w.radio.queue.length || w.radio.current) && guard++ < 400) { if (w.radio.current && w.radio.current.speaking && !w.radio.current.started) w.startSpeech(); w.finishSpeech(); w.tick(200); if (w.log.spoken.length > order.length + 1) order.push(w.log.spoken[w.log.spoken.length - 1]); }
  assert.deepEqual(w.log.spoken.slice(1), ['Puncture. Pit when safe.', 'You are gaining five tenths a lap.', 'Your tyres may last to the finish.']);
  assert.equal(w.log.cancels, 0);
  // the HUD caption goes away with its message: nothing stale is left on screen
  assert.equal(w.els.engineerRadio.classes.has('active'), false);
});

test('a flood of triggers never builds a backlog', () => {
  const w = world();
  for (let k = 0; k < 50; k++) { w.inbox.push(w.msg('k' + k, k % 7 ? 'opportunity' : 'strategy', 'Message ' + k + '.')); w.tick(50); }
  assert.ok(w.radio.queue.length <= 4, 'queue ' + w.radio.queue.length);
});

test('browser speech failures: blocked speech and a throwing engine are detected; the caption still shows; the queue moves on', () => {
  const w = world();
  w.inbox.push(w.msg('a', 'critical', 'Engine overheating. Lift and coast.'), w.msg('b', 'strategy', 'Track is drying.'));
  w.tick(); // speaking requested, but the browser never starts it (autoplay rules)
  assert.equal(w.els.radioText.textContent.length > 0, true);
  for (let k = 0; k < 40; k++) w.tick(100);
  assert.equal(w.radio.stats.blocked, 1, 'blocked speech detected');
  assert.ok(w.radio.stats.spoken === 0, 'not counted as spoken');
  for (let k = 0; k < 40 && w.log.spoken.length < 2; k++) w.tick(100);
  assert.equal(w.log.spoken.length, 2, 'the next message is tried');
  const t = world({ speakThrows: true });
  t.inbox.push(t.msg('a', 'critical', 'Puncture. Pit when safe.'));
  t.tick();
  assert.equal(t.radio.stats.failed, 1); assert.equal(t.els.engineerRadio.classes.has('active'), true, 'caption shown');
});

test('leaving the race or switching the voice off stops speech; pausing does not cut it', () => {
  const w = world();
  w.inbox.push(w.msg('a', 'opportunity', 'Car ahead has wing damage.'), w.msg('b', 'strategy', 'Rain likely soon.'));
  w.tick(); w.startSpeech();
  w.G.paused = true; for (let k = 0; k < 10; k++) w.tick(100);
  assert.equal(w.log.cancels, 0, 'pause keeps the sentence'); assert.equal(w.log.spoken.length, 1, 'and starts nothing new');
  w.G.paused = false;
  w.radio.reset(); // leaving or restarting the race
  assert.equal(w.log.cancels, 1); assert.equal(w.radio.queue.length, 0); assert.equal(w.radio.current, null);
  assert.equal(w.els.engineerRadio.classes.has('active'), false);
  const v = world();
  v.inbox.push(v.msg('a', 'opportunity', 'You are gaining three tenths a lap.')); v.tick(); v.startSpeech();
  v.S.engineerVoice = 'off'; v.tick();
  assert.equal(v.log.cancels, 1, 'the player switched the voice off');
});
