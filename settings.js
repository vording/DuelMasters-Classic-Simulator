// 設定（各画面の <body> の最後、app.js / play.js より前で読み込む）
// ・上のバーに歯車（設定画面 settings.html へのリンク）を置く。設定画面では、設定の項目とギャラリー（BGM・効果音を聞ける）を出す
// ・プレイヤー名・アバター・効果音・BGM・戦場の背景・バックアップ（全デッキと設定の書き出し／読み込み）
// ・名前やアバターを変えたら window に 'settingschange' イベントを送る
const Settings = (() => {
  const NAME_KEY = 'dm-deckmaker-name';
  const AVATAR_KEY = 'dm-deckmaker-avatar';
  // バックアップに入れる localStorage のキー（ゲームの途中経過は sessionStorage なので入れない）
  const PREFIX = 'dm-deckmaker-';
  const BACKUP_APP = 'dm-deckmaker';

  // アバター（img/avatar/1.jpg〜42.jpg）
  const AVATARS = Array.from({ length: 42 }, (_, i) => String(i + 1));
  const avatarImage = (a) => `url("img/avatar/${a}.jpg")`;
  const validAvatar = (a) => (AVATARS.includes(String(a)) ? String(a) : AVATARS[0]);

  // 名前はタブごと（同じPCの2つのタブで対戦しても混ざらない）→ なければ前回使った名前 → なければ「プレイヤー」
  const DEFAULT_NAME = 'プレイヤー';
  function name() {
    try { return sessionStorage.getItem(NAME_KEY) || localStorage.getItem(NAME_KEY) || DEFAULT_NAME; } catch { return DEFAULT_NAME; }
  }

  // 名前と同じく、タブごと → なければ前回使ったアバター
  function avatar() {
    try { return validAvatar(sessionStorage.getItem(AVATAR_KEY) || localStorage.getItem(AVATAR_KEY)); } catch { return AVATARS[0]; }
  }

  const changed = () => window.dispatchEvent(new Event('settingschange'));

  function setName(value) {
    const v = String(value ?? '').trim().slice(0, 16);
    if (!v || v === name()) return;
    try {
      sessionStorage.setItem(NAME_KEY, v);
      localStorage.setItem(NAME_KEY, v);
    } catch {}
    changed();
  }

  function setAvatar(a) {
    const v = validAvatar(a);
    if (v === avatar()) return;
    try {
      sessionStorage.setItem(AVATAR_KEY, v);
      localStorage.setItem(AVATAR_KEY, v);
    } catch {}
    changed();
  }

  // ---------- バックアップ ----------

  function backupKeys() {
    const keys = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith(PREFIX)) keys.push(k);
      }
    } catch {}
    return keys;
  }

  function saveBackup() {
    const data = {};
    for (const k of backupKeys()) data[k] = localStorage.getItem(k);
    const file = { app: BACKUP_APP, version: 1, savedAt: new Date().toISOString(), data };
    const blob = new Blob([JSON.stringify(file, null, 1)], { type: 'application/json' });
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `dm-deckmaker-backup-${stamp}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    status('バックアップを保存しました');
  }

  async function loadBackup(file) {
    let backup = null;
    try { backup = JSON.parse(await file.text()); } catch {}
    const data = backup?.app === BACKUP_APP ? backup.data : null;
    if (!data || typeof data !== 'object') {
      status('このファイルはバックアップではありません');
      return;
    }
    let deckCount = 0;
    try { deckCount = JSON.parse(data[`${PREFIX}v1`])?.decks?.length ?? 0; } catch {}
    if (!confirm(`今のデッキ・設定を、バックアップの内容（デッキ${deckCount}個）で置き換えますか？`)) return;
    try {
      for (const k of backupKeys()) localStorage.removeItem(k);
      for (const [k, v] of Object.entries(data)) {
        if (k.startsWith(PREFIX) && typeof v === 'string') localStorage.setItem(k, v);
      }
      // このタブだけの名前・アバターより、読み込んだものを使う
      sessionStorage.removeItem(NAME_KEY);
      sessionStorage.removeItem(AVATAR_KEY);
    } catch {
      status('読み込めませんでした（ブラウザの保存領域がいっぱいか、使えません）');
      return;
    }
    location.reload();
  }

  // ---------- 設定画面（settings.html）。ほかの画面は、上のバーの歯車から設定画面へ移る ----------

  const $ = (id) => document.getElementById(id);
  const status = (t) => { if ($('settings-status')) $('settings-status').textContent = t; };

  // 設定画面から戻る先（来た画面）。index.html・play.html だけ
  function backUrl() {
    const back = new URLSearchParams(location.search).get('back') ?? '';
    return /^(index|play)\.html([?#].*)?$/.test(back) ? back : 'index.html';
  }

  function build() {
    const root = $('settings-root');
    if (!root) return buildGear();
    root.className = 'settings settings-page';
    root.innerHTML = `
      <div class="settings-columns">
        <section class="panel settings-panel" id="settings-view">
          <h2 class="panel-head"><b>SETTINGS</b><small>設定</small></h2>
          <div class="dialog-body">
            <fieldset class="settings-group well">
              <legend><b>PLAYER</b><small>プレイヤー</small></legend>
              <div class="settings-row">
                <label for="settings-name">名前</label>
                <input id="settings-name" type="text" maxlength="16" autocomplete="off">
              </div>
              <div class="avatar-choices" id="settings-avatars" role="radiogroup" aria-label="アバター"></div>
            </fieldset>
            <fieldset class="settings-group well">
              <legend><b>SOUND</b><small>サウンド</small></legend>
              <div class="settings-row sound-row master-row">
                <span class="master-label"><b>MASTER</b><small>主音量</small></span>
                <input type="range" id="settings-master" min="0" max="100" step="5" aria-label="主音量（BGM と効果音の両方）">
                <span id="settings-master-text" class="settings-value"></span>
              </div>
              <div class="settings-row sound-row">
                <label class="switch"><input type="checkbox" id="settings-bgm"><span class="switch-ui" aria-hidden="true"></span><b>BGM</b></label>
                <input type="range" id="settings-bgm-volume" min="0" max="100" step="5" aria-label="BGM の音量">
                <span id="settings-bgm-volume-text" class="settings-value"></span>
              </div>
              <div class="settings-row sound-row">
                <label class="switch"><input type="checkbox" id="settings-sound"><span class="switch-ui" aria-hidden="true"></span><b>SE</b><small>効果音</small></label>
                <input type="range" id="settings-volume" min="0" max="100" step="5" aria-label="効果音の音量">
                <span id="settings-volume-text" class="settings-value"></span>
              </div>
            </fieldset>
            <fieldset class="settings-group well"><legend><b>FIELD</b><small>戦場の背景</small></legend><div class="felt-picker settings-felt"></div></fieldset>
            <fieldset class="settings-group well"><legend><b>AUTO</b><small>自動</small></legend>
              <div class="settings-row"><label><input type="checkbox" id="settings-autoend"> 攻撃し終えたら、3秒後に自動でターン終了</label></div>
            </fieldset>
            <fieldset class="settings-group well">
              <legend><b>GALLERY</b><small>ギャラリー</small></legend>
              <div class="settings-row"><button type="button" id="open-gallery" class="primary">ギャラリーを開く ▶</button></div>
            </fieldset>
            <fieldset class="settings-group well">
              <legend><b>BACKUP</b><small>バックアップ</small></legend>
              <p class="note">すべてのデッキと設定を1つのファイルに保存します。別の端末やブラウザで読み込むと、同じデッキを使えます。</p>
              <div class="settings-row">
                <button type="button" id="backup-save">ファイルに保存</button>
                <button type="button" id="backup-load">ファイルから読み込む…</button>
                <input type="file" id="backup-file" accept=".json,application/json" hidden>
              </div>
              <p id="settings-status" class="status"></p>
            </fieldset>
            <div class="settings-title-row"><button type="button" id="settings-title">タイトルに戻る</button></div>
          </div>
        </section>
        <section class="panel gallery-panel" id="gallery-view" hidden>
          <h2 class="panel-head"><b>GALLERY</b><small>ギャラリー</small></h2>
          <div class="dialog-body">
            <fieldset class="settings-group well">
              <legend><b>BGM</b></legend>
              <div id="gallery-bgm" class="gallery-bgm"></div>
            </fieldset>
          </div>
        </section>
      </div>`;
    // 戻る：ギャラリーなら設定へ、設定なら来た画面へ（BGM をフェードアウトしてから移る）
    $('settings-back').addEventListener('click', () => {
      if (location.hash === '#gallery') history.back();
      else Bgm.leave(backUrl());
    });
    // タイトルに戻る：スタート画面を出すようにして、デッキ作成の画面（index.html）へ
    $('settings-title').addEventListener('click', () => {
      try { sessionStorage.removeItem('dm-deckmaker-title-seen'); } catch {}
      Bgm.leave('index.html');
    });
    // ギャラリーは別の画面（#gallery）。ブラウザの戻るでも設定に戻る
    $('open-gallery').addEventListener('click', () => { location.hash = 'gallery'; });
    window.addEventListener('hashchange', showView);

    $('settings-avatars').append(...AVATARS.map((a) => {
      const label = document.createElement('label');
      const input = Object.assign(document.createElement('input'), { type: 'radio', name: 'settings-avatar', value: a });
      input.addEventListener('change', () => {
        setAvatar(a);
        Sound.play('button');
      });
      const face = document.createElement('span');
      face.className = 'avatar';
      face.style.backgroundImage = avatarImage(a);
      label.append(input, face);
      return label;
    }));

    // 名前は入力するたびに保存する（戻るボタンで離れても残るように）
    $('settings-name').addEventListener('input', (e) => setName(e.target.value));

    $('settings-autoend').addEventListener('change', (e) => {
      try { localStorage.setItem('dm-deckmaker-autoend', e.target.checked ? 'on' : 'off'); } catch {}
    });
    $('settings-sound').addEventListener('change', (e) => {
      Sound.setOn(e.target.checked);
      renderVolume();
    });
    // つまみを動かしている間は数字だけ変え、離したときに試しに鳴らす
    $('settings-volume').addEventListener('input', (e) => {
      Sound.setVolume(Number(e.target.value) / 100);
      renderVolume();
    });
    $('settings-volume').addEventListener('change', () => Sound.play('button'));
    $('settings-master').addEventListener('input', (e) => {
      Sound.setMaster(Number(e.target.value) / 100);
      renderVolume();
    });
    $('settings-master').addEventListener('change', () => Sound.play('button'));
    $('settings-bgm').addEventListener('change', (e) => {
      Bgm.setOn(e.target.checked);
      renderVolume();
    });
    $('settings-bgm-volume').addEventListener('input', (e) => {
      Bgm.setVolume(Number(e.target.value) / 100);
      renderVolume();
    });

    $('backup-save').addEventListener('click', saveBackup);
    $('backup-load').addEventListener('click', () => $('backup-file').click());
    $('backup-file').addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (file) loadBackup(file);
    });

    buildGallery();
    fill();
    showView();
  }

  // 設定とギャラリーの切り替え。ギャラリーでは BGM を止め（フェードなし）、押した曲だけを流す。設定に戻ったら設定画面の曲
  function showView() {
    const gallery = location.hash === '#gallery';
    $('settings-view').hidden = gallery;
    $('gallery-view').hidden = !gallery;
    $('settings-back').textContent = gallery ? '◀ 設定に戻る' : '◀ 戻る';
    if (gallery) Bgm.stop({ fade: false });
    else Bgm.play('settings');
    renderGallery();
    scrollTo(0, 0);
  }

  // ギャラリー：BGM（押すとその曲が流れ、もう一度押すと止まる）
  function buildGallery() {
    $('gallery-bgm').replaceChildren(...Bgm.TRACKS.map((t) => {
      const b = Object.assign(document.createElement('button'), { type: 'button', className: 'gallery-track' });
      b.dataset.track = t.file;
      b.append(Object.assign(document.createElement('b'), { textContent: `♪ ${t.title}` }));
      // もう一度押すと止める。ギャラリーではフェードせずにすぐ切り替える
      b.addEventListener('click', () => {
        if (Bgm.track === t.file) Bgm.stop({ fade: false });
        else Bgm.play(t.file, { fade: false });
        renderGallery();
      });
      return b;
    }));
    renderGallery();
  }

  function renderGallery() {
    for (const b of document.querySelectorAll('.gallery-track')) b.setAttribute('aria-pressed', String(b.dataset.track === Bgm.track));
  }

  // ほかの画面：上のバーに歯車（設定画面へのリンク）を置く。戻ったら来た画面に戻れるよう、今の画面を渡す
  let gear = null;
  function buildGear() {
    gear = document.createElement('a');
    gear.className = 'settings-btn';
    gear.title = '設定';
    gear.setAttribute('aria-label', '設定');
    const here = location.pathname.split('/').pop() || 'index.html';
    gear.href = `settings.html?back=${encodeURIComponent(here + location.search)}`;
    document.querySelector('.topbar')?.append(gear);
  }

  function renderVolume() {
    const on = Sound.on;
    $('settings-volume').disabled = !on;
    $('settings-volume-text').textContent = `${$('settings-volume').value}%`;
    $('settings-bgm-volume').disabled = !Bgm.on;
    $('settings-bgm-volume-text').textContent = `${$('settings-bgm-volume').value}%`;
    $('settings-master-text').textContent = `${$('settings-master').value}%`;
    renderGallery();
  }

  // 設定画面を開いたときに、今の設定を入れる
  function fill() {
    $('settings-name').value = name();
    const current = $('settings-avatars').querySelector(`input[value="${avatar()}"]`);
    if (current) current.checked = true;
    $('settings-sound').checked = Sound.on;
    try { $('settings-autoend').checked = localStorage.getItem('dm-deckmaker-autoend') !== 'off'; } catch {}
    $('settings-volume').value = String(Math.round(Sound.volume * 100));
    $('settings-bgm').checked = Bgm.on;
    $('settings-bgm-volume').value = String(Math.round(Bgm.volume * 100));
    $('settings-master').value = String(Math.round(Sound.master * 100));
    renderVolume();
    status('');
  }

  // 設定画面を開く（ほかの画面から。歯車を押したのと同じ）
  function open() {
    gear?.click();
  }

  build();

  return { AVATARS, avatarImage, validAvatar, name, avatar, setName, setAvatar, open };
})();
