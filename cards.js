// デュエマ System — カードのデータ（両画面で使う）
// カードは収録カード（classic-cards.js。旧枠＝DM-01〜30の時代）だけを使う。保存するのはデッキと設定だけ。
// 保存の形: { decks: [{ id, name, format, sort, cards: { カードID: 枚数 } }], current, regulations }
// カード: { id, name, civs: ['火', ...], cost, power, type, race, text, image, set, era }
const DM = (() => {
  const STORAGE_KEY = 'dm-deckmaker-v1';
  const DECK_SIZE = 40;
  const MAX_COPIES = 4;
  const SHIELDS = 5;
  const HAND = 5;

  // 文明（並び順は表示の順）。cls は色分けの CSS 用
  const CIVS = [
    { name: '光', cls: 'light', en: 'LIGHT' },
    { name: '水', cls: 'water', en: 'WATER' },
    { name: '闇', cls: 'dark', en: 'DARKNESS' },
    { name: '火', cls: 'fire', en: 'FIRE' },
    { name: '自然', cls: 'nature', en: 'NATURE' },
  ];

  // カードの初出の時代（同名カードの初版で決める。再録版でも同じ）。rank が小さいほど古い
  const ERAS = [
    { id: 'base', rank: 1, name: '基本編（DM-01〜05・DMC-01〜04）' },
    { id: '05', rank: 2, name: '〜2005年（DM-06〜16）' },
    { id: '08', rank: 3, name: '〜2008年（DM-17〜30）' },
  ];
  const eraRank = (id) => ERAS.find((e) => e.id === id)?.rank ?? 0;
  const eraName = (id) => ERAS.find((e) => e.id === id)?.name ?? '';

  // フォーマット：クラシックは非公式（コミュニティ）のレギュレーション。era: 使える初出の時代の上限
  const FORMATS = [
    { id: 'free', name: 'フリー（制限なし）', era: 0 },
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
  // 「光」「光/水」などから文明を取り出す（表示の順に並べる）
  const parseCivs = (text) => CIVS.filter((c) => String(text ?? '').includes(c.name)).map((c) => c.name);
  const civText = (civs) => (civs ?? []).join('/');

  const isCreatureType = (type) => /クリーチャー/.test(type ?? '');
  const isSpellType = (type) => /呪文/.test(type ?? '');

  // 効果テキストから読み取る能力（行の頭、または「■」の後ろに書かれたもの）
  const line = (re) => new RegExp(`(?:^|\\n|■)\\s*(?:${re})`);
  function abilities(card) {
    const t = String(card.text ?? '').replace(/Ｓ/g, 'S').replace(/Ｗ/g, 'W').replace(/Ｔ/g, 'T').replace(/＋/g, '+')
      // 公式の書き方「W(ダブル)・ブレイカー」の読みがなと、文中の読点を取り除く
      .replace(/([WT])\s*[（(][^)）]*[)）]/g, '$1')
      .replace(/[、,]/g, '');
    const pa = t.match(/パワーアタッカー\s*\+\s*(\d+)/);
    return {
      blocker: line('ブロッカー').test(t),
      sTrigger: line('S[・-]?トリガー').test(t),
      breaker: line('T・?ブレイカー').test(t) ? 3 : line('W・?ブレイカー').test(t) ? 2 : 1,
      speedAttacker: line('スピードアタッカー').test(t),
      slayer: line('スレイヤー').test(t),
      unblockable: /このクリーチャーは(?:相手に)?ブロックされない/.test(t),
      cannotAttack: /このクリーチャーは攻撃(?:することが)?できない/.test(t),
      cannotAttackPlayer: /このクリーチャーは(?:相手)?プレイヤーを攻撃(?:することが)?できない/.test(t),
      powerAttacker: pa ? Number(pa[1]) : 0,
      evolution: /進化/.test(card.type ?? ''),
    };
  }

  // 能力の短い説明（画像を読めないときのカードに出す）
  function abilityTags(ab) {
    const tags = [];
    if (ab.sTrigger) tags.push('S・トリガー');
    if (ab.blocker) tags.push('ブロッカー');
    if (ab.speedAttacker) tags.push('SA');
    if (ab.breaker === 2) tags.push('W・ブレイカー');
    if (ab.breaker === 3) tags.push('T・ブレイカー');
    if (ab.slayer) tags.push('スレイヤー');
    if (ab.powerAttacker) tags.push(`PA+${ab.powerAttacker}`);
    return tags;
  }

  // カードの絵。画像を読み込むまで（読めなければずっと）は、文明の色の枠にコスト・名前・パワーを書いたカードを出す
  // lazy: 画面に入るまで画像を読まない（カード一覧のように枚数が多いとき）
  function cardFace(card, { lazy = false } = {}) {
    const el = document.createElement('div');
    const civs = card.civs?.length ? card.civs : ['光'];
    el.className = `dm-face ${civs.map((n) => `civ-${civOf(n)?.cls}`).join(' ')}${civs.length > 1 ? ' multi' : ''}`;
    // 多色は文明の色を斜めに並べる
    el.style.setProperty('--civ-bg', civs.length > 1
      ? `linear-gradient(135deg, ${civs.map((n, i) => `var(--civ-${civOf(n)?.cls}) ${(i * 100) / civs.length}% ${((i + 1) * 100) / civs.length}%`).join(', ')})`
      : `var(--civ-${civOf(civs[0])?.cls})`);
    if (card.image) {
      const img = document.createElement('img');
      img.addEventListener('load', () => el.classList.add('img-ok'));
      img.addEventListener('error', () => img.remove());
      img.alt = card.name;
      img.draggable = false;
      if (lazy) img.loading = 'lazy';
      img.src = card.image;
      el.append(img);
    }
    const add = (cls, text) => el.append(Object.assign(document.createElement('span'), { className: cls, textContent: text }));
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
    card.set ? `初出：${card.set}${card.era ? `（${eraName(card.era)}）` : ''}` : '',
  ].filter(Boolean).join('\n');

  // ---------- 収録カード（classic-cards.js） ----------

  const num = (v) => {
    const n = Number.parseInt(String(v ?? '').replace(/[^\d-]/g, ''), 10);
    return Number.isFinite(n) ? n : null;
  };
  let cardsById = null;
  // { カードID: カード }（初めて使うときに classic-cards.js から作る）
  function allCards() {
    if (cardsById) return cardsById;
    cardsById = {};
    for (const c of window.CLASSIC_CARDS?.cards ?? []) {
      cardsById[c.id] = {
        id: c.id,
        name: c.name,
        civs: parseCivs(c.civs),
        cost: num(c.cost) ?? 0,
        power: isCreatureType(c.type) ? num(c.power) : null,
        type: c.type ?? '',
        race: c.race ?? '',
        text: c.text ?? '',
        image: c.image ?? '',
        set: c.set ?? '',
        era: c.era ?? '',
      };
    }
    return cardsById;
  }

  // ---------- 保存 ----------

  function emptyState() {
    return { decks: [{ id: 1, name: 'デッキ1', format: 'c08', cards: {} }], current: 1 };
  }

  // 以前の版はカードも保存していたので、カードを外し、収録カードにないカード（架空のサンプルなど）をデッキから除く
  function load() {
    let state = null;
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved?.decks?.length) state = saved;
    } catch {}
    state ??= emptyState();
    const cards = allCards();
    if (state.cards || state.classicVersion) {
      delete state.cards;
      delete state.classicVersion;
      for (const d of state.decks) {
        for (const id of Object.keys(d.cards)) if (!cards[id]) delete d.cards[id];
      }
      state.decks = state.decks.filter((d) => d.name !== 'サンプルデッキ' || Object.keys(d.cards).length);
      if (!state.decks.length) state.decks = emptyState().decks;
      if (!state.decks.some((d) => d.id === state.current)) state.current = state.decks[0].id;
      save(state);
    }
    return state;
  }

  function save(state) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
  }

  return {
    STORAGE_KEY, DECK_SIZE, MAX_COPIES, SHIELDS, HAND, CIVS, ERAS, FORMATS, REGULATIONS,
    eraRank, eraName, formatOf, civOf, civText, isCreatureType, isSpellType, abilities,
    cardFace, detailText, allCards, load, save,
  };
})();
