// デュエマ System — カードのデータ（両画面で使う）
// カードは利用者が登録する（公式のカードデータ配信がないため）。
// 保存の形: { cards: { カードID: カード }, decks: [{ id, name, cards: { カードID: 枚数 } }], current }
// カード: { id, name, civs: ['火', ...], cost, power, type, race, text, image }
const DM = (() => {
  const STORAGE_KEY = 'dm-deckmaker-v1';
  const DECK_SIZE = 40;
  const MAX_COPIES = 4;
  const SHIELDS = 5;
  const HAND = 5;

  // 文明（並び順は表示の順）。class は色分けの CSS 用、mana は土地の効果音の色
  const CIVS = [
    { name: '光', cls: 'light', mana: 'W' },
    { name: '水', cls: 'water', mana: 'U' },
    { name: '闇', cls: 'dark', mana: 'B' },
    { name: '火', cls: 'fire', mana: 'R' },
    { name: '自然', cls: 'nature', mana: 'G' },
    { name: 'ゼロ', cls: 'zero', mana: '' },
  ];
  const TYPES = ['クリーチャー', '進化クリーチャー', '呪文', 'クロスギア', '城', 'フィールド', 'タマシード', 'その他'];

  // カードの初出の時代（同名カードの初版で決める。再録版でも同じ）。rank が小さいほど古い
  const ERAS = [
    { id: 'base', rank: 1, name: '基本編（DM-01〜05・DMC-01〜04）' },
    { id: '05', rank: 2, name: '〜2005年（DM-06〜16）' },
    { id: '08', rank: 3, name: '〜2008年（DM-17〜30）' },
    { id: 'new', rank: 4, name: '2009年以降' },
  ];
  const eraRank = (id) => ERAS.find((e) => e.id === id)?.rank ?? 0;
  const eraName = (id) => ERAS.find((e) => e.id === id)?.name ?? '未設定';
  // 収録の番号（DM-07 など）から時代を決める。分からなければ null（DMC の5以降やプロモは手で選ぶ）
  function eraFromSet(code) {
    const s = String(code ?? '').toUpperCase().replace(/[－―ー]/g, '-');
    const dmc = s.match(/DMC-?(\d+)/);
    if (dmc) return Number(dmc[1]) <= 4 ? 'base' : null;
    const dm = s.match(/DM-?(\d+)/);
    if (!dm) return null;
    const n = Number(dm[1]);
    return n <= 5 ? 'base' : n <= 16 ? '05' : n <= 30 ? '08' : 'new';
  }

  // フォーマット：クラシックは非公式（コミュニティ）のレギュレーション。era: 使える初出の時代の上限
  const FORMATS = [
    { id: 'free', name: '自由（制限なし）', era: 0 },
    { id: 'base', name: 'クラシック基本編', era: 1, note: 'DM-01〜05・DMC-01〜04と同時期のプロモ' },
    { id: 'c05', name: 'クラシック05', era: 2, note: '2005年までに初版が出たカード（DM-16まで）' },
    { id: 'c08', name: 'クラシック08', era: 3, note: '2008年までに初版が出たカード（DM-30「戦極魂」まで）' },
  ];
  const formatOf = (id) => FORMATS.find((f) => f.id === id) ?? FORMATS[0];

  // クラシックの殿堂（既定の一覧。デッキ作成画面の「殿堂…」で書き換えると、そちらを使う）
  // restricted: 1枚まで、banned: 0枚、helper: この中から合計1枚まで、combos: 同時に入れられない2枚
  const REGULATIONS = {
    base: {
      banned: ['サイバー・ブレイン'],
      restricted: ['アクア・ハルカス', 'アクアン', 'アストラル・リーフ', 'エメラル', 'ストリーミング・シェイパー', 'スパイラル・ゲート',
        'ディープ・オペレーション', 'デビル・ドレーン', 'ハイドロ・ハリケーン', '雷鳴の守護者ミスト・リエス'],
      helper: [],
      combos: [],
    },
    c05: {
      banned: ['ギガザンダ', 'ガルベリアス・ドラゴン', 'フューチャー・スラッシュ', 'ヘル・スラッシュ', '無双竜機ボルバルザーク', 'ロスト・チャージャー', '呪紋の化身'],
      restricted: ['アストラル・リーフ', '魂と記憶の盾', 'エメラル', '英知と追撃の宝剣', '炎槍と水剣の裁', '炎舞闘士サピエント・アーク', 'クローン・バイス',
        '凶星王ダーク・ヒドラ', 'コーライル', '光器ペトローバ', 'スパイラル・ゲート', '超竜バジュラ', 'デビル・ドレーン', 'ハイドロ・ハリケーン',
        'バザガジール・ドラゴン', 'バジュラズ・ソウル', 'パシフィック・チャンピオン', '無双恐皇ガラムタ', '予言者マリエル', '略奪秘宝ジャギラ',
        '雷鳴の守護者ミスト・リエス', 'ロスト・ソウル'],
      helper: ['アクアン', 'スケルトン・バイス', 'ストリーミング・シェイパー', 'サイバー・ブレイン', '母なる大地'],
      combos: [],
    },
    c08: {
      banned: ['無双竜機ボルバルザーク'],
      restricted: ['予言者マリエル', '雷鳴の守護者ミスト・リエス', '光器ペトローバ', '不滅の精霊パーフェクト・ギャラクシー', 'スパイラル・ゲート', 'エメラル',
        'アストラル・リーフ', 'サイバー・ブレイン', 'ハイドロ・ハリケーン', 'クローン・バイス', '凶星王ダーク・ヒドラ', 'バジュラズ・ソウル',
        'ガルベリアス・ドラゴン', '超竜バジュラ', 'インフィニティ・ドラゴン', '母なる紋章', '英知と追撃の宝剣', '魂と記憶の盾', '炎槍と水剣の裁'],
      helper: ['ストリーミング・シェイパー', 'ロスト・チャージャー', '母なる大地', 'アクアン', 'スケルトン・バイス', 'インフェルノ・ゲート',
        'ソウル・アドバンテージ', '呪紋の化身', 'フューチャー・スラッシュ', '聖鎧亜キング・アルカディアス', 'ヘル・スラッシュ', 'ボルメテウス・サファイア・ドラゴン'],
      combos: [['母なる大地', '龍仙ロマネスク'], ['母なる紋章', '龍仙ロマネスク'], ['アクア・パトロール', '海王龍聖ラスト・アヴァタール']],
    },
  };

  const civOf = (name) => CIVS.find((c) => c.name === name);
  // 「光水」「光/水」「光・水」「火 自然」などから文明を取り出す（表示の順に並べる）
  const parseCivs = (text) => CIVS.filter((c) => String(text ?? '').includes(c.name)).map((c) => c.name);
  const sortCivs = (civs) => CIVS.map((c) => c.name).filter((n) => civs.includes(n));
  const civText = (civs) => (civs?.length ? civs.join('/') : 'ゼロ');

  const isCreatureType = (type) => /クリーチャー/.test(type ?? '');
  const isSpellType = (type) => /呪文/.test(type ?? '');

  // 効果テキストから読み取る能力（行の頭、または「■」の後ろに書かれたもの）
  const line = (re) => new RegExp(`(?:^|\\n|■)\\s*(?:${re})`);
  function abilities(card) {
    const t = String(card.text ?? '').replace(/Ｓ/g, 'S').replace(/Ｗ/g, 'W').replace(/Ｔ/g, 'T').replace(/Ｑ/g, 'Q').replace(/＋/g, '+')
      // 公式の書き方「W(ダブル)・ブレイカー」の読みがなと、文中の読点を取り除く
      .replace(/([WTQ])\s*[（(][^)）]*[)）]/g, '$1')
      .replace(/[、,]/g, '');
    const pa = t.match(/パワーアタッカー\s*\+\s*(\d+)/);
    return {
      blocker: line('ブロッカー').test(t),
      sTrigger: line('S[・-]?トリガー').test(t),
      breaker: line('ワールド・?ブレイカー').test(t) ? 99
        : line('Q・?ブレイカー').test(t) ? 4
          : line('T・?ブレイカー').test(t) ? 3
            : line('W・?ブレイカー').test(t) ? 2 : 1,
      speedAttacker: line('スピードアタッカー').test(t),
      slayer: line('スレイヤー').test(t),
      unblockable: /このクリーチャーは(?:相手に)?ブロックされない/.test(t),
      cannotAttack: /このクリーチャーは攻撃(?:することが)?できない/.test(t),
      cannotAttackPlayer: /このクリーチャーは(?:相手)?プレイヤーを攻撃(?:することが)?できない/.test(t),
      powerAttacker: pa ? Number(pa[1]) : 0,
      evolution: /進化/.test(card.type ?? ''),
    };
  }

  // 能力の短い説明（カードの下に出す）
  function abilityTags(ab) {
    const tags = [];
    if (ab.sTrigger) tags.push('S・トリガー');
    if (ab.blocker) tags.push('ブロッカー');
    if (ab.speedAttacker) tags.push('SA');
    if (ab.breaker === 2) tags.push('W・ブレイカー');
    if (ab.breaker === 3) tags.push('T・ブレイカー');
    if (ab.breaker === 4) tags.push('Q・ブレイカー');
    if (ab.breaker === 99) tags.push('ワールド・ブレイカー');
    if (ab.slayer) tags.push('スレイヤー');
    if (ab.powerAttacker) tags.push(`PA+${ab.powerAttacker}`);
    return tags;
  }

  // 文字のカード（画像がなければ文明の色の枠に、コスト・名前・種類・パワーを書く）
  // card: { name, civs, cost, power, type, race, text, image }
  // lazy: 画面に入るまで画像を読まない（カード一覧のように枚数が多いとき）
  function cardFace(card, { lazy = false } = {}) {
    const el = document.createElement('div');
    const civs = card.civs?.length ? card.civs : ['ゼロ'];
    el.className = `dm-face ${civs.map((n) => `civ-${civOf(n)?.cls ?? 'zero'}`).join(' ')}${civs.length > 1 ? ' multi' : ''}`;
    // 多色は文明の色を斜めに並べる
    el.style.setProperty('--civ-bg', civs.length > 1
      ? `linear-gradient(135deg, ${civs.map((n, i) => `var(--civ-${civOf(n)?.cls ?? 'zero'}) ${(i * 100) / civs.length}% ${((i + 1) * 100) / civs.length}%`).join(', ')})`
      : `var(--civ-${civOf(civs[0])?.cls ?? 'zero'})`);
    if (card.image) {
      const img = document.createElement('img');
      // 読み込むまでは文字のカードを出しておき、読めたら画像だけにする（読めなければ文字のまま）
      img.addEventListener('load', () => el.classList.add('img-ok'));
      img.addEventListener('error', () => img.remove());
      img.alt = card.name;
      if (lazy) img.loading = 'lazy';
      img.src = card.image;
      el.append(img);
    }
    const add = (cls, text) => {
      const s = document.createElement('span');
      s.className = cls;
      s.textContent = text;
      el.append(s);
      return s;
    };
    add('dm-cost', card.cost ?? '');
    add('dm-name', card.name);
    add('dm-type', [card.type, card.race].filter(Boolean).join('／'));
    const tags = abilityTags(abilities(card));
    if (tags.length) add('dm-tags', tags.join(' '));
    if (card.power != null && card.power !== '') add('dm-power', card.power);
    return el;
  }

  // カードの説明（長押しの拡大表示・マウスを乗せたときの表示）
  const detailText = (card) => [
    `${civText(card.civs)}・コスト${card.cost ?? '?'}・${card.type ?? ''}${card.race ? `（${card.race}）` : ''}`,
    card.text,
    card.power != null && card.power !== '' ? `パワー ${card.power}` : '',
    card.set || card.era ? `初出：${[card.set, card.era ? eraName(card.era) : ''].filter(Boolean).join('・')}` : '',
  ].filter(Boolean).join('\n');

  // ---------- 保存 ----------

  // 収録カード（classic-cards.js）はデッキ作成画面だけで読み込み、ここで保存データに入れる
  function load() {
    let state = null;
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved?.cards && saved?.decks?.length) state = saved;
    } catch {}
    state ??= emptyState();
    if (window.CLASSIC_CARDS && state.classicVersion !== window.CLASSIC_CARDS.version) {
      dropOldSamples(state);
      mergeClassic(state);
      save(state);
    }
    return state;
  }

  function save(state) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
  }

  const newId = () => Math.random().toString(36).slice(2, 10);

  // 入力されたカードを整える（数値・文明の並び・空欄）
  function normalize(c) {
    const num = (v) => {
      const n = Number.parseInt(String(v ?? '').replace(/[^\d-]/g, ''), 10);
      return Number.isFinite(n) ? n : null;
    };
    // ゼロ文明はほかの文明と一緒には持たない
    const civs = sortCivs(Array.isArray(c.civs) ? c.civs : parseCivs(c.civs));
    return {
      id: c.id || newId(),
      name: String(c.name ?? '').trim().slice(0, 60),
      civs: civs.filter((n) => n !== 'ゼロ' || civs.length === 1),
      cost: num(c.cost) ?? 0,
      power: isCreatureType(c.type) ? num(c.power) : null,
      type: TYPES.includes(c.type) ? c.type : String(c.type ?? '').trim() || 'クリーチャー',
      race: String(c.race ?? '').trim().slice(0, 60),
      text: String(c.text ?? '').trim().slice(0, 1000),
      image: /^https?:\/\//.test(String(c.image ?? '').trim()) ? String(c.image).trim() : '',
      // 収録（初版の番号。例 DM-07）と初出の時代（番号から分かれば自動、分からなければ選んだもの）
      set: String(c.set ?? '').trim().slice(0, 30),
      era: eraFromSet(c.set) ?? (ERAS.some((e) => e.id === c.era) ? c.era : ''),
    };
  }

  // ---------- 収録カード（classic-cards.js。旧枠＝DM-01〜30の時代のカード） ----------

  function emptyState() {
    return { cards: {}, decks: [{ id: 1, name: 'デッキ1', format: 'c08', cards: {} }], current: 1 };
  }

  // 収録カードを入れる（初回、または収録カードが更新されたとき）。
  // 同じ名前のカードが登録済みなら上書きせず、空いている画像・収録・初出だけ補う
  function mergeClassic(state) {
    const data = window.CLASSIC_CARDS;
    if (!data || state.classicVersion === data.version) return false;
    const byName = new Map(Object.values(state.cards).map((c) => [c.name, c]));
    for (const raw of data.cards) {
      const same = byName.get(raw.name);
      if (same) {
        if (!same.image) same.image = raw.image;
        if (!same.set) same.set = raw.set;
        if (!same.era) same.era = raw.era;
        continue;
      }
      const c = normalize(raw);
      state.cards[c.id] = c;
    }
    state.classicVersion = data.version;
    return true;
  }

  // 以前の版で入れていた架空のサンプルカード（収録カードと入れ替える）
  const OLD_SAMPLES = ['ブレイズ・ランナー', '紅蓮の斥候ガロ', '灼炎竜ヴォルカディア', 'フレイム・ショット', '森の番人ポッコ',
    '大樹の戦士モルガ', '芽吹きの恵み', '森王ゴルディオン', '光翼の騎士セイラ', '双牙獣バルガ'];
  function dropOldSamples(state) {
    const sample = state.decks.find((d) => d.name === 'サンプルデッキ');
    const ids = Object.values(state.cards).filter((c) => OLD_SAMPLES.includes(c.name) && !c.set && !c.image).map((c) => c.id);
    if (ids.length !== OLD_SAMPLES.length) return;
    // サンプルのカードがほかのデッキで使われていたら残す
    if (state.decks.some((d) => d !== sample && ids.some((id) => d.cards[id]))) return;
    for (const id of ids) delete state.cards[id];
    if (sample && Object.keys(sample.cards).every((id) => ids.includes(id))) {
      state.decks = state.decks.filter((d) => d !== sample);
      if (!state.decks.length) state.decks = emptyState().decks;
      if (!state.decks.some((d) => d.id === state.current)) state.current = state.decks[0].id;
    }
  }

  return {
    STORAGE_KEY, DECK_SIZE, MAX_COPIES, SHIELDS, HAND, CIVS, TYPES, ERAS, FORMATS, REGULATIONS,
    eraRank, eraName, eraFromSet, formatOf, civOf, parseCivs, sortCivs, civText, isCreatureType, isSpellType, abilities, abilityTags,
    cardFace, detailText, load, save, newId, normalize,
  };
})();
