import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EncounterDialogue } from '../src/systems/EncounterDialogue.js';
import { DialoguePlayer, dialogueTake, spatialVoice } from '../src/core/DialoguePlayer.js';
import lines from '../src/config/dialogue.json' with { type: 'json' };
import { LevelState } from '../src/world/LevelGenerator.js';

const cast = {
  a: { group: 'near-idle', lang: 'ja-JP', actor: 'guard', speaker: '番兵', line: 'まだ雨か。', zh: '还在下雨啊。' },
  b: { group: 'near-idle', lang: 'ja-JP', actor: 'guard', speaker: '番兵', line: '交代はまだか。' },
  c: { group: 'near-idle', lang: 'ja-JP', actor: 'officer', speaker: '将校', line: '静かだな。' },
  d: { group: 'near-alert', lang: 'ja-JP', actor: 'guard', speaker: '番兵', line: '誰だ！' },
  h: { group: 'near-hero', lang: 'zh-CN', speaker: 'hero', line: '我在。', xiaLine: '听见了。' }
};
const player = { x: 0, z: 0, y: 0, hp: 100, sneaking: false, currentHeight: () => 1.7 };
const guard = () => ({ type: 'soldier', hp: 50, ht: 1.8, x: 4, z: 0, awake: false, sees: false });

test('Japanese takes belong to the antagonist and Mandarin takes follow the chosen protagonist', () => {
  for (const id of ['ranger', 'xia']) {
    const take = dialogueTake('a', { id, name: '主角' }, cast);
    assert.deepEqual([take.src, take.text, take.lang], ['assets/voices/ja/guard/a.mp3', 'まだ雨か。', 'ja-JP']);
    assert.equal(take.translation, '还在下雨啊。');
  }
  const hero = dialogueTake('h', { id: 'xia', name: '陆青梧' }, cast);
  assert.deepEqual([hero.text, hero.src, hero.lang], ['听见了。', 'assets/voices/xia/h.mp3', 'zh-CN']);
});

test('every shipped line resolves to the language and recording of its speaker on both presets', () => {
  const allies = new Set(['hero', '地下联络人', '']);
  for (const [cue, row] of Object.entries(lines)) {
    for (const id of ['ranger', 'xia']) {
      const take = dialogueTake(cue, { id, name: '主角' });
      if (allies.has(row.speaker)) {
        assert.equal(take.lang, 'zh-CN', cue);
        assert.equal(take.translation, '', cue);
        if (row.speaker === 'hero') assert.equal(take.src, `assets/voices/${id}/${cue}.mp3`);
      } else {
        assert.equal(take.lang, 'ja-JP', cue);
        assert.match(row.line, /[ぁ-んァ-ヶ]/u, cue);
        assert.equal(take.translation, row.zh, cue);
        assert.match(take.translation, /\p{Script=Han}/u, cue);
        assert.doesNotMatch(take.translation, /[ぁ-んァ-ヶ]/u, cue);
        assert.equal(take.src, `assets/voices/ja/${row.actor}/${cue}.mp3`);
      }
      const audio = readFileSync(new URL('../public/' + take.src, import.meta.url));
      assert.ok(audio.length > 1024 && (audio.toString('ascii', 0, 3) === 'ID3' || audio[0] === 0xff), take.src);
    }
  }
});

test('each Japanese recording carries its two captions together and switching to Mandarin clears the translation', () => {
  const player = Object.assign(Object.create(DialoguePlayer.prototype), {
    media: { play: () => Promise.resolve(), pause() {} }, volume: .9, current: 0
  });
  const preset = { id: 'xia', name: '陆青梧' };
  const text = player.start('boss-challenge', preset);
  assert.deepEqual(player.subtitle, { text, lang: 'ja-JP', translation: lines['boss-challenge'].zh });
  assert.equal(player.media.src, 'assets/voices/ja/boss/boss-challenge.mp3');
  const reply = player.start('boss-reply', preset);
  assert.deepEqual(player.subtitle, { text: reply, lang: 'zh-CN', translation: '' });
  assert.ok(reply.includes(lines['boss-reply'].xiaLine));
  player.stop();
  assert.equal(player.subtitle, null);
});

test('all six enemy roles have multiple voiced idle and alerted lines available in play', () => {
  const dialogue = new EncounterDialogue();
  for (const type of ['thug', 'gunman', 'soldier', 'officer', 'gunner', 'boss']) {
    for (const group of ['near-idle', 'near-alert']) {
      const first = dialogue.choose(group, type), second = dialogue.choose(group, type);
      assert.notEqual(first, second, `${group}/${type}`);
      assert.equal(lines[first].actor, type === 'soldier' ? 'guard' : type);
      assert.equal(lines[first].actor, lines[second].actor);
    }
  }
});

test('an individual keeps the same Japanese voice from small talk to combat', t => {
  let roll = 0;
  t.mock.method(Math, 'random', () => roll);
  const world = new LevelState(), dialogue = new EncounterDialogue();
  for (const [type, primary, alternate] of [['thug', 'thug', 'gang'], ['soldier', 'guard', 'enemy'],
    ['gunman', 'gunman'], ['officer', 'officer'], ['gunner', 'gunner'], ['boss', 'boss']]) {
    for (roll of [.15, .85]) {
      const e = world.spawnEnemy(type, 0, 0, 1);
      assert.equal(e.voiceActor, roll < 1 / 3 && alternate ? alternate : primary);
      const events = ['near-idle', 'near-alert', 'spot-' + type, 'heard-shot', 'witness', 'ally-down'];
      if (type === 'thug') events.push('charge');
      else if (type !== 'boss') events.push('surrender');
      for (const event of events) {
        const cue = dialogue.choose(event, e.type, e.voiceActor);
        assert.equal(lines[cue]?.actor, e.voiceActor, `${e.voiceActor}/${event}`);
      }
    }
  }
});

test('nearby lines rotate through the right role and do not repeat at the shuffle boundary', () => {
  const dialogue = new EncounterDialogue(cast, () => 0.1);
  const cues = Array.from({ length: 6 }, () => dialogue.choose('near-idle', 'soldier'));
  assert.deepEqual(new Set(cues), new Set(['a', 'b']));
  assert.ok(cues.slice(1).every((cue, i) => cue !== cues[i]));
  assert.equal(dialogue.choose('near-idle', 'officer'), 'c');
  assert.equal(dialogue.choose('near-alert', 'boss'), null);
});

test('proximity respects walls, a busy channel, speaker state and the boundary of each encounter', () => {
  const dialogue = new EncounterDialogue(cast, () => 0.1);
  const e = guard(), world = { enemies: [e], los3: () => false }, calls = [];
  const speak = (group, duration, source) => { calls.push([group, source]); return true; };
  const tick = (seconds, free = true) => {
    for (let i = 0; i < seconds * 4; i++) dialogue.update(0.25, world, player, free, speak);
  };
  tick(4);
  world.los3 = () => true;
  tick(5, false);
  assert.equal(calls.length, 0);
  tick(35);
  assert.deepEqual(calls, [['near-idle', e]]);
  assert.equal(e.awake, false);
  e.x = 18; tick(2); e.x = 4; tick(3);
  assert.equal(calls.length, 2);
  e.awake = true; tick(20);
  assert.equal(calls.length, 2);
  e.sees = true; tick(2);
  assert.equal(calls.at(-1)[0], 'near-alert');
  e.hp = 0; tick(12);
  assert.equal(calls.length, 3);
});

test('a close Mandarin response stays tied to the encounter and yields to story dialogue', () => {
  const e = { ...guard(), awake: true, sees: true };
  const world = { enemies: [e], los3: () => true };
  for (const cancel of [false, true]) {
    const dialogue = new EncounterDialogue(cast, () => 0.1), events = [];
    const speak = group => { events.push(group); return true; };
    for (let i = 0; i < 8 && !events.length; i++) dialogue.update(0.5, world, player, true, speak);
    if (cancel) dialogue.interrupt(3);
    for (let i = 0; i < 16; i++) dialogue.update(0.5, world, player, true, speak);
    assert.deepEqual(events, cancel ? ['near-alert'] : ['near-alert', 'near-hero']);
  }
});

test('recognizing the player allows the same speaker to follow idle chatter with an alerted line', () => {
  const dialogue = new EncounterDialogue(cast, () => .1);
  const e = guard(), world = { enemies: [e], los3: () => true }, events = [];
  const nearby = { ...player, sneaking: true };
  const advance = frames => {
    for (let i = 0; i < frames; i++) dialogue.update(.5, world, nearby, true, group => { events.push(group); return true; });
  };
  advance(4);
  e.awake = true;
  advance(21);
  assert.deepEqual(events, ['near-idle']);
  e.sees = true;
  advance(1);
  assert.deepEqual(events, ['near-idle', 'near-alert']);
  advance(60);
  assert.deepEqual(events, ['near-idle', 'near-alert']);
});

test('spatialVoice pans enemy speech left and right relative to player facing and attenuates with distance', () => {
  const listener = { x: 0, z: 0, ang: 0 }; // facing +X, right is +Z, left is -Z
  const rightSp = spatialVoice({ x: 2, z: 6 }, listener);
  const leftSp = spatialVoice({ x: 2, z: -6 }, listener);
  const frontSp = spatialVoice({ x: 6, z: 0 }, listener);
  const rearSp = spatialVoice({ x: -6, z: 0 }, listener);
  const farSp = spatialVoice({ x: 28, z: 0 }, listener);
  assert.ok(rightSp.pan > 0.65, `right pan=${rightSp.pan}`);
  assert.ok(leftSp.pan < -0.65, `left pan=${leftSp.pan}`);
  assert.ok(Math.abs(frontSp.pan) < 0.05, `front pan=${frontSp.pan}`);
  assert.ok(rearSp.gain < frontSp.gain, 'voices behind the player attenuate slightly');
  assert.ok(farSp.gain < frontSp.gain && farSp.gain >= 0.28, `far gain=${farSp.gain}`);
});
