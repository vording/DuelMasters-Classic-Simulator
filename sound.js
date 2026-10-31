// 効果音（sounds/ の <名前>.mp3、なければ <名前>.wav）。オン・オフと音量はこのブラウザに記憶する（設定画面で変える）
// 使い方: Sound.play('draw')。ファイルがない音は鳴らさない（エラーにはしない）。BGM は下の Bgm.play('select')
// 音の名前と鳴る場面は README の「効果音」の表を参照
const Sound = (() => {
  const KEY = 'dm-deckmaker-sound';
  const VOLUME_KEY = 'dm-deckmaker-volume';
  // 主音量（効果音と BGM の両方にかける）
  const MASTER_KEY = 'dm-deckmaker-master';
  // 同じ音が続けて鳴らないよう、この間隔（ms）より短い2回目は鳴らさない（まとめて移動したときなど）
  const GAP = 120;
  const EXTS = ['mp3', 'wav'];
  // 音を差し替えたら上げる（ブラウザに残った古い音を使わないように）
  const VERSION = 2;
  const NAMES = [
    'draw', 'shuffle', 'tap', 'untap',
    'summon', 'evolve', 'spell', 'trigger', 'field',
    'mana-light', 'mana-water', 'mana-dark', 'mana-fire', 'mana-nature', 'mana-multi',
    'attack', 'attacked', 'block', 'break', 'destroy', 'discard',
    'phase', 'myturn', 'endturn', 'win', 'lose', 'button', 'cancel',
    'open', 'close', 'card-add', 'card-remove', 'page',
  ];
  // マナチャージの音：カードの文明（多色はまとめて mana-multi）
  const MANA = { 光: 'light', 水: 'water', 闇: 'dark', 火: 'fire', 自然: 'nature' };

  let on = true;
  let volume = 0.6;
  let master = 1;
  try {
    on = localStorage.getItem(KEY) !== 'off';
    const v = Number.parseFloat(localStorage.getItem(VOLUME_KEY));
    if (v >= 0 && v <= 1) volume = v;
    const m = Number.parseFloat(localStorage.getItem(MASTER_KEY));
    if (m >= 0 && m <= 1) master = m;
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
      if (i < EXTS.length) a.src = `sounds/${name}.${EXTS[i]}?v=${VERSION}`;
      else audio[name] = null;
    });
    a.src = `sounds/${name}.${EXTS[0]}?v=${VERSION}`;
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
    a.volume = volume * master;
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

  // 主音量：流れている BGM にもすぐ反映する
  function setMaster(value) {
    master = Math.min(1, Math.max(0, value));
    try { localStorage.setItem(MASTER_KEY, String(master)); } catch {}
    if (typeof Bgm !== 'undefined') Bgm.refresh();
  }

  // 最初に鳴らすときに遅れないよう、ページを開いたら読み込んでおく（効果音がオンのとき）
  if (on) addEventListener('load', () => NAMES.forEach(load));

  // ---------- メニューの音（画面全体） ----------
  // ボタン・リンク・タブを押したら button。ダイアログを開いたら open、閉じたら close
  // （長押しの詳細表示は頻繁なので鳴らさない。勝敗のダイアログは win / lose が鳴るので鳴らさない）
  document.addEventListener('click', (e) => {
    const el = e.target.closest?.('button, a[href], .deck-tile, [data-phone-tab], [data-phone-sheet]');
    if (!el || el.disabled || el.closest('.card-detail.peek')) return;
    play('button');
  }, true);
  const quiet = (dlg) => dlg.id === 'result' || dlg.classList.contains('peek');
  const showModal = HTMLDialogElement.prototype.showModal;
  HTMLDialogElement.prototype.showModal = function (...args) {
    const wasOpen = this.open;
    showModal.apply(this, args);
    if (!wasOpen && !quiet(this)) play('open');
  };
  const close = HTMLDialogElement.prototype.close;
  HTMLDialogElement.prototype.close = function (...args) {
    const wasOpen = this.open;
    close.apply(this, args);
    if (wasOpen && !quiet(this)) play('close');
  };

  return { play, manaName, setOn, setVolume, setMaster, NAMES, get on() { return on; }, get volume() { return volume; }, get master() { return master; } };
})();

// BGM（bgm/<名前>.mp3 をくり返し流す）
// select：デッキ選択、edit：デッキ編集、ready：対戦の準備（開始画面・相手待ち）、battle：対戦中
// ・Web Audio で流し、曲の頭と終わりの無音を除いた区間をループする。曲の終わりのフェードアウトが
//   「曲が終わった」と聞こえないよう、終わりの数秒を次の周の頭と重ねてクロスフェードする
//   （ファイルを読めない場合＝index.html を直接開いたときなどは、ふつうの <audio> のループ）
// ・曲を変えるときは、今の曲をフェードアウトしながら次の曲をフェードインする
// ・オン・オフと音量はこのブラウザに記憶する。ブラウザが自動再生を止めたら、画面に最初に触れたときに流す
// ・タブが見えていない間は止める（同じPCの2つのタブで対戦しても重ならない）
const Bgm = (() => {
  const KEY = 'dm-deckmaker-bgm';
  const VOLUME_KEY = 'dm-deckmaker-bgm-volume';
  const FADE_OUT = 800;
  const FADE_IN = 600;
  // これより小さい音は無音とみなす（曲の頭と終わりを削る）
  const SILENCE = 0.003;
  // 曲の終わりは、これより小さくなったところで切る（フェードアウトの消えかけを流さない）
  const TAIL = 0.02;
  // ループのつなぎ目で重ねる秒数
  const XFADE = 3;
  // 曲の頭を削る秒数（ループしても、この部分は流さない）
  const SKIP = { ready: 1 };
  // 曲の大きさをそろえる：曲ごとの音の大きさ（LUFS。ffmpeg の ebur128 で測った値）を、いちばん小さい曲（TARGET）に合わせて下げる
  // 曲を足したら、ffmpeg -i bgm/<名前>.mp3 -af ebur128 -f null - の Integrated loudness を書き足す（書いていない曲はそのまま）
  const LOUDNESS = {
    select: -9.7, edit: -10.1, ready: -9.0,
    battle: -10.3, 'battle-cyber-girl': -11.8, 'battle-all-is-vanity': -11.2, 'battle-seraphic-takedown': -14.2,
    'battle-watering': -10.2, 'solo-re-roots': -10.2, settings: -9.7,
  };
  const TARGET = Math.min(...Object.values(LOUDNESS));
  // 曲の一覧（ギャラリーと対戦画面の曲選びで使う）。group：battle＝ネット対戦、solo＝一人回し（ゲームごとにランダム）
  const TRACKS = [
    { file: 'select', title: 'State Of The Art', scene: 'デッキ選択' },
    { file: 'edit', title: 'evergreen', scene: 'デッキ編集' },
    { file: 'ready', title: 'beatonic nation', scene: '対戦の準備' },
    { file: 'settings', title: 'California Gurls', scene: '設定' },
    { file: 'battle', title: 'Hybrid Landscape', scene: '対戦', group: 'battle' },
    { file: 'battle-cyber-girl', title: 'Cyber girl', scene: '対戦', group: 'battle' },
    { file: 'battle-all-is-vanity', title: 'All is vanity', scene: '対戦', group: 'battle' },
    { file: 'battle-seraphic-takedown', title: 'SERAPHIC TAKEDOWN', scene: '対戦', group: 'battle' },
    { file: 'battle-watering', title: 'WATERING', scene: '一人回し', group: 'solo' },
    { file: 'solo-re-roots', title: 'RE-ROOTS', scene: '一人回し', group: 'solo' },
  ];
  const trackGain = (name) => (name in LOUDNESS ? Math.min(1, 10 ** ((TARGET - LOUDNESS[name]) / 20)) : 1);
  let on = true;
  let volume = 0.35;
  try {
    on = localStorage.getItem(KEY) !== 'off';
    const v = Number.parseFloat(localStorage.getItem(VOLUME_KEY));
    if (v >= 0 && v <= 1) volume = v;
  } catch {}

  let track = null; // 流したい曲
  let current = null; // 流している曲 { name, ramp(to, ms), stop(ms), resume(), pause() }
  let seq = 0; // 曲を読み込んでいる間に、別の曲に変わったかを見分ける

  let ctx = null;
  const getCtx = () => (ctx ??= new (window.AudioContext || window.webkitAudioContext)());

  // 曲を読み込んで、無音を除いた区間 { buffer, start, end }（秒）を返す。読めなければ null
  const buffers = new Map();
  function loadBuffer(name) {
    if (!buffers.has(name)) {
      buffers.set(name, fetch(`bgm/${name}.mp3`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
        .then((data) => getCtx().decodeAudioData(data))
        .then((buffer) => trimSilence(buffer, SKIP[name] ?? 0))
        .catch(() => { buffers.delete(name); return null; }));
    }
    return buffers.get(name);
  }

  // skip：頭から削る秒数（そのあとの無音も削る）
  function trimSilence(buffer, skip = 0) {
    const chans = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
    const loud = (i) => chans.some((d) => Math.abs(d[i]) > SILENCE);
    let s = Math.min(buffer.length - 1, Math.round(skip * buffer.sampleRate));
    while (s < buffer.length && !loud(s)) s++;
    // 終わり：0.05秒ごとの音の大きさ（RMS）が TAIL を超える最後の位置
    const win = Math.round(buffer.sampleRate * 0.05);
    const rms = (from) => {
      let sum = 0;
      for (const d of chans) for (let i = from; i < from + win; i++) sum += d[i] * d[i];
      return Math.sqrt(sum / (win * chans.length));
    };
    let e = buffer.length - win;
    while (e > s && rms(e) < TAIL) e -= win;
    e += win;
    if (e - s < buffer.sampleRate * XFADE * 3) return { buffer, start: skip, end: buffer.duration };
    return { buffer, start: s / buffer.sampleRate, end: Math.min(buffer.length, e) / buffer.sampleRate };
  }

  // Web Audio：無音を除いた区間をくり返す。1周ごとに新しく流し、前の周の終わり XFADE 秒と重ねてつなぐ
  function webPlayer(name, { buffer, start, end }) {
    const k = trackGain(name);
    const c = getCtx();
    const gain = c.createGain();
    gain.gain.value = 0;
    gain.connect(c.destination);
    const len = end - start;
    const sources = new Set();
    let timer = null;
    // at：流し始める時刻。first：最初の周は頭からそのまま（フェードインはしない）
    function loop(at, first) {
      const src = c.createBufferSource();
      const g = c.createGain();
      src.buffer = buffer;
      src.connect(g);
      g.connect(gain);
      if (!first) {
        g.gain.setValueAtTime(0, at);
        g.gain.linearRampToValueAtTime(1, at + XFADE);
      }
      g.gain.setValueAtTime(1, at + len - XFADE);
      g.gain.linearRampToValueAtTime(0, at + len);
      src.start(at, start, len);
      sources.add(src);
      src.onended = () => {
        sources.delete(src);
        g.disconnect();
      };
      // 次の周は、この周が終わる XFADE 秒前から。少し前に予約しておく
      // （止めている間＝タブが裏にある間は時計が進まないので、予約せずに待つ）
      const next = at + len - XFADE;
      const tick = () => {
        if (c.state !== 'running' || next - c.currentTime > 1.5) timer = setTimeout(tick, 1000);
        else loop(next, false);
      };
      timer = setTimeout(tick, Math.max(0, (next - c.currentTime - 1) * 1000));
    }
    loop(c.currentTime + 0.05, true);
    return {
      name,
      ramp(to, ms) {
        to *= k * Sound.master;
        const t = c.currentTime;
        gain.gain.cancelScheduledValues(t);
        gain.gain.setValueAtTime(gain.gain.value, t);
        gain.gain.linearRampToValueAtTime(to, t + ms / 1000);
      },
      stop(ms) {
        this.ramp(0, ms);
        clearTimeout(timer);
        setTimeout(() => {
          for (const src of sources) try { src.stop(); } catch {}
          gain.disconnect();
          // 止めた曲は、メモリを空けるため読み直すことにする（また流すときに読み込む）
          if (current?.name !== name) buffers.delete(name);
        }, ms + 80);
      },
      resume() {
        if (c.state !== 'running') c.resume().catch(() => {});
        if (c.state !== 'running') waitForTouch();
      },
      pause() { c.suspend().catch(() => {}); },
    };
  }

  // 読めなかったとき：ふつうの <audio> のループ（音量は少しずつ変える）
  function elementPlayer(name) {
    const k = trackGain(name);
    const a = new Audio(`bgm/${name}.mp3`);
    const skip = SKIP[name] ?? 0;
    a.volume = 0;
    // 頭を削る曲は、最後まで流れたら削った位置から流し直す
    a.loop = !skip;
    if (skip) {
      a.addEventListener('loadedmetadata', () => { a.currentTime = skip; }, { once: true });
      a.addEventListener('ended', () => {
        a.currentTime = skip;
        a.play().catch(() => {});
      });
    }
    let timer = null;
    return {
      name,
      ramp(to, ms) {
        to *= k * Sound.master;
        clearInterval(timer);
        const from = a.volume;
        const t0 = performance.now();
        timer = setInterval(() => {
          const k = Math.min(1, (performance.now() - t0) / ms);
          a.volume = Math.min(1, Math.max(0, from + (to - from) * k));
          if (k >= 1) clearInterval(timer);
        }, 30);
      },
      stop(ms) {
        this.ramp(0, ms);
        setTimeout(() => a.pause(), ms + 50);
      },
      resume() { a.play().catch(waitForTouch); },
      pause() { a.pause(); },
    };
  }

  async function start() {
    if (!on || !track || document.hidden) return;
    if (current?.name === track) return current.resume();
    const name = track;
    const token = ++seq;
    const data = await loadBuffer(name);
    if (token !== seq || !on || track !== name) return;
    current?.stop(fade ? FADE_OUT : 0);
    current = data ? webPlayer(name, data) : elementPlayer(name);
    current.ramp(volume, fade ? FADE_IN : 0);
    current.resume();
  }

  // 自動再生が止められたとき：最初のクリック・タップ・キー入力で流す
  let waiting = false;
  function waitForTouch() {
    if (waiting) return;
    waiting = true;
    const go = () => {
      waiting = false;
      removeEventListener('pointerdown', go, true);
      removeEventListener('keydown', go, true);
      start();
    };
    addEventListener('pointerdown', go, true);
    addEventListener('keydown', go, true);
  }

  // fade：false なら、今の曲をすぐ止めて次の曲をすぐ最大の音量で流す（ギャラリー）
  let fade = true;
  function play(name, { fade: useFade = true } = {}) {
    if (track === name && current?.name === name) return;
    track = name;
    fade = useFade;
    start();
  }

  // 次に流す曲を先に読み込んでおく（切り替えたときにすぐ流れるように）
  function preload(name) {
    if (on) loadBuffer(name);
  }

  function setOn(value) {
    on = !!value;
    try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch {}
    if (on) return start();
    seq++;
    current?.stop(400);
    current = null;
  }

  function setVolume(value) {
    volume = Math.min(1, Math.max(0, value));
    try { localStorage.setItem(VOLUME_KEY, String(volume)); } catch {}
    current?.ramp(volume, 50);
  }

  // 別のページへ移る：曲をフェードアウトし、画面をワイプで覆ってから移動する（zoom.js の Wipe）
  let leaving = false;
  function leave(url) {
    if (leaving) return;
    leaving = true;
    const go = () => { location.href = url; };
    window.Wipe?.mark();
    current?.stop(500);
    const fadeDone = new Promise((resolve) => setTimeout(resolve, current ? 520 : 0));
    Promise.all([window.Wipe?.cover(), fadeDone]).then(go);
    // 念のため、何かで止まっても移動する
    setTimeout(go, 1500);
  }

  // 同じサイトの別ページへのリンクは、フェードアウトしてから移動する
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || a.target === '_blank') return;
    // ファイルの保存（download・blob:）はページの移動ではないので、そのまま
    if (a.hasAttribute('download')) return;
    const url = new URL(a.href, location.href);
    if (!/^https?:$/.test(url.protocol) || url.origin !== location.origin || (url.pathname === location.pathname && url.hash)) return;
    e.preventDefault();
    leave(url.href);
  });
  // 戻る・進むでページに戻ってきたとき（ページがそのまま残っている場合）は、また流す
  addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    leaving = false;
    current = null;
    start();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) current?.pause();
    else start();
  });

  // 曲を止める（オン・オフの設定は変えない。ギャラリーなど）
  function stop({ fade: useFade = true } = {}) {
    track = null;
    seq++;
    current?.stop(useFade ? 400 : 0);
    current = null;
  }

  // 主音量が変わったとき（Sound.setMaster から）
  const refresh = () => current?.ramp(volume, 50);

  return { play, stop, preload, leave, setOn, setVolume, refresh, TRACKS, get on() { return on; }, get volume() { return volume; }, get track() { return track; } };
})();
