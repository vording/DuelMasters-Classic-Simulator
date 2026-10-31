// DuelMasters Classic Simulator — デッキ作成（カードのデータは cards.js・classic-cards.js）

const $ = (id) => document.getElementById(id);

let state = DM.load();
const CARDS = DM.allCards();
// 絞り込みの文明（空なら全部）
const filterCivs = new Set();

const save = () => DM.save(state);
const nextDeckId = () => Math.max(0, ...state.decks.map((d) => d.id)) + 1;
const activeDeck = () => state.decks.find((d) => d.id === state.current) ?? state.decks[0];
// デッキの中身 [{ card, qty }]（収録カードにないものは除く）
const deckEntries = (d = activeDeck()) => Object.entries(d.cards)
  .map(([id, qty]) => ({ card: CARDS[id], qty }))
  .filter((e) => e.card && e.qty > 0);
const deckTotal = (d = activeDeck()) => deckEntries(d).reduce((n, e) => n + e.qty, 0);
const allCards = () => Object.values(CARDS);
const byCostName = (a, b) => a.cost - b.cost || a.name.localeCompare(b.name, 'ja');
const phone = () => window.isPhone?.() ?? false;

// ---------- 殿堂（クラシック基本編） ----------

// 殿堂の一覧 { restricted: [名前], banned: [名前] }
// 「殿堂…」で書き換えていればそれを、なければ既定の一覧（cards.js）を使う
const reg = () => ({ restricted: [], banned: [], ...(state.regulation ?? DM.REGULATION) });

// 同じカードを入れられる枚数（禁止は0、制限は1）
function maxCopies(card) {
  if (reg().banned.includes(card.name)) return 0;
  if (reg().restricted.includes(card.name)) return 1;
  return DM.MAX_COPIES;
}

// ---------- デッキ操作 ----------

function addCard(card) {
  const d = activeDeck();
  const qty = d.cards[card.id] ?? 0;
  // これ以上入れられない（4枚・殿堂・禁止）
  if (qty >= maxCopies(card)) return Sound.play('cancel');
  d.cards[card.id] = qty + 1;
  Sound.play('card-add');
  update();
}

function removeCard(card) {
  const d = activeDeck();
  if (!d.cards[card.id]) return;
  d.cards[card.id] -= 1;
  Sound.play('card-remove');
  if (d.cards[card.id] <= 0) delete d.cards[card.id];
  update();
}

function update() {
  save();
  renderDeck();
  renderResults();
  if (view() === 'home') renderHome();
}

// 編集中のデッキを変える（編集画面なら URL の #edit= も合わせる）
function switchDeck(id) {
  state.current = id;
  if (view() === 'edit') history.replaceState(null, '', `#edit=${id}`);
  update();
}

// 新しいデッキを作って、編集画面で開く
function createDeck() {
  const name = prompt('新しいデッキの名前', `デッキ${nextDeckId()}`);
  if (name === null) return;
  const deck = { id: nextDeckId(), name: name.trim() || `デッキ${nextDeckId()}`, cards: {} };
  state.decks.push(deck);
  switchDeck(deck.id);
  openDeck(deck.id);
}

// ---------- 画面：デッキ選択（home）とデッキ編集（edit） ----------

const view = () => document.body.dataset.view;

// URL の #edit=デッキID なら編集画面、それ以外はデッキ選択
function route() {
  const m = location.hash.match(/^#edit=(\d+)$/);
  const deck = m && state.decks.find((d) => d.id === Number(m[1]));
  document.body.dataset.view = deck ? 'edit' : 'home';
  if (deck && state.current !== deck.id) {
    state.current = deck.id;
    update();
  }
  if (!deck) renderHome();
  // スタート画面の間は BGM を流さない（START を押したら流す）
  if ($('title-screen').hidden) Bgm.play(deck ? 'edit' : 'select');
  window.scrollTo(0, 0);
}

const openDeck = (id) => {
  if (location.hash !== `#edit=${id}`) location.hash = `edit=${id}`;
  else route();
};
const goHome = () => {
  history.pushState(null, '', location.pathname + location.search);
  changeView();
};

// ワイプで覆って画面を切り替える。覆っている間に重ねて呼ばれても1回だけ（覆い終わったときの URL で切り替える）
let changing = null;
function changeView() {
  changing ??= Wipe.run(route).finally(() => { changing = null; });
  return changing;
}

// デッキの表紙：キーカード（デッキに入っているときだけ）。なければ一番コストの大きいクリーチャー
function deckCover(d) {
  const cards = deckEntries(d).map((e) => e.card);
  return cards.find((c) => c.id === d.keyCard) ?? [...cards].sort((a, b) => DM.isCreatureType(b.type) - DM.isCreatureType(a.type) || b.cost - a.cost)[0];
}

// キーカードにする（同じカードをもう一度押すと解除）
function toggleKeyCard(card) {
  const d = activeDeck();
  d.keyCard = d.keyCard === card.id ? undefined : card.id;
  Sound.play('button');
  update();
}

// デッキ選択：デッキごとのタイル（表紙＝キーカード、名前、枚数、文明）
function renderHome() {
  $('home-count').textContent = `${state.decks.length}個`;
  $('home-decks').replaceChildren(...state.decks.map((d) => {
    const total = deckTotal(d);
    const cards = deckEntries(d).map((e) => e.card);
    const cover = deckCover(d);
    const civs = DM.CIVS.filter((c) => cards.some((card) => card.civs.includes(c.name)));
    const tile = document.createElement('div');
    tile.className = 'deck-tile';
    tile.tabIndex = 0;
    tile.innerHTML = '<div class="tile-cover"></div><div class="tile-name"></div><div class="tile-meta"><span class="tile-count"></span><span class="civ-dots"></span></div><div class="tile-actions"><button type="button" class="tile-edit">編集</button><button type="button" class="tile-play primary">対戦 ▶</button></div>';
    tile.querySelector('.tile-cover').append(cover ? DM.cardFace(cover, { lazy: true }) : Object.assign(document.createElement('span'), { className: 'tile-empty', textContent: 'カードなし' }));
    tile.querySelector('.tile-name').textContent = d.name;
    const count = tile.querySelector('.tile-count');
    count.textContent = `${total} / ${DM.DECK_SIZE}`;
    count.classList.toggle('ok', total === DM.DECK_SIZE);
    tile.querySelector('.civ-dots').replaceChildren(...civs.map((c) => Object.assign(document.createElement('i'), { className: `civ-dot civ-${c.cls}`, title: c.name })));
    tile.addEventListener('click', (e) => {
      if (e.target.closest('.tile-play')) Bgm.leave(`play.html?deck=${d.id}`);
      else openDeck(d.id);
    });
    tile.addEventListener('keydown', (e) => { if (e.key === 'Enter') openDeck(d.id); });
    return tile;
  }));
}

// ---------- スタート画面 ----------

const TITLE_KEY = 'dm-deckmaker-title-seen';

// 真っ暗な画面に、ふわふわ浮かんで点滅するロゴと TOUCH START だけ
function showTitle() {
  const screen = $('title-screen');
  screen.classList.remove('launch');
  screen.hidden = false;
  $('title-start').focus({ preventScroll: true });
}

// 画面のどこかを押す：光の輪と火花が広がり、ロゴが手前に飛んできて、ワイプでデッキ選択へ
let starting = false;
async function startFromTitle() {
  if (starting) return;
  starting = true;
  const screen = $('title-screen');
  try { sessionStorage.setItem(TITLE_KEY, '1'); } catch {}
  Sound.play('evolve');
  // 光の輪（3つ）と火花（放射状に飛ぶ）
  const burst = document.createElement('div');
  burst.className = 'title-burst';
  for (let k = 0; k < 3; k++) burst.append(Object.assign(document.createElement('i'), { className: `title-ring r${k}` }));
  for (let k = 0; k < 28; k++) {
    const spark = document.createElement('i');
    spark.className = 'title-spark';
    const angle = (k / 28) * Math.PI * 2 + Math.random() * 0.2;
    const dist = 180 + Math.random() * 380;
    spark.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
    spark.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
    spark.style.setProperty('--delay', `${Math.random() * 0.12}s`);
    burst.append(spark);
  }
  // ロゴの真ん中から広げる
  screen.append(burst);
  screen.classList.add('launch');
  await new Promise((resolve) => setTimeout(resolve, 1100));
  await Wipe.cover();
  screen.hidden = true;
  screen.classList.remove('launch');
  burst.remove();
  route();
  Wipe.reveal();
  starting = false;
}

// 殿堂の印（一覧・デッキリスト）：制限＝「殿堂」、禁止＝「禁止」
function regMark(card) {
  const banned = reg().banned.includes(card.name);
  if (!banned && !reg().restricted.includes(card.name)) return null;
  return Object.assign(document.createElement('span'), {
    className: `reg-mark ${banned ? 'banned' : 'restricted'}`,
    textContent: banned ? '禁止' : '殿堂',
    title: banned ? 'プレミアム殿堂（デッキに入れられない）' : '殿堂（デッキに1枚まで）',
  });
}

function renameDeck() {
  const deck = activeDeck();
  const name = prompt('デッキ名', deck.name);
  if (!name?.trim()) return;
  deck.name = name.trim();
  update();
}

function copyDeck() {
  const src = activeDeck();
  const deck = { id: nextDeckId(), name: `${src.name}のコピー`, sort: src.sort, cards: { ...src.cards } };
  state.decks.push(deck);
  switchDeck(deck.id);
}

function deleteDeck() {
  const deck = activeDeck();
  if (!confirm(`「${deck.name}」を削除しますか？`)) return;
  state.decks = state.decks.filter((d) => d !== deck);
  if (!state.decks.length) state.decks.push({ id: 1, name: 'デッキ1', cards: {} });
  switchDeck(state.decks[0].id);
}

function deckWarnings() {
  const total = deckTotal();
  const warnings = [];
  if (total !== DM.DECK_SIZE) warnings.push(`デッキはちょうど${DM.DECK_SIZE}枚です（現在${total}枚）`);
  for (const { card, qty } of deckEntries()) {
    const max = maxCopies(card);
    if (max === 0) warnings.push(`${card.name} は禁止カードです`);
    else if (qty > max) warnings.push(`${card.name} は${max}枚までです${max === 1 ? '（殿堂）' : ''}`);
  }
  return warnings;
}

// ---------- 殿堂の編集 ----------

function openRegulations() {
  const form = $('reg-form');
  form.elements.restricted.value = reg().restricted.join('\n');
  form.elements.banned.value = reg().banned.join('\n');
  $('reg-dialog').showModal();
}

function saveRegulations(e) {
  e.preventDefault();
  const form = $('reg-form');
  const lines = (name) => [...new Set(form.elements[name].value.split(/\r?\n/).map((s) => s.replace(/^[《\s]+|[》\s]+$/g, '')).filter(Boolean))];
  state.regulation = { restricted: lines('restricted'), banned: lines('banned') };
  $('reg-dialog').close();
  update();
}

// ---------- テキストのコピー・インポート ----------

function exportText() {
  return deckEntries()
    .sort((a, b) => byCostName(a.card, b.card))
    .map((e) => `${e.qty} ${e.card.name}`)
    .join('\n');
}

async function copyExport(button) {
  const text = exportText();
  const label = button.textContent;
  if (!phone()) {
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = 'コピーしました';
      setTimeout(() => (button.textContent = label), 1500);
      return;
    } catch {}
  }
  showExport(text, 'デッキリスト');
}

function showExport(text, title) {
  $('export-title').textContent = title;
  $('export-text').value = text;
  $('export-status').textContent = '';
  $('export-share').hidden = !navigator.share;
  $('export-dialog').showModal();
}

async function copyFromDialog() {
  const box = $('export-text');
  const status = (t) => ($('export-status').textContent = t);
  try {
    await navigator.clipboard.writeText(box.value);
    status('コピーしました');
    return;
  } catch {}
  box.focus();
  box.setSelectionRange(0, box.value.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch {}
  status(ok ? 'コピーしました' : 'コピーできませんでした。テキストを長押しして「すべてを選択」→「コピー」してください');
}

function openImport() {
  $('import-text').value = '';
  $('import-name').value = '';
  $('import-status').textContent = '';
  $('import-dialog').showModal();
  $('import-text').focus();
}

const cardByName = (name) => allCards().find((c) => c.name === name);

function runImport(e) {
  e.preventDefault();
  const cards = {};
  const missing = [];
  for (const raw of $('import-text').value.split(/\r?\n/)) {
    const m = raw.trim().match(/^(?:(\d+)\s*[xX×枚]?\s+)?(.+)$/);
    if (!m) continue;
    const name = m[2].trim();
    const card = cardByName(name);
    if (!card) { missing.push(name); continue; }
    cards[card.id] = (cards[card.id] ?? 0) + Number(m[1] ?? 1);
  }
  if (!Object.keys(cards).length) {
    $('import-status').textContent = missing.length
      ? `カードが1枚も見つかりませんでした：${missing.join('、')}`
      : 'カードの行が見つかりませんでした。';
    return;
  }
  const deck = { id: nextDeckId(), name: $('import-name').value.trim() || `インポート${nextDeckId()}`, cards };
  state.decks.push(deck);
  switchDeck(deck.id);
  if (missing.length) $('import-status').textContent = `「${deck.name}」を追加しました。\n見つからなかったカード：${missing.join('、')}`;
  else $('import-dialog').close();
}

// ---------- 共有リンク ----------
// デッキ名・カード名と枚数を URL の # 以降に詰める（サーバーには送られない）。
// 形式: #deck=<z|j><base64url>（z: deflate で圧縮した JSON、j: 圧縮なし）。
// 以前の版のリンク（カードの情報ごと入っている）も、名前で読み込む

const toBase64Url = (bytes) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromBase64Url = (text) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const pipeBytes = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());

async function deckLink(deck) {
  const data = { n: deck.name, c: deckEntries(deck).map((e) => [e.qty, e.card.name]) };
  let bytes = new TextEncoder().encode(JSON.stringify(data));
  let tag = 'j';
  if (window.CompressionStream) {
    bytes = await pipeBytes(bytes, new CompressionStream('deflate-raw'));
    tag = 'z';
  }
  return `${location.origin}${location.pathname}#deck=${tag}${toBase64Url(bytes)}`;
}

async function readDeckLink(value) {
  let bytes = fromBase64Url(value.slice(1));
  if (value[0] === 'z') bytes = await pipeBytes(bytes, new DecompressionStream('deflate-raw'));
  const data = JSON.parse(new TextDecoder().decode(bytes));
  if (!Array.isArray(data?.c)) throw new Error('bad link');
  return data;
}

async function shareLink(button) {
  const deck = activeDeck();
  if (!deckTotal(deck)) {
    alert('デッキが空です。');
    return;
  }
  const url = await deckLink(deck);
  const label = button.textContent;
  if (phone() && navigator.share) {
    navigator.share({ title: deck.name, url }).catch(() => {});
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    button.textContent = 'リンクをコピーしました';
    setTimeout(() => (button.textContent = label), 1500);
  } catch {
    showExport(url, '共有リンク');
  }
}

// 共有リンクで開かれたら、確認してからデッキを追加する
async function openSharedDeck() {
  const m = location.hash.match(/^#deck=([zj][\w-]+)$/);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  let data;
  try {
    data = await readDeckLink(m[1]);
  } catch {
    alert('共有リンクを読み込めませんでした。リンクが途中で切れていないか確認してください。');
    return;
  }
  const cards = {};
  const missing = [];
  let total = 0;
  for (const [qty, c] of data.c) {
    const name = typeof c === 'string' ? c : c?.name;
    const card = cardByName(name);
    if (!card || !(qty > 0)) { if (name) missing.push(name); continue; }
    cards[card.id] = (cards[card.id] ?? 0) + qty;
    total += qty;
  }
  const name = String(data.n ?? '共有デッキ').slice(0, 60);
  const note = missing.length ? `\n（見つからないカード：${missing.join('、')}）` : '';
  if (!total || !confirm(`共有されたデッキ「${name}」（${total}枚）を追加しますか？${note}`)) return;
  const deck = { id: nextDeckId(), name, cards };
  state.decks.push(deck);
  switchDeck(deck.id);
  openDeck(deck.id);
}

// ---------- 描画 ----------

// カードの詳細（拡大表示）。「＋1枚」「−1枚」は閉じずに枚数を書き換える
const detailText = (card) => `【デッキに ${activeDeck().cards[card.id] ?? 0} / ${maxCopies(card)} 枚】\n${DM.detailText(card)}`;
// 長押しのあいだだけ出す詳細（離したら閉じる）
const peekCard = (card) => ({ name: card.name, image: card.image, text: detailText(card) });
function openDetail(card) {
  const refresh = () => updateCardDetailText(detailText(card));
  showCardDetail({ name: card.name, image: card.image, text: detailText(card) }, [
    ['− 1枚', () => { removeCard(card); refresh(); }, { keep: true }],
    ['＋ 1枚', () => { addCard(card); refresh(); }, { keep: true, primary: true }],
  ]);
}

function matchesFilter(card) {
  const q = $('query').value.trim();
  if (q && ![card.name, card.race, card.text, card.type].some((s) => String(s ?? '').includes(q))) return false;
  if (filterCivs.size && !card.civs.some((c) => filterCivs.has(c))) return false;
  return true;
}

// 一度に並べる枚数（多いと重いので「さらに表示」で増やす）
const PAGE = 120;
let shownLimit = PAGE;

// 絞り込みを変えたら、表示する枚数を最初に戻す
function refilter() {
  shownLimit = PAGE;
  renderResults();
  $('results').parentElement.scrollTop = 0;
}

function renderResults() {
  const list = allCards().filter(matchesFilter).sort(byCostName);
  $('card-total').textContent = `${list.length} / ${allCards().length}`;
  $('more').hidden = list.length <= shownLimit;
  const box = $('results');
  if (!list.length) {
    box.innerHTML = '<p class="empty">条件に合うカードがありません。</p>';
    return;
  }
  box.replaceChildren(...list.slice(0, shownLimit).map((card) => {
    const qty = activeDeck().cards[card.id] ?? 0;
    const el = document.createElement('div');
    el.className = 'result' + (qty >= maxCopies(card) ? ' maxed' : '') + (maxCopies(card) === 0 ? ' out-of-era' : '');
    el.tabIndex = 0;
    el.append(DM.cardFace(card, { lazy: true }));
    if (qty) el.append(Object.assign(document.createElement('span'), { className: 'badge', textContent: qty }));
    const mark = regMark(card);
    if (mark) el.append(mark);
    // クリック（スマホはタップ）で1枚追加、右クリックで1枚減らす、長押ししているあいだ詳細
    el.addEventListener('click', () => addCard(card));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addCard(card);
      else if (e.key === ' ') {
        e.preventDefault();
        openDetail(card);
      }
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!phone()) removeCard(card);
    });
    onPeek(el, () => peekCard(card));
    return el;
  }));
}

function renderDeckList() {
  $('deck-select').replaceChildren(...state.decks.map((d) => new Option(`${d.name}（${deckTotal(d)}枚）`, d.id)));
  $('deck-select').value = activeDeck().id;
}

function renderDeck() {
  renderDeckList();
  $('deck-count').textContent = deckTotal();
  $('phone-deck-count').textContent = deckTotal();
  $('warnings').replaceChildren(...deckWarnings().map((w) => Object.assign(document.createElement('li'), { textContent: w })));
  renderCivCount();
  renderStats();
  renderCurve();

  const deck = $('deck');
  const entries = deckEntries().sort((a, b) => byCostName(a.card, b.card));
  $('deck-sort').value = activeDeck().sort ?? 'type';
  if (!entries.length) {
    deck.innerHTML = '<p class="empty">カードをクリック（スマホはタップ）で追加できます。長押しで詳細</p>';
    return;
  }
  deck.replaceChildren(...deckGroups(entries, activeDeck().sort).flatMap(([label, list]) => {
    const h = document.createElement('h4');
    h.textContent = `${label} (${list.reduce((n, e) => n + e.qty, 0)})`;
    return [h, ...list.map(renderRow)];
  }));
}

// デッキリストの見出しごとのまとまり [[見出し, entries]]。中はコストの小さい順（コスト順では名前順）
function deckGroups(entries, sort = 'type') {
  const groups = new Map();
  const put = (key, e) => (groups.get(key) ?? groups.set(key, []).get(key)).push(e);
  if (sort === 'cost') {
    for (const e of entries) put(`コスト${e.card.cost}`, e);
    return [...groups];
  }
  if (sort === 'civ') {
    // 単色は文明の並び、多色はまとめて最後
    for (const e of entries) put(e.card.civs.length > 1 ? '多色' : e.card.civs[0], e);
    const order = [...DM.CIVS.map((c) => c.name), '多色'];
    return order.filter((k) => groups.has(k)).map((k) => [k, groups.get(k)]);
  }
  for (const e of entries) put(DM.isCreatureType(e.card.type) ? 'クリーチャー' : DM.isSpellType(e.card.type) ? '呪文' : 'その他', e);
  return ['クリーチャー', '呪文', 'その他'].filter((k) => groups.has(k)).map((k) => [k, groups.get(k)]);
}

// 内訳：S・トリガー・ブロッカーの枚数と、クリーチャー・呪文・その他の枚数
function renderStats() {
  const count = (test) => deckEntries().reduce((n, e) => n + (test(e.card) ? e.qty : 0), 0);
  const ab = (c) => DM.abilities(c);
  const items = [
    ['S・トリガー', count((c) => ab(c).sTrigger), 'strong'],
    ['ブロッカー', count((c) => ab(c).blocker), ''],
    ['クリーチャー', count((c) => DM.isCreatureType(c.type)), ''],
    ['呪文', count((c) => DM.isSpellType(c.type)), ''],
    ['その他', count((c) => !DM.isCreatureType(c.type) && !DM.isSpellType(c.type)), ''],
  ];
  $('deck-stats').replaceChildren(...items.filter(([, n], i) => n || i < 2).map(([label, n, cls]) => {
    const s = document.createElement('span');
    s.className = `stat ${cls}`;
    // 「S・トリガー 4枚」の形（数字を先に書くと「4S・トリガー」と読みにくい）
    s.append(label, Object.assign(document.createElement('b'), { textContent: n }), '枚');
    return s;
  }));
}

function renderRow({ card, qty }) {
  const row = document.createElement('div');
  const key = activeDeck().keyCard === card.id;
  row.className = `row${key ? ' key' : ''}`;
  row.innerHTML = '<button class="key-btn"></button><span class="qty"></span><span class="civ-dots"></span><span class="cost"></span><span class="name"></span><button class="minus" aria-label="1枚減らす">−</button><button class="plus" aria-label="1枚追加">＋</button>';
  // キーカード：デッキ選択の表紙に出す
  const keyBtn = row.querySelector('.key-btn');
  keyBtn.textContent = key ? '★' : '☆';
  keyBtn.title = key ? 'キーカード（押すと解除）' : 'キーカードにする（デッキ選択の表紙に出す）';
  keyBtn.setAttribute('aria-pressed', String(key));
  keyBtn.addEventListener('click', () => toggleKeyCard(card));
  row.querySelector('.qty').textContent = qty;
  row.querySelector('.cost').textContent = card.cost;
  row.querySelector('.name').textContent = card.name;
  const mark = regMark(card);
  if (mark) row.querySelector('.name').append(mark);
  row.querySelector('.civ-dots').replaceChildren(...card.civs.map((n) => {
    const dot = document.createElement('i');
    dot.className = `civ-dot civ-${DM.civOf(n)?.cls}`;
    dot.title = n;
    return dot;
  }));
  row.querySelector('.minus').addEventListener('click', () => removeCard(card));
  row.querySelector('.plus').addEventListener('click', () => addCard(card));
  // カード名：クリックで1枚追加、右クリックで1枚減らす、長押しで詳細
  const name = row.querySelector('.name');
  name.addEventListener('click', () => addCard(card));
  name.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!phone()) removeCard(card);
  });
  onPeek(name, () => peekCard(card));
  return row;
}

// 文明ごとの枚数（多色のカードはそれぞれの文明に数える）
function renderCivCount() {
  const counts = new Map(DM.CIVS.map((c) => [c.name, 0]));
  for (const { card, qty } of deckEntries()) for (const n of card.civs) counts.set(n, counts.get(n) + qty);
  $('civ-count').replaceChildren(...DM.CIVS.filter((c) => counts.get(c.name)).map((c) => {
    const s = document.createElement('span');
    s.className = `civ-chip civ-${c.cls}`;
    s.textContent = `${c.name} ${counts.get(c.name)}`;
    return s;
  }));
}

function renderCurve() {
  const buckets = Array(9).fill(0); // 0〜7, 8+
  for (const { card, qty } of deckEntries()) buckets[Math.min(card.cost, 8)] += qty;
  const max = Math.max(1, ...buckets);
  $('curve').replaceChildren(...buckets.map((n, i) => {
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.innerHTML = `<span class="n">${n || ''}</span><div class="fill" style="height:${(n / max) * 100}%"></div><span class="label">${i === 8 ? '8+' : i}</span>`;
    return bar;
  }));
}

function renderCivFilter() {
  $('civ-filter').replaceChildren(...DM.CIVS.map((c) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `civ-chip civ-${c.cls}`;
    b.textContent = c.name;
    b.setAttribute('aria-pressed', String(filterCivs.has(c.name)));
    b.addEventListener('click', () => {
      if (filterCivs.has(c.name)) filterCivs.delete(c.name);
      else filterCivs.add(c.name);
      renderCivFilter();
      refilter();
    });
    return b;
  }));
}

// ---------- 初期化 ----------

function init() {
  // 並び順はデッキごとに保存する
  $('deck-sort').addEventListener('change', (e) => {
    activeDeck().sort = e.target.value;
    save();
    renderDeck();
  });
  $('reg-open').addEventListener('click', openRegulations);
  $('reg-form').addEventListener('submit', saveRegulations);
  $('reg-cancel').addEventListener('click', () => $('reg-dialog').close());
  $('reg-reset').addEventListener('click', () => {
    if (!confirm('この殿堂を既定の一覧に戻しますか？')) return;
    delete state.regulation;
    $('reg-dialog').close();
    update();
  });

  $('query').addEventListener('input', refilter);
  $('more').addEventListener('click', () => {
    shownLimit += PAGE * 2;
    renderResults();
  });
  renderCivFilter();

  $('deck-select').addEventListener('change', (e) => openDeck(Number(e.target.value)));
  $('deck-new').addEventListener('click', createDeck);
  $('deck-rename').addEventListener('click', renameDeck);
  $('deck-copy').addEventListener('click', copyDeck);
  $('deck-delete').addEventListener('click', deleteDeck);
  $('deck-play').addEventListener('click', () => {
    Bgm.leave(`play.html?deck=${activeDeck().id}`);
  });
  $('clear').addEventListener('click', () => {
    if (!deckTotal() || confirm('デッキを空にしますか？')) {
      activeDeck().cards = {};
      update();
    }
  });

  $('export').addEventListener('click', () => copyExport($('export')));
  $('import').addEventListener('click', openImport);
  $('import-form').addEventListener('submit', runImport);
  $('import-cancel').addEventListener('click', () => $('import-dialog').close());
  $('share-link').addEventListener('click', () => shareLink($('share-link')));
  $('export-copy').addEventListener('click', copyFromDialog);
  $('export-share').addEventListener('click', () => navigator.share?.({ title: activeDeck().name, text: $('export-text').value }).catch(() => {}));
  $('export-close').addEventListener('click', () => $('export-dialog').close());
  // デッキ選択・デッキ編集の切り替え（ブラウザの戻る・進むも）
  $('deck-back').addEventListener('click', goHome);
  $('home-new').addEventListener('click', createDeck);
  $('home-import').addEventListener('click', openImport);
  // 画面が変わるときは、ワイプで覆ってから切り替える
  // （# を変えると popstate と hashchange の両方が起きるので、1回だけ）
  window.addEventListener('hashchange', () => {
    if (location.hash.startsWith('#deck=')) openSharedDeck();
    else changeView();
  });
  window.addEventListener('popstate', () => {
    if (!location.hash.startsWith('#deck=')) changeView();
  });

  // スタート画面：画面のどこを押してもスタート（Enter・スペースでも）。上のロゴを押すとスタート画面に戻る
  $('title-screen').addEventListener('click', startFromTitle);
  document.querySelector('.topbar .logo').addEventListener('click', () => Wipe.run(showTitle));
  document.querySelector('.topbar .logo').style.cursor = 'pointer';

  save(); // 一人回し画面で読めるように、デッキを保存しておく
  renderDeck();
  renderResults();
  if (!$('title-screen').hidden) showTitle();
  route();
  openSharedDeck();
}

init();
