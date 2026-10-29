// 設定（両画面の <body> の最後、app.js / play.js より前で読み込む）
// ・上のバーに歯車のボタンを置き、設定のダイアログを開く
// ・プレイヤー名・アバター・効果音・戦場の背景・バックアップ（全デッキと設定の書き出し／読み込み）
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

  // ランダムな名前：ファンタジー風（「紅蓮の魔導士」）が8割、ゆるい名前（「はらぺこゴブリン」）が2割
  const NAME_WORDS = {
    ja: {
      fantasy: [
        ['紅蓮', '蒼穹', '深淵', '黄昏', '静寂', '灼熱', '氷結', '放浪', '不屈', '月影', '嵐', '黒曜', '白銀', '翠緑', '暁', '星詠み'],
        ['魔導士', '騎士', '竜騎士', '守り手', '預言者', '死霊術士', '錬金術師', '吟遊詩人', '狩人', '賢者', '魔女', '剣士', '召喚士', '盗賊', '巫女', '王'],
      ],
      light: [
        ['はらぺこ', 'ねぼすけ', 'おでかけ', 'ごきげん', 'のんびり', 'うっかり', 'ほろよい', 'ぽんこつ', 'ひるね中の', 'まいごの'],
        ['ゴブリン', 'ドラゴン', 'スライム', 'ゾンビ', 'エルフ', 'ドワーフ', 'リッチ', 'ウーズ', 'スフィンクス', 'マーフォーク'],
      ],
    },
    en: {
      fantasy: [
        ['Crimson', 'Azure', 'Abyssal', 'Twilight', 'Silent', 'Blazing', 'Frozen', 'Wandering', 'Ancient', 'Silver', 'Shadow', 'Storm', 'Emerald', 'Obsidian'],
        ['Mage', 'Knight', 'Seer', 'Warden', 'Alchemist', 'Bard', 'Hunter', 'Sage', 'Witch', 'Duelist', 'Summoner', 'Rogue', 'Oracle', 'Paladin', 'Necromancer'],
      ],
      light: [
        ['Hungry', 'Sleepy', 'Clumsy', 'Grumpy', 'Tipsy', 'Lost', 'Cheerful', 'Lazy', 'Giggly', 'Snoozy'],
        ['Goblin', 'Dragon', 'Slime', 'Zombie', 'Elf', 'Dwarf', 'Lich', 'Ooze', 'Sphinx', 'Merfolk'],
      ],
    },
  };
  const pick = (list) => list[Math.floor(Math.random() * list.length)];

  function randomName() {
    const en = document.documentElement.lang === 'en';
    const words = NAME_WORDS[en ? 'en' : 'ja'];
    const fantasy = Math.random() < 0.8;
    const [first, second] = fantasy ? words.fantasy : words.light;
    // 名前は16文字まで（長すぎる組み合わせは引き直す）
    for (;;) {
      const a = pick(first);
      const b = pick(second);
      const name = en ? `${a} ${b}` : fantasy ? `${a}の${b}` : `${a}${b}`;
      if (name.length <= 16) return name;
    }
  }

  // 名前はタブごと（同じPCの2つのタブで対戦しても混ざらない）→ なければ前回使った名前 → なければランダム
  // 以前の既定の名前（プレイヤー / Player）は入力されていないものとして扱う
  let generatedName = null;
  function name() {
    let saved = null;
    try { saved = sessionStorage.getItem(NAME_KEY) || localStorage.getItem(NAME_KEY); } catch {}
    if (saved && saved !== 'プレイヤー' && saved !== 'Player') return saved;
    if (!generatedName) {
      generatedName = randomName();
      try { localStorage.setItem(NAME_KEY, generatedName); } catch {}
    }
    return generatedName;
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

  // ---------- ダイアログ ----------

  const $ = (id) => document.getElementById(id);
  const status = (t) => ($('settings-status').textContent = t);

  function build() {
    const dialog = document.createElement('dialog');
    dialog.id = 'settings';
    dialog.className = 'settings';
    // 戦場の背景は、背景を選べる画面（felt.js を読み込んだ画面）だけに出す
    // 自動でターン終了も、一人回し・対戦画面だけ
    const felt = document.documentElement.dataset.felt
      ? `<fieldset class="settings-group well"><legend><b>FIELD</b><small>戦場の背景</small></legend><div class="felt-picker settings-felt"></div></fieldset>
        <fieldset class="settings-group well"><legend><b>AUTO</b><small>自動</small></legend>
          <div class="settings-row"><label><input type="checkbox" id="settings-autoend"> 攻撃し終えたら、3秒後に自動でターン終了</label></div>
        </fieldset>`
      : '';
    dialog.innerHTML = `
      <h2 class="panel-head"><b>SETTINGS</b><small>設定</small></h2>
      <div class="dialog-body">
        <fieldset class="settings-group well">
          <legend><b>PLAYER</b><small>プレイヤー</small></legend>
          <div class="settings-row">
            <label for="settings-name">名前</label>
            <input id="settings-name" type="text" maxlength="16" autocomplete="off">
            <button type="button" id="settings-random" class="dice-btn" title="ランダムな名前" aria-label="ランダムな名前">🎲</button>
          </div>
          <div class="avatar-choices" id="settings-avatars" role="radiogroup" aria-label="アバター"></div>
        </fieldset>
        <fieldset class="settings-group well">
          <legend><b>SOUND</b><small>効果音</small></legend>
          <div class="settings-row">
            <label><input type="checkbox" id="settings-sound"> 効果音を鳴らす</label>
          </div>
          <div class="settings-row">
            <label for="settings-volume">音量</label>
            <input type="range" id="settings-volume" min="0" max="100" step="5">
            <span id="settings-volume-text" class="settings-value"></span>
          </div>
        </fieldset>
        ${felt}
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
        <div class="dialog-actions">
          <button type="button" id="settings-close" class="primary">閉じる</button>
        </div>
      </div>`;
    document.body.append(dialog);

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

    $('settings-name').addEventListener('change', (e) => setName(e.target.value));
    $('settings-random').addEventListener('click', () => {
      $('settings-name').value = randomName();
      setName($('settings-name').value);
      Sound.play('button');
    });

    $('settings-autoend')?.addEventListener('change', (e) => {
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

    $('backup-save').addEventListener('click', saveBackup);
    $('backup-load').addEventListener('click', () => $('backup-file').click());
    $('backup-file').addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (file) loadBackup(file);
    });

    $('settings-close').addEventListener('click', () => dialog.close());
    // 入力中の名前は、閉じたときにも保存する（Enter を押さずに閉じた場合）
    dialog.addEventListener('close', () => setName($('settings-name').value));

    // 上のバーの歯車
    const gear = document.createElement('button');
    gear.type = 'button';
    gear.className = 'settings-btn';
    gear.title = '設定';
    gear.setAttribute('aria-label', '設定');
    gear.addEventListener('click', open);
    document.querySelector('.topbar')?.append(gear);
  }

  function renderVolume() {
    const on = Sound.on;
    $('settings-volume').disabled = !on;
    $('settings-volume-text').textContent = `${$('settings-volume').value}%`;
  }

  function open() {
    $('settings-name').value = name();
    const current = $('settings-avatars').querySelector(`input[value="${avatar()}"]`);
    if (current) current.checked = true;
    $('settings-sound').checked = Sound.on;
    if ($('settings-autoend')) {
      try { $('settings-autoend').checked = localStorage.getItem('dm-deckmaker-autoend') !== 'off'; } catch {}
    }
    $('settings-volume').value = String(Math.round(Sound.volume * 100));
    renderVolume();
    status('');
    $('settings').showModal();
    // 選んでいるアバターが見える位置までスクロールする
    current?.parentElement.scrollIntoView({ block: 'nearest' });
  }

  build();

  return { AVATARS, avatarImage, validAvatar, randomName, name, avatar, setName, setAvatar, open };
})();
