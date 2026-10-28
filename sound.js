// 効果音（sounds/ の <名前>.mp3、なければ <名前>.wav）。オン・オフと音量はこのブラウザに記憶する（設定画面で変える）
// 使い方: Sound.play('draw')。ファイルがない音は鳴らさない（エラーにはしない）
// 音の名前と鳴る場面は README の「効果音」の表を参照
const Sound = (() => {
  const KEY = 'dm-deckmaker-sound';
  const VOLUME_KEY = 'dm-deckmaker-volume';
  // 同じ音が続けて鳴らないよう、この間隔（ms）より短い2回目は鳴らさない（まとめて移動したときなど）
  const GAP = 120;
  const EXTS = ['mp3', 'wav'];
  const NAMES = [
    'draw', 'shuffle', 'tap', 'untap',
    'summon', 'evolve', 'spell', 'trigger', 'field',
    'mana-light', 'mana-water', 'mana-dark', 'mana-fire', 'mana-nature', 'mana-multi',
    'attack', 'attacked', 'block', 'break', 'destroy', 'discard',
    'phase', 'myturn', 'endturn', 'win', 'lose', 'button', 'cancel',
  ];
  // マナチャージの音：カードの文明（多色はまとめて mana-multi）
  const MANA = { 光: 'light', 水: 'water', 闇: 'dark', 火: 'fire', 自然: 'nature' };

  let on = true;
  let volume = 0.6;
  try {
    on = localStorage.getItem(KEY) !== 'off';
    const v = Number.parseFloat(localStorage.getItem(VOLUME_KEY));
    if (v >= 0 && v <= 1) volume = v;
  } catch {}
  const audio = {};
  const lastPlayed = {};

  const manaName = (civs = []) => (civs.length === 1 && MANA[civs[0]] ? `mana-${MANA[civs[0]]}` : 'mana-multi');

  // mp3 を読めなければ wav を試し、どちらもなければ鳴らさない
  function load(name) {
    if (audio[name] !== undefined) return audio[name];
    const a = new Audio();
    let i = 0;
    a.preload = 'auto';
    a.addEventListener('error', () => {
      i++;
      if (i < EXTS.length) a.src = `sounds/${name}.${EXTS[i]}`;
      else audio[name] = null;
    });
    a.src = `sounds/${name}.${EXTS[0]}`;
    audio[name] = a;
    return a;
  }

  function play(name) {
    if (!on || !NAMES.includes(name)) return;
    const now = performance.now();
    if (now - (lastPlayed[name] ?? -Infinity) < GAP) return;
    lastPlayed[name] = now;
    const base = load(name);
    if (!base) return;
    // 鳴っている途中なら複製して重ねて鳴らす
    const a = base.paused || base.ended ? base : base.cloneNode();
    a.volume = volume;
    a.currentTime = 0;
    a.play().catch(() => {});
  }

  function setOn(value) {
    on = !!value;
    try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch {}
    play('button');
  }

  function setVolume(value) {
    volume = Math.min(1, Math.max(0, value));
    try { localStorage.setItem(VOLUME_KEY, String(volume)); } catch {}
  }

  // 最初に鳴らすときに遅れないよう、ページを開いたら読み込んでおく（効果音がオンのとき）
  if (on) addEventListener('load', () => NAMES.forEach(load));

  return { play, manaName, setOn, setVolume, NAMES, get on() { return on; }, get volume() { return volume; } };
})();
