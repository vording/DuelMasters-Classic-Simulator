// デュエマ System — デッキ作成（カードのデータは cards.js・classic-cards.js）

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

// ---------- フォーマット（クラシック）と殿堂 ----------

const deckFormat = (d = activeDeck()) => DM.formatOf(d.format);
// 殿堂の一覧 { restricted: [名前], banned: [名前], helper: [名前], combos: [[名前, 名前]] }
// 「殿堂…」で書き換えていればそれを、なければ既定の一覧（cards.js）を使う
const regOf = (fmt) => ({ restricted: [], banned: [], helper: [], combos: [], ...(state.regulations?.[fmt.id] ?? DM.REGULATIONS[fmt.id]) });

// 同じカードを入れられる枚数（禁止は0、制限・お助けは1）
function maxCopies(card, fmt = deckFormat()) {
  if (!fmt.era) return DM.MAX_COPIES;
  const reg = regOf(fmt);
  if (reg.banned.includes(card.name)) return 0;
  if (reg.restricted.includes(card.name) || reg.helper.includes(card.name)) return 1;
  return DM.MAX_COPIES;
}

const inEra = (card, fmt = deckFormat()) => !fmt.era || DM.eraRank(card.era) <= fmt.era;
const usableIn = (card, fmt = deckFormat()) => inEra(card, fmt) && maxCopies(card, fmt) > 0;

// ---------- デッキ操作 ----------

function addCard(card) {
  const d = activeDeck();
  const qty = d.cards[card.id] ?? 0;
  if (qty >= maxCopies(card)) return;
  d.cards[card.id] = qty + 1;
  update();
}

function removeCard(card) {
  const d = activeDeck();
  if (!d.cards[card.id]) return;
  d.cards[card.id] -= 1;
  if (d.cards[card.id] <= 0) delete d.cards[card.id];
  update();
}

function update() {
  save();
  renderDeck();
  renderResults();
}

function switchDeck(id) {
  state.current = id;
  update();
}

function createDeck() {
  const name = prompt('新しいデッキの名前', `デッキ${nextDeckId()}`);
  if (name === null) return;
  const deck = { id: nextDeckId(), name: name.trim() || `デッキ${nextDeckId()}`, format: activeDeck().format, cards: {} };
  state.decks.push(deck);
  switchDeck(deck.id);
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
  const deck = { id: nextDeckId(), name: `${src.name}のコピー`, format: src.format, sort: src.sort, cards: { ...src.cards } };
  state.decks.push(deck);
  switchDeck(deck.id);
}

function deleteDeck() {
  const deck = activeDeck();
  if (!confirm(`「${deck.name}」を削除しますか？`)) return;
  state.decks = state.decks.filter((d) => d !== deck);
  if (!state.decks.length) state.decks.push({ id: 1, name: 'デッキ1', format: 'c08', cards: {} });
  switchDeck(state.decks[0].id);
}

// size: false なら枚数（40枚ちょうど）の警告を出さない（レギュレーションのバッジで使う）
function deckWarnings(fmt = deckFormat(), { size = true } = {}) {
  const total = deckTotal();
  const warnings = [];
  if (size && total !== DM.DECK_SIZE) warnings.push(`デッキはちょうど${DM.DECK_SIZE}枚です（現在${total}枚）`);
  const reg = regOf(fmt);
  const entries = deckEntries();
  for (const { card, qty } of entries) {
    if (!inEra(card, fmt)) warnings.push(`${card.name} は${fmt.name}で使用できません（初出：${card.set}）`);
    const max = maxCopies(card, fmt);
    if (max === 0) warnings.push(`${card.name} は${fmt.name}の禁止カードです`);
    else if (qty > max) warnings.push(`${card.name} は${max}枚までです${max === 1 ? `（${reg.helper.includes(card.name) ? 'お助けカード' : '制限カード'}）` : ''}`);
  }
  if (fmt.era) {
    const helpers = entries.filter((e) => reg.helper.includes(e.card.name));
    if (helpers.length > 1) warnings.push(`お助けカードは1種類だけです（${helpers.map((e) => e.card.name).join('、')}）`);
    const names = new Set(entries.map((e) => e.card.name));
    for (const [a, b] of reg.combos) {
      if (names.has(a) && names.has(b)) warnings.push(`プレミアム殿堂コンビ：${a} と ${b} は同時に入れられません`);
    }
  }
  return warnings;
}

// レギュレーションのバッジ：採用カードの初出から、デッキが入る一番狭いクラシックのフォーマットを決める
// { fmt, issues: そのフォーマットの殿堂の違反数 }。デッキが空なら null
function fittingFormat() {
  const cards = deckEntries().map((e) => e.card);
  if (!cards.length) return null;
  const rank = Math.max(...cards.map((c) => DM.eraRank(c.era)));
  const fmt = DM.FORMATS.find((f) => f.era && f.era >= rank) ?? DM.formatOf('c08');
  return { fmt, issues: deckWarnings(fmt, { size: false }).length };
}

function renderBadge() {
  const fit = fittingFormat();
  const badge = $('reg-badge');
  badge.hidden = !fit;
  if (!fit) return;
  const switchTo = deckFormat().id !== fit.fmt.id;
  badge.className = `reg-badge ${fit.issues ? 'issues' : 'ok'} fmt-${fit.fmt.id}`;
  badge.textContent = `${fit.fmt.name}で組めるデッキ${fit.issues ? `（殿堂の違反${fit.issues}件）` : ''}${switchTo ? ' ▶ このフォーマットにする' : ''}`;
  badge.disabled = !switchTo;
  badge.onclick = () => {
    activeDeck().format = fit.fmt.id;
    update();
  };
}

// ---------- 殿堂の編集 ----------

function openRegulations() {
  const fmt = deckFormat();
  if (!fmt.era) return;
  const reg = regOf(fmt);
  const form = $('reg-form');
  $('reg-title').textContent = `${fmt.name}の殿堂`;
  form.elements.restricted.value = reg.restricted.join('\n');
  form.elements.banned.value = reg.banned.join('\n');
  form.elements.helper.value = reg.helper.join('\n');
  form.elements.combos.value = reg.combos.map((c) => c.join(' + ')).join('\n');
  $('reg-dialog').showModal();
}

function saveRegulations(e) {
  e.preventDefault();
  const fmt = deckFormat();
  const form = $('reg-form');
  const lines = (name) => [...new Set(form.elements[name].value.split(/\r?\n/).map((s) => s.replace(/^[《\s]+|[》\s]+$/g, '')).filter(Boolean))];
  state.regulations = {
    ...state.regulations,
    [fmt.id]: {
      restricted: lines('restricted'),
      banned: lines('banned'),
      helper: lines('helper'),
      combos: lines('combos').map((l) => l.split(/\s*[+＋]\s*/).map((s) => s.replace(/^《|》$/g, '').trim())).filter((c) => c.length === 2 && c[0] && c[1]),
    },
  };
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
  const deck = { id: nextDeckId(), name: $('import-name').value.trim() || `インポート${nextDeckId()}`, format: activeDeck().format, cards };
  state.decks.push(deck);
  switchDeck(deck.id);
  if (missing.length) $('import-status').textContent = `「${deck.name}」を追加しました。\n見つからなかったカード：${missing.join('、')}`;
  else $('import-dialog').close();
}

// ---------- 共有リンク ----------
// デッキ名・フォーマット・カード名と枚数を URL の # 以降に詰める（サーバーには送られない）。
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
  const data = { n: deck.name, f: deck.format, c: deckEntries(deck).map((e) => [e.qty, e.card.name]) };
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
  const deck = { id: nextDeckId(), name, format: DM.formatOf(data.f).id, cards };
  state.decks.push(deck);
  switchDeck(deck.id);
}

// ---------- 描画 ----------

const detailOf = (card) => ({ name: card.name, image: card.image, text: DM.detailText(card) });

function matchesFilter(card) {
  const q = $('query').value.trim();
  if (q && ![card.name, card.race, card.text, card.type].some((s) => String(s ?? '').includes(q))) return false;
  if (filterCivs.size && !card.civs.some((c) => filterCivs.has(c))) return false;
  if ($('format-only').checked && !usableIn(card)) return false;
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
    el.className = 'result' + (qty >= maxCopies(card) ? ' maxed' : '') + (inEra(card) ? '' : ' out-of-era');
    el.tabIndex = 0;
    el.append(DM.cardFace(card, { lazy: true }));
    if (qty) el.append(Object.assign(document.createElement('span'), { className: 'badge', textContent: qty }));
    el.addEventListener('click', () => addCard(card));
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') addCard(card); });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!phone()) removeCard(card);
    });
    hoverPreview(el, card);
    onLongPress(el, () => showCardDetail(detailOf(card), [
      ['1枚追加', () => addCard(card)],
      ['1枚減らす', () => removeCard(card)],
    ]));
    return el;
  }));
}

// PC：マウスを乗せたカードを、マウスの横に大きく出す
function hoverPreview(el, card) {
  el.addEventListener('mouseenter', (e) => {
    if (phone()) return;
    const box = $('hover-preview');
    box.replaceChildren(DM.cardFace(card), Object.assign(document.createElement('p'), { textContent: DM.detailText(card) }));
    box.hidden = false;
    placePreview(e);
  });
  el.addEventListener('mousemove', placePreview);
  el.addEventListener('mouseleave', () => { $('hover-preview').hidden = true; });
}

function placePreview(e) {
  const box = $('hover-preview');
  if (box.hidden) return;
  const { width, height } = box.getBoundingClientRect();
  const x = e.clientX + 24 + width > innerWidth ? e.clientX - width - 24 : e.clientX + 24;
  box.style.left = `${Math.max(8, x)}px`;
  box.style.top = `${Math.max(8, Math.min(e.clientY - height / 3, innerHeight - height - 8))}px`;
}

function renderDeckList() {
  $('deck-select').replaceChildren(...state.decks.map((d) => new Option(`${d.name}（${deckTotal(d)}枚）`, d.id)));
  $('deck-select').value = activeDeck().id;
  const fmt = deckFormat();
  $('format').value = fmt.id;
  $('reg-open').hidden = !fmt.era;
}

function renderDeck() {
  renderDeckList();
  $('deck-count').textContent = deckTotal();
  $('phone-deck-count').textContent = deckTotal();
  $('warnings').replaceChildren(...deckWarnings().map((w) => Object.assign(document.createElement('li'), { textContent: w })));
  renderCivCount();
  renderStats();
  renderCurve();
  renderBadge();

  const deck = $('deck');
  const entries = deckEntries().sort((a, b) => byCostName(a.card, b.card));
  $('deck-sort').value = activeDeck().sort ?? 'type';
  if (!entries.length) {
    deck.innerHTML = '<p class="empty">カードをクリックして追加（右クリックで1枚減らす）</p>';
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
    s.append(Object.assign(document.createElement('b'), { textContent: n }), label);
    return s;
  }));
}

function renderRow({ card, qty }) {
  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML = '<span class="qty"></span><span class="civ-dots"></span><span class="cost"></span><span class="name"></span><button class="minus" aria-label="1枚減らす">−</button><button class="plus" aria-label="1枚追加">＋</button>';
  row.querySelector('.qty').textContent = qty;
  row.querySelector('.cost').textContent = card.cost;
  row.querySelector('.name').textContent = card.name;
  row.querySelector('.civ-dots').replaceChildren(...card.civs.map((n) => {
    const dot = document.createElement('i');
    dot.className = `civ-dot civ-${DM.civOf(n)?.cls}`;
    dot.title = n;
    return dot;
  }));
  row.querySelector('.minus').addEventListener('click', () => removeCard(card));
  row.querySelector('.plus').addEventListener('click', () => addCard(card));
  onLongPress(row.querySelector('.name'), () => showCardDetail(detailOf(card), [
    ['1枚追加', () => addCard(card)],
    ['1枚減らす', () => removeCard(card)],
  ]));
  hoverPreview(row, card);
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
  $('format').replaceChildren(...DM.FORMATS.map((f) => new Option(f.name, f.id)));
  $('format').addEventListener('change', (e) => {
    activeDeck().format = e.target.value;
    update();
  });
  $('format-only').addEventListener('change', refilter);
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
    const { [deckFormat().id]: _, ...rest } = state.regulations ?? {};
    state.regulations = rest;
    $('reg-dialog').close();
    update();
  });

  $('query').addEventListener('input', refilter);
  $('more').addEventListener('click', () => {
    shownLimit += PAGE * 2;
    renderResults();
  });
  renderCivFilter();

  $('deck-select').addEventListener('change', (e) => switchDeck(Number(e.target.value)));
  $('deck-new').addEventListener('click', createDeck);
  $('deck-rename').addEventListener('click', renameDeck);
  $('deck-copy').addEventListener('click', copyDeck);
  $('deck-delete').addEventListener('click', deleteDeck);
  $('deck-play').addEventListener('click', () => {
    location.href = `play.html?deck=${activeDeck().id}`;
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
  window.addEventListener('hashchange', openSharedDeck);

  save(); // 一人回し画面で読めるように、デッキを保存しておく
  renderDeck();
  renderResults();
  openSharedDeck();
}

init();
