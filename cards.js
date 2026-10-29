// デュエマ System — カードのデータ（両画面で使う）
// カードは収録カード（classic-cards.js。基本編のカードだけ）を使う。保存するのはデッキと設定だけ。
// ルールはクラシック基本編（殿堂は REGULATION）。
// 保存の形: { decks: [{ id, name, sort, cards: { カードID: 枚数 } }], current, regulation }
// カード: { id, name, civs: ['火', ...], cost, power, type, race, text, image, set }
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

  // クラシック基本編の殿堂（既定の一覧。デッキ作成画面の「殿堂…」で書き換えると、そちらを使う）
  // restricted: 1枚まで、banned: 0枚
  const REGULATION = {
    banned: ['サイバー・ブレイン'],
    restricted: ['アクア・ハルカス', 'アクアン', 'アストラル・リーフ', 'エメラル', 'ストリーミング・シェイパー', 'スパイラル・ゲート',
      'ディープ・オペレーション', 'デビル・ドレーン', 'ハイドロ・ハリケーン', '雷鳴の守護者ミスト・リエス'],
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
      // 公式の書き方「S(シールド)・トリガー」「W(ダブル)・ブレイカー」の読みがなと、文中の読点を取り除く
      .replace(/([SWT])\s*[（(][^)）]*[)）]/g, '$1')
      .replace(/[、,]/g, '')
      .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xFEE0));
    const pa = t.match(/パワーアタッカー\s*\+\s*(\d+)/);
    // 「自然・光スレイヤー」「火・自然ブロッカー」：その文明のクリーチャーにだけ働く
    const civSlayer = t.match(/(?:^|\n|■)\s*((?:光|水|闇|火|自然|・)+)スレイヤー/);
    const civBlocker = t.match(/(?:^|\n|■)\s*((?:光|水|闇|火|自然|・)+)ブロッカー/);
    const survives = t.match(/(光|水|闇|火|自然)クリーチャーとのバトルに負けても墓地には置かれない/);
    // このクリーチャーを攻撃できない相手の文明
    const unattack = t.match(/(光|水|闇|火|自然)のクリーチャーに攻撃または/) ?? t.match(/((?:光|水|闇|火|自然|と)+)のクリーチャーはこのクリーチャーを攻撃することができない/);
    // タップされていないクリーチャーを攻撃できる（文明の指定があれば、その文明だけ）
    const untapped = t.match(/このクリーチャーはタップされていない((?:光|水|闇|火|自然|と)*)の?クリーチャーを攻撃できる/);
    const blockMax = t.match(/パワー(\d+)以下のクリーチャーにブロックされない/);
    const blockMin = t.match(/パワー(\d+)以上のクリーチャーにブロックされない/);
    const blockCiv = t.match(/(光|水|闇|火|自然)のクリーチャーに(?:攻撃または)?ブロックされない/);
    return {
      blocker: line('ブロッカー').test(t) || !!civBlocker,
      // ブロックできる攻撃クリーチャーの文明（null ならすべて）
      blockerCivs: civBlocker ? parseCivs(civBlocker[1]) : null,
      sTrigger: line('S[・-]?トリガー').test(t),
      breaker: line('T・?ブレイカー').test(t) ? 3 : line('W・?ブレイカー').test(t) ? 2 : 1,
      speedAttacker: line('スピードアタッカー').test(t),
      slayer: line('スレイヤー').test(t),
      slayerCivs: civSlayer ? parseCivs(civSlayer[1]) : null,
      survivesVs: survives ? survives[1] : null,
      unattackableBy: unattack ? parseCivs(unattack[1]) : null,
      // 条件つき（「他に2体以上いるなら」など）は含めない
      unblockable: line('このクリーチャーは(?:相手に)?ブロックされない').test(t),
      mustAttack: /このクリーチャーは毎ターン攻撃しなければならない/.test(t),
      needOppShields: /相手にシールドが1枚もなければこのクリーチャーは攻撃することができない/.test(t),
      outnumbered: /相手のクリーチャーの数が自分のクリーチャーの数より多いときこのクリーチャーは攻撃することができない/.test(t),
      blockedBreak: /このクリーチャーがブロックされたとき相手のシールドが1枚でもあればそのうちの1枚をブレイクする/.test(t),
      untapOnTrigger: /相手が「S・トリガー」を使った場合このクリーチャーをアンタップしてもよい/.test(t),
      // 条件つきの「攻撃できない」（相手にシールドがなければ、など）は含めない
      cannotAttack: line('このクリーチャーは攻撃(?:することが)?できない').test(t),
      cannotAttackPlayer: /このクリーチャーは(?:相手)?プレイヤーを攻撃(?:することが)?できない/.test(t),
      cannotAttackCreature: /このクリーチャーはクリーチャーを攻撃できない/.test(t),
      powerAttacker: pa ? Number(pa[1]) : 0,
      evolution: /進化/.test(card.type ?? ''),
      attackUntapped: untapped ? (parseCivs(untapped[1]).length ? parseCivs(untapped[1]) : true) : false,
      // ブロックされない相手 { maxPower } / { minPower } / { civ }
      unblockableBy: blockMax ? { maxPower: Number(blockMax[1]) } : blockMin ? { minPower: Number(blockMin[1]) } : blockCiv ? { civ: blockCiv[1] } : null,
      // バトルに勝っても、バトルのあと墓地へ
      suicide: /このクリーチャーはバトルに勝ってもバトルのあと持ち主の墓地に置かれる/.test(t),
      dieAfterPlayerAttack: /相手プレイヤーを攻撃したあと持ち主の墓地に置かれる/.test(t),
      // バトルゾーンから墓地に置かれるとき、かわりに置く場所
      onDeath: /墓地に置くかわりに自分の手札に戻す/.test(t) ? 'hand'
        : /墓地に置くかわりに自分のマナゾーンに置く|墓地に置かれたとき自分のマナゾーンに置く/.test(t) ? 'mana'
          : /墓地に置かれるとき裏向きにして自分のシールドに加える/.test(t) ? 'shields' : null,
      untapAfterBlock: /ブロック(?:のためにタップした|した)とき(?:は)?バトルの(?:あと|後)でアンタップする/.test(t),
      // 自分のターンの終わりにアンタップする（self：このクリーチャー、all：自分のクリーチャーすべて）
      endUntap: /自分のターンの終わりにこのクリーチャーをアンタップしてよい|自分のターンの終わりにこれをアンタップする/.test(t) ? 'self'
        : /自分のターンの終わりにバトルゾーンにある自分のクリーチャーをすべてアンタップしてよい/.test(t) ? 'all' : null,
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
    card.set ? `収録：${card.set}` : '',
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
      };
    }
    return cardsById;
  }

  // ---------- 保存 ----------

  function emptyState() {
    return { decks: [{ id: 1, name: 'デッキ1', cards: {} }], current: 1 };
  }

  // 以前の版のデータから、使わなくなった項目（カード・フォーマット・ほかのフォーマットの殿堂）と、
  // 収録カードにないカード（基本編以外・架空のサンプル）を取り除く
  function load() {
    let state = null;
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved?.decks?.length) state = saved;
    } catch {}
    state ??= emptyState();
    const cards = allCards();
    let changed = false;
    for (const key of ['cards', 'classicVersion']) {
      if (key in state) { delete state[key]; changed = true; }
    }
    if (state.regulations) {
      if (state.regulations.base) state.regulation = state.regulations.base;
      delete state.regulations;
      changed = true;
    }
    for (const d of state.decks) {
      if ('format' in d) { delete d.format; changed = true; }
      for (const id of Object.keys(d.cards)) {
        if (!cards[id]) { delete d.cards[id]; changed = true; }
      }
    }
    state.decks = state.decks.filter((d) => d.name !== 'サンプルデッキ' || Object.keys(d.cards).length);
    if (!state.decks.length) state.decks = emptyState().decks;
    if (!state.decks.some((d) => d.id === state.current)) state.current = state.decks[0].id;
    if (changed) save(state);
    return state;
  }

  function save(state) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
  }

  return {
    STORAGE_KEY, DECK_SIZE, MAX_COPIES, SHIELDS, HAND, CIVS, REGULATION,
    civOf, civText, isCreatureType, isSpellType, abilities,
    cardFace, detailText, allCards, load, save,
  };
})();
