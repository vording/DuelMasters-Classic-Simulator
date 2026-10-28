// デュエマ System — 一人回し／ネット対戦（カードの効果は手で処理）
// 自分のゲーム状態はすべて `game` に持ち、変更は act() を通して行う（元に戻すのため）。
// ネット対戦では、描画のたびに自分の公開情報（snapshot）を相手に送り、相手の公開情報を `opp` に受け取る。
// 手札とシールドの中身・山札の順番は送らない。
// 攻撃は1回ずつ：攻撃側が「attack」を送り、守る側がブロックを選んで「attackReply」を返し、
// 攻撃側がバトル・ブレイクの結果を「combat」で送る（守る側がシールドを手札に加え、S・トリガーを選ぶ）。

const GAME_KEY = 'dm-deckmaker-game';
const NET_KEY = 'dm-deckmaker-net';
const CHAT_KEY = 'dm-deckmaker-chat';
const HISTORY_LIMIT = 200;
const CHARGES_PER_TURN = 1;

// 名前・アバターは設定画面（settings.js）で決める
const { avatarImage, validAvatar } = Settings;
const myName = Settings.name;
const myAvatar = Settings.avatar;

const PHASES = [
  ['start', 'ターン開始'],
  ['draw', 'ドロー'],
  ['charge', 'マナチャージ'],
  ['main', 'メイン'],
  ['attack', '攻撃'],
  ['end', 'ターン終了'],
];
const PHASE_NAMES = { ready: '開始待ち' };

const PHASE_HINTS = {
  ready: '相手を待っています。',
  start: 'ターン開始ステップ。',
  draw: 'ドロー・ステップ。',
  charge: 'マナチャージ・ステップ。手札を1枚マナゾーンに置けます（右クリック →「マナゾーンへ」、またはドラッグ）。',
  main: 'メイン・ステップ。手札をダブルクリックで召喚・呪文（マナは自動で支払います）。クリーチャーをクリックすると攻撃します。',
  attack: '攻撃ステップ。攻撃するクリーチャーをクリックしてください。',
  end: 'ターン終了ステップ。',
};

// 負けた理由 → 表示（自分が負けたとき／相手が負けたとき）
const LOSE_TEXT = { deck: '山札がなくなりました', direct: 'ダイレクトアタックを受けました', concede: '投了しました' };
const WIN_TEXT = { deck: '相手の山札がなくなりました', direct: 'ダイレクトアタックが決まりました', concede: '相手が投了しました' };

const ZONES = { library: '山札', hand: '手札', battlefield: 'バトルゾーン', mana: 'マナゾーン', shields: 'シールド', graveyard: '墓地', under: '進化元' };

const $ = (id) => document.getElementById(id);

const saved = DM.load();
const decks = saved.decks ?? [];
const cardData = DM.allCards();

let game = loadGame();
let history = [];
// 表示中の一覧ダイアログ { zone, title, ids: 表示対象のカード（null なら領域全体） } / 相手の領域なら { opp: zone, title }
let viewer = null;

// ---------- ネット対戦の状態 ----------

// 対戦相手 { name, avatar, state: 相手の snapshot, connected }
let opp = null;
// チャット [{ ts, who: 'me' | 'opp' | 'system', name, text }]
let chat = loadJson(sessionStorage, CHAT_KEY) ?? [];
// 接続情報 { role: 'host' | 'guest', code }（再読み込みしても同じ部屋に戻る）
let netInfo = loadJson(sessionStorage, NET_KEY);
// 部屋に入る側：部屋を作った側から届いた最新のゲーム { onDraw: 作った側が後攻か, matchId }
let pendingHost = null;
// 部屋に入る側：まだ合わせていない新しいゲームのターンが先に届いた場合の matchId
let earlyPass = null;
let clearHistoryAfterAct = false;
// 相手のターン：相手から届いた攻撃 { id, attacker: 相手のカードの iid, target: 'player' | 自分のカードの iid }
let incomingAttack = null;
// 表示済みの勝敗（同じ結果でダイアログを何度も開かない）
let shownResult = null;
// メニューを出す位置（最後に押した場所）
let lastPointer = { x: 0, y: 0 };

function loadJson(store, key) {
  try { return JSON.parse(store.getItem(key)); } catch { return null; }
}
function saveJson(store, key, value) {
  try {
    if (value == null) store.removeItem(key);
    else store.setItem(key, JSON.stringify(value));
  } catch {}
}

const oppName = () => opp?.name || '相手';

function renderAvatars() {
  $('my-avatar').style.backgroundImage = avatarImage(myAvatar());
  $('opp-avatar').style.backgroundImage = avatarImage(validAvatar(opp?.avatar));
}

// 開始画面の「プレイヤー」欄（変更は設定画面で行う）
function renderSetupPlayer() {
  $('setup-avatar').style.backgroundImage = avatarImage(myAvatar());
  $('setup-name').textContent = myName();
}

// 設定画面で名前・アバターを変えたとき
function onSettingsChange() {
  renderAvatars();
  renderSetupPlayer();
  // 一人回しでは「あなた」のまま（名前はネット対戦のときだけ出す）
  if (online()) $('my-player-name').textContent = myName();
  if (Net.connected()) sendHello();
}
const online = () => Net.active;

// ---------- スマホ（タッチ操作） ----------

const phone = () => window.isPhone?.() ?? false;

// スマホでは長押しで出すので、ブラウザ標準の長押しメニューは止める（onLongPress は zoom.js）
function onContextMenu(el, fn) {
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!phone()) fn(e);
  });
  onLongPress(el, fn);
}

// ---------- ゲーム状態 ----------

function loadGame() {
  try { return JSON.parse(sessionStorage.getItem(GAME_KEY)); } catch { return null; }
}

function saveGame() {
  try { sessionStorage.setItem(GAME_KEY, JSON.stringify(game)); } catch {}
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function cardFrom(card, iid) {
  return {
    iid,
    cid: card.id,
    name: card.name,
    image: card.image || '',
    civs: card.civs ?? [],
    cost: card.cost ?? 0,
    power: card.power ?? null,
    type: card.type ?? '',
    race: card.race ?? '',
    text: card.text ?? '',
    ab: DM.abilities(card),
    isCreature: DM.isCreatureType(card.type),
    isSpell: DM.isSpellType(card.type),
    tapped: false,
  };
}

// 攻撃するときのパワー（パワーアタッカーを足す）
const attackPower = (c) => (Number(c.power) || 0) + (c.ab?.powerAttacker || 0);

// 召喚酔い：このターン（自分のターン数で数える）に出たクリーチャーは、スピードアタッカー・進化でなければ攻撃できない
const isSick = (c) => !!c.isCreature && c.enteredTurn != null && c.enteredTurn >= game.turn && !c.ab?.speedAttacker && !c.ab?.evolution;

// 拡大表示用（文明・コスト・種類・テキスト・パワー）
const detailOf = (c) => ({ name: c.name, image: c.image, text: DM.detailText(c) });

// 短いお知らせ（数秒で消える）
function showToast(text) {
  let el = document.getElementById('toast');
  if (!el) {
    el = Object.assign(document.createElement('div'), { id: 'toast', className: 'toast' });
    document.body.append(el);
  }
  el.textContent = text;
  el.hidden = false;
  Sound.play('cancel');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { el.hidden = true; }, 2500);
}

// カードの移動に合わせた効果音（マナは文明の色、バトルゾーンはクリーチャーかどうか）
function moveSound(card, from, to) {
  if (to === 'mana') return Sound.manaName(card.civs);
  if (to === 'battlefield') return card.isCreature ? 'summon' : 'field';
  if (to === 'graveyard') {
    if (from === 'battlefield') return 'destroy';
    if (from === 'hand' && card.isSpell) return 'spell';
    return 'discard';
  }
  return null;
}

function newGame(deck, onDraw, random = false) {
  const prevMatchId = game?.matchId ?? null;
  const cards = {};
  const library = [];
  let iid = 0;
  for (const [cid, qty] of Object.entries(deck.cards)) {
    const card = cardData[cid];
    if (!card) continue;
    for (let i = 0; i < qty; i++) {
      iid++;
      cards[iid] = cardFrom(card, iid);
      library.push(iid);
    }
  }
  game = {
    deckId: deck.id,
    deckName: deck.name,
    onDraw,
    turn: 0,
    phase: 'ready',
    charged: 0,
    nextIid: iid + 1,
    cards,
    // 山札は先頭が一番上。シールドは後ろから順にブレイクされる
    zones: { library: shuffle(library), hand: [], battlefield: [], mana: [], shields: [], graveyard: [], under: [] },
    log: [],
    // 手札に加えたシールドのうち、S・トリガーを使うか決めていないもの
    triggers: [],
    // 自分の攻撃で相手の対応を待っている { id, attacker, target }
    attack: null,
    // 一人回し：相手のシールドの残り
    oppShields: DM.SHIELDS,
    // ネット対戦：相手のターン中は true。先攻後攻が確定したら orderFixed
    waiting: false,
    orderFixed: !online() || Net.role === 'host',
    passReceived: false,
    matchId: online() && Net.role === 'host' ? Math.random().toString(36).slice(2) : null,
    prevMatchId,
  };
  if (online() && Net.role === 'guest' && isNewHostGame(pendingHost)) adoptHostOrder(pendingHost);
  history = [];
  incomingAttack = null;
  shownResult = null;
  log(`「${deck.name}」で開始${game.orderFixed ? `（${random ? 'ランダムで' : ''}${game.onDraw ? '後攻' : '先攻'}）` : ''}`);
  // シールドを5枚置いてから、手札を5枚引く
  game.zones.shields = game.zones.library.splice(0, DM.SHIELDS);
  game.zones.hand = game.zones.library.splice(0, DM.HAND);
  Sound.play('shuffle');
  beginFirstTurn();
  render();
  if (Net.connected()) sendHello();
}

// 状態を変更する操作はすべてここを通す
function act(fn) {
  if (!game) return;
  history.push(JSON.stringify(game));
  if (history.length > HISTORY_LIMIT) history.shift();
  fn();
  // ターンを渡した・相手に結果を送った操作は元に戻せない（相手の画面と食い違うため）
  if (clearHistoryAfterAct) {
    history = [];
    clearHistoryAfterAct = false;
  }
  render();
}

// 相手からのメッセージによる変更（元に戻す対象にしない）
function netUpdate(fn) {
  if (!game) return;
  fn();
  history = [];
  render();
}

function undo() {
  const prev = history.pop();
  if (!prev) return;
  Sound.play('cancel');
  game = JSON.parse(prev);
  render();
}

function log(text) {
  game.log.push({ turn: game.turn, text, ts: Date.now() });
}

const zoneOf = (iid) => Object.keys(game.zones).find((z) => game.zones[z].includes(iid));
const started = () => game && game.turn > 0;
// 自分のターン中か（一人回しでは常に自分のターン）
const myTurn = () => started() && !game.waiting;
// 1ターン目が始まる前（相手の1ターン目を待つ後攻も含む）はカードを動かしたり引いたりできない
const canPlay = () => !!game && game.turn > 0;

// ---------- 基本操作（act の中で呼ぶ） ----------

function moveCard(iid, to, { bottom = false, silent = false } = {}) {
  const from = zoneOf(iid);
  if (!from) return;
  const card = game.cards[iid];
  game.zones[from] = game.zones[from].filter((x) => x !== iid);
  const sound = moveSound(card, from, to);
  if (sound) Sound.play(sound);
  if (to !== 'battlefield') card.attacking = false;
  // マナゾーンへは多色カードはタップして置く。それ以外の場所ではアンタップに戻す
  card.tapped = to === 'mana' && card.civs.length > 1;
  if (to === 'battlefield' && from !== 'battlefield') card.enteredTurn = game.turn;
  // 進化クリーチャーがバトルゾーンを離れたら、進化元も同じ場所へ
  const under = from === 'battlefield' && to !== 'battlefield' ? card.under ?? [] : [];
  card.under = to === 'battlefield' ? card.under ?? [] : [];
  if (to === 'library' && !bottom) game.zones.library.unshift(iid);
  else game.zones[to].push(iid);
  for (const u of under) {
    game.zones.under = game.zones.under.filter((x) => x !== u);
    game.cards[u].tapped = false;
    if (to === 'library' && !bottom) game.zones.library.unshift(u);
    else game.zones[to].push(u);
  }
  if (!silent) {
    const where = to === 'library' ? `山札の一番${bottom ? '下' : '上'}` : ZONES[to];
    const shown = from === 'shields' || to === 'shields' ? 'シールドのカード' : card.name;
    log(`${shown}：${ZONES[from]} → ${where}${under.length ? `（進化元${under.length}枚も）` : ''}`);
  }
}

// 山札が0枚になったら負け
function checkDeckOut() {
  if (started() && !game.zones.library.length) lose('deck');
}

function drawCards(n, withLog = true) {
  let drawn = 0;
  for (; drawn < n && game.zones.library.length; drawn++) game.zones.hand.push(game.zones.library.shift());
  if (withLog && drawn) Sound.play('draw');
  if (withLog) log(drawn ? `${drawn}枚引いた` : '山札が空で引けない');
  checkDeckOut();
}

// 負け（理由は LOSE_TEXT のキー）。勝ちは相手の snapshot の result から判定する
function lose(reason) {
  if (game.result) return;
  game.result = { reason };
  log(`敗北：${LOSE_TEXT[reason]}`);
}

function untapAll() {
  const all = [...game.zones.battlefield, ...game.zones.mana];
  if (all.some((iid) => game.cards[iid].tapped)) Sound.play('untap');
  for (const iid of all) game.cards[iid].tapped = false;
}

function clearAttackers() {
  for (const iid of game.zones.battlefield) game.cards[iid].attacking = false;
}

// 先攻の1ターン目はドローしない
function startTurnOne() {
  if (online()) Sound.play('myturn');
  game.turn = 1;
  game.charged = 0;
  log('ターン1開始');
  if (game.onDraw) drawCards(1);
  game.phase = 'charge';
}

function beginTurn() {
  Sound.play(online() ? 'myturn' : 'endturn');
  game.turn++;
  game.charged = 0;
  log(`ターン${game.turn}開始`);
  clearAttackers();
  untapAll();
  game.phase = 'start';
}

function stepPhase() {
  const i = PHASES.findIndex(([id]) => id === game.phase);
  if (i === PHASES.length - 1) return online() ? passTurn() : startNextTurn();
  Sound.play('phase');
  game.phase = PHASES[i + 1][0];
  if (game.phase === 'draw') drawCards(1);
  if (game.phase === 'end') clearAttackers();
}

function startNextTurn() {
  beginTurn();
  stepPhase(); // ドロー
  stepPhase(); // マナチャージ
}

// ---------- ターンの受け渡し（ネット対戦） ----------

// 一人回しはすぐ1ターン目。ネット対戦は先攻後攻の確定を待つ
function beginFirstTurn() {
  if (!online()) return startTurnOne();
  game.phase = 'ready';
  tryFirstTurn();
}

function tryFirstTurn() {
  if (game.phase !== 'ready' || !game.orderFixed) return;
  if (!game.onDraw || game.passReceived) {
    game.waiting = false;
    startTurnOne();
  } else {
    game.waiting = true;
  }
}

// ターン終了：一人回しは次の自分のターン、ネット対戦は相手に渡す
function finishTurn() {
  if (online()) passTurn();
  else startNextTurn();
}

function passTurn() {
  game.phase = 'end';
  clearAttackers();
  game.waiting = true;
  game.attack = null;
  Sound.play('endturn');
  log('ターン終了（相手のターンへ）');
  game.passSent = Net.send({ type: 'pass', matchId: game.matchId });
  clearHistoryAfterAct = true;
}

// 部屋に入る側：部屋を作った側の新しいゲームか
function isNewHostGame(h) {
  if (!h) return false;
  if (h.matchId == null) return !game.orderFixed;
  return h.matchId !== game.prevMatchId && (!game.orderFixed || h.matchId !== game.matchId);
}

function adoptHostOrder(h) {
  if (game.matchId !== h.matchId) game.passReceived = h.matchId != null && earlyPass === h.matchId;
  game.onDraw = !h.onDraw;
  game.orderFixed = true;
  game.matchId = h.matchId;
}

function receivePass(msg) {
  // 前のゲームのターン終了は無視する（入った側がまだ合わせていない新しいゲームの分は覚えておく）
  if (msg.matchId && msg.matchId !== game.matchId && (game.matchId || msg.matchId === game.prevMatchId)) {
    if (Net.role === 'guest' && msg.matchId === pendingHost?.matchId) earlyPass = msg.matchId;
    return;
  }
  incomingAttack = null;
  netUpdate(() => {
    if (game.turn === 0) {
      game.passReceived = true;
      tryFirstTurn();
    } else if (game.waiting) {
      game.waiting = false;
      game.passSent = false;
      startNextTurn();
    }
  });
}

// 通信の不具合などで止まったときに、自分のターンを強制的に始める
function forceMyTurn() {
  if (!game) return;
  incomingAttack = null;
  act(() => {
    game.waiting = false;
    log('自分のターンを開始（手動）');
    if (game.turn === 0) startTurnOne();
    else startNextTurn();
    clearHistoryAfterAct = true;
  });
}

// ---------- マナ・召喚 ----------

const untappedMana = () => game.zones.mana.map((i) => game.cards[i]).filter((c) => !c.tapped);

// 支払うマナを選ぶ：カードの文明をそれぞれ1枚以上含めて、コストの枚数だけ。払えなければ null
function payCost(card) {
  const pool = untappedMana();
  const cost = Number(card.cost) || 0;
  if (pool.length < cost) return null;
  const chosen = [];
  // 必要な文明ごとに、その文明を持つマナを1枚（単色を優先して、多色を残す）
  for (const civ of card.civs) {
    if (chosen.some((c) => c.civs.includes(civ))) continue;
    const pickOne = pool.filter((c) => !chosen.includes(c) && c.civs.includes(civ)).sort((a, b) => a.civs.length - b.civs.length)[0];
    if (!pickOne) return null;
    chosen.push(pickOne);
  }
  if (chosen.length > cost) return null;
  const rest = pool.filter((c) => !chosen.includes(c)).sort((a, b) => a.civs.length - b.civs.length);
  while (chosen.length < cost) chosen.push(rest.shift());
  return chosen;
}

// 払えないときは確認して、支払わずに出す（コストを減らす効果などのため）
function confirmPay(card) {
  const pay = payCost(card);
  if (pay) return { pay };
  const ok = confirm(`マナが足りません（コスト${card.cost}・${DM.civText(card.civs)}、使えるマナ${untappedMana().length}）。支払わずに出しますか？`);
  return ok ? { pay: [] } : null;
}

function tapMana(pay) {
  for (const m of pay) m.tapped = true;
  if (pay.length) Sound.play('tap');
}

// 手札から召喚する・唱える（ダブルクリック）
function playFromHand(iid) {
  if (!canPlay()) return;
  const c = game.cards[iid];
  if (c.ab.evolution && c.isCreature) return chooseEvolutionBase(iid);
  const paid = confirmPay(c);
  if (!paid) return;
  act(() => {
    tapMana(paid.pay);
    const mana = paid.pay.length ? `（マナ${paid.pay.length}）` : '';
    if (c.isSpell) {
      moveCard(iid, 'graveyard', { silent: true });
      log(`${c.name}を唱えた${mana}（効果は手で処理）`);
    } else {
      moveCard(iid, 'battlefield', { silent: true });
      log(`${c.name}を${c.isCreature ? '召喚' : 'バトルゾーンに出した'}${mana}`);
    }
  });
}

// 進化：バトルゾーンの自分のクリーチャーを選んで、その上に重ねる
function chooseEvolutionBase(iid) {
  const bases = game.zones.battlefield.filter((i) => game.cards[i].isCreature);
  if (!bases.length) return showToast('進化元にする自分のクリーチャーがいません');
  showMenu(bases.map((b) => [`${game.cards[b].name}の上に進化`, () => evolve(iid, b)]), lastPointer.x, lastPointer.y, game.cards[iid]);
}

function evolve(iid, baseIid) {
  const c = game.cards[iid];
  const base = game.cards[baseIid];
  const paid = confirmPay(c);
  if (!paid) return;
  act(() => {
    tapMana(paid.pay);
    game.zones.hand = game.zones.hand.filter((x) => x !== iid);
    // 進化元のいた場所に置く
    const bf = game.zones.battlefield;
    bf[bf.indexOf(baseIid)] = iid;
    game.zones.under.push(baseIid);
    c.under = [...(base.under ?? []), baseIid];
    base.under = [];
    base.attacking = false;
    c.tapped = false;
    c.enteredTurn = game.turn;
    Sound.play('evolve');
    log(`${c.name}を${base.name}の上に進化${paid.pay.length ? `（マナ${paid.pay.length}）` : ''}`);
  });
}

// マナチャージ（1ターンに1枚まで。超える場合は確認）
function chargeMana(iid) {
  if (!canPlay()) return;
  const fromHand = zoneOf(iid) === 'hand';
  if (fromHand && myTurn() && game.charged >= CHARGES_PER_TURN
    && !confirm(`このターンはすでに${game.charged}枚マナチャージしています。それでもチャージしますか？`)) return;
  act(() => {
    moveCard(iid, 'mana');
    if (fromHand && myTurn()) {
      game.charged++;
      // マナチャージ・ステップでチャージしたら、そのままメイン・ステップへ
      if (game.phase === 'charge') game.phase = 'main';
    }
  });
}

// 手からのマナはチャージとして数える
function moveByUser(iid, to, opts) {
  if (!canPlay()) return;
  if (to === 'mana' && zoneOf(iid) === 'hand') return chargeMana(iid);
  act(() => moveCard(iid, to, opts));
}

// ---------- シールド・S・トリガー ----------

// シールドを手札に加える（S・トリガーがあれば使うか選ぶ）
function breakShield(iid) {
  if (zoneOf(iid) !== 'shields') return;
  const c = game.cards[iid];
  moveCard(iid, 'hand', { silent: true });
  log(`シールドをブレイク：${c.name}を手札へ${c.ab.sTrigger ? '（S・トリガー）' : ''}`);
  if (c.ab.sTrigger) game.triggers.push(iid);
}

function breakShields(n) {
  Sound.play('break');
  for (let k = 0; k < n && game.zones.shields.length; k++) breakShield(game.zones.shields.at(-1));
}

function useTrigger(iid) {
  act(() => {
    game.triggers = game.triggers.filter((x) => x !== iid);
    const c = game.cards[iid];
    if (zoneOf(iid) !== 'hand') return;
    Sound.play('trigger');
    if (c.isSpell) {
      moveCard(iid, 'graveyard', { silent: true });
      log(`S・トリガーで${c.name}を唱えた（効果は手で処理）`);
    } else {
      moveCard(iid, 'battlefield', { silent: true });
      log(`S・トリガーで${c.name}を${c.isCreature ? '召喚' : '出した'}`);
    }
  });
}

function skipTrigger(iid) {
  act(() => {
    game.triggers = game.triggers.filter((x) => x !== iid);
    log(`${game.cards[iid].name}のS・トリガーを使わない`);
  });
}

// ---------- 攻撃 ----------

const oppBattlefield = () => opp?.state?.battlefield ?? [];
const canAttackNow = (c) => myTurn() && ['main', 'attack'].includes(game.phase) && !game.attack
  && c.isCreature && !c.tapped && !isSick(c) && !c.ab.cannotAttack && zoneOf(c.iid) === 'battlefield';
const canAnyAttack = () => game.zones.battlefield.some((i) => canAttackNow(game.cards[i]));

function onBattlefieldClick(iid) {
  const c = game.cards[iid];
  if (myTurn() && ['main', 'attack'].includes(game.phase) && c.isCreature && !c.tapped && isSick(c)) {
    return showToast(`${c.name}はこのターンに出たので攻撃できません（召喚酔い）`);
  }
  if (canAttackNow(c)) return openAttackMenu(iid);
  toggleTap(iid);
}

// 攻撃先：プレイヤー、または相手のタップしているクリーチャー
function attackTargets(c) {
  const items = [];
  if (!c.ab.cannotAttackPlayer) items.push(['プレイヤーを攻撃', 'player']);
  if (online()) {
    for (const o of oppBattlefield()) {
      if (o.tapped && o.isCreature) items.push([`${o.name}（パワー${o.power ?? 0}）を攻撃`, o.iid]);
    }
  }
  return items;
}

function openAttackMenu(iid) {
  const c = game.cards[iid];
  const targets = attackTargets(c);
  if (!targets.length) return showToast(`${c.name}が攻撃できる相手がいません`);
  // 攻撃先がプレイヤーだけなら、そのまま攻撃する（スマホは確認のためメニューを出す）
  if (targets.length === 1 && !phone()) return declareAttack(iid, targets[0][1]);
  showMenu([
    ...targets.map(([label, target]) => [label, () => declareAttack(iid, target)]),
    '-',
    ['タップだけする', () => toggleTap(iid)],
  ], lastPointer.x, lastPointer.y, c);
}

function declareAttack(iid, target) {
  const c = game.cards[iid];
  if (!canAttackNow(c)) return;
  const id = Math.random().toString(36).slice(2);
  const targetName = target === 'player' ? 'プレイヤー' : oppBattlefield().find((o) => o.iid === target)?.name ?? 'クリーチャー';
  act(() => {
    if (game.phase !== 'attack') {
      Sound.play('phase');
      game.phase = 'attack';
    }
    c.tapped = true;
    c.attacking = true;
    Sound.play('attack');
    log(`${c.name}（パワー${attackPower(c)}）で${targetName}を攻撃`);
    game.attack = { id, attacker: iid, target };
  });
  if (online() && Net.connected()) {
    // 攻撃クリーチャーの状態が先に相手へ届くよう、今の状態をすぐ送る
    Net.send({ type: 'state', state: snapshot() });
    Net.send({ type: 'attack', id, attacker: iid, target, matchId: game.matchId });
  } else {
    resolveAttack(null);
  }
}

function cancelAttack() {
  const a = game?.attack;
  if (!a) return;
  Net.send({ type: 'attackCancel', id: a.id });
  act(() => {
    const c = game.cards[a.attacker];
    c.attacking = false;
    c.tapped = false;
    game.attack = null;
    log(`${c.name}の攻撃を取り消し`);
  });
}

// 相手の返事（ブロックしたクリーチャー、なければ null）から、バトル・ブレイクを決める
function resolveAttack(blockerIid) {
  const a = game.attack;
  if (!a) return;
  const atk = game.cards[a.attacker];
  const defIid = blockerIid ?? (a.target !== 'player' ? a.target : null);
  const def = defIid != null ? oppBattlefield().find((o) => o.iid === defIid) : null;
  const msg = { type: 'combat', id: a.id, matchId: game.matchId, dead: [], breaks: 0, direct: false };
  act(() => {
    game.attack = null;
    if (zoneOf(a.attacker) !== 'battlefield') return;
    atk.attacking = false;
    const atkP = attackPower(atk);
    if (def) {
      // バトル：パワーの大きいほうが勝ち、同じなら両方破壊。スレイヤーは負けても相手を破壊する
      const defP = Number(def.power) || 0;
      const atkDies = defP >= atkP || !!def.ab?.slayer;
      const defDies = atkP >= defP || !!atk.ab.slayer;
      log(`バトル${blockerIid != null ? '（ブロック）' : ''}：${atk.name}（${atkP}）対 ${def.name}（${defP}）`);
      if (defDies) {
        msg.dead.push(def.iid);
        log(`${def.name}を破壊`);
        Sound.play('destroy');
      }
      if (atkDies) moveCard(atk.iid, 'graveyard');
    } else if (online()) {
      const shields = opp?.state?.shields ?? 0;
      if (!shields) {
        msg.direct = true;
        log(`${atk.name}でダイレクトアタック！`);
      } else {
        msg.breaks = Math.min(atk.ab.breaker, shields);
        log(`${atk.name}がシールドを${msg.breaks}枚ブレイク`);
      }
    } else if (game.oppShields > 0) {
      const n = Math.min(atk.ab.breaker, game.oppShields);
      game.oppShields -= n;
      Sound.play('break');
      log(`シールドを${n}枚ブレイク（相手のシールド残り${game.oppShields}枚）`);
    } else {
      Sound.play('win');
      log(`${atk.name}でダイレクトアタック！（一人回し：とどめ）`);
      showToast('ダイレクトアタック！ とどめを刺しました');
    }
    if (online()) clearHistoryAfterAct = true; // 相手に結果を送った後は元に戻せない
  });
  if (online()) Net.send(msg);
}

// ---------- 攻撃を受ける側（ネット対戦） ----------

// ブロックできるクリーチャー：アンタップのブロッカー（攻撃クリーチャーが「ブロックされない」なら無し）
function blockers(attacker) {
  if (attacker?.ab?.unblockable) return [];
  return game.zones.battlefield.map((i) => game.cards[i]).filter((c) => c.isCreature && c.ab.blocker && !c.tapped);
}

function receiveAttack(msg) {
  if (msg.matchId && game.matchId && msg.matchId !== game.matchId) return;
  incomingAttack = { id: msg.id, attacker: msg.attacker, target: msg.target };
  Sound.play('attacked');
  render();
}

function respondAttack(blockerIid) {
  const a = incomingAttack;
  if (!a) return;
  incomingAttack = null;
  if (blockerIid != null) {
    act(() => {
      const b = game.cards[blockerIid];
      b.tapped = true;
      Sound.play('block');
      log(`${b.name}でブロック`);
    });
    Net.send({ type: 'state', state: snapshot() });
  } else {
    render();
  }
  Net.send({ type: 'attackReply', id: a.id, blocker: blockerIid });
}

// 攻撃の結果を受け取る（自分のクリーチャーの破壊・シールドのブレイク・ダイレクトアタック）
function receiveCombat(msg) {
  if (msg.matchId && game.matchId && msg.matchId !== game.matchId) return;
  incomingAttack = null;
  netUpdate(() => {
    for (const iid of msg.dead ?? []) {
      if (zoneOf(iid) === 'battlefield') moveCard(iid, 'graveyard');
    }
    if (msg.breaks) breakShields(msg.breaks);
    if (msg.direct) {
      log(`${oppName()}のダイレクトアタック`);
      lose('direct');
    }
  });
}

function toggleTap(iid) {
  act(() => {
    const c = game.cards[iid];
    c.tapped = !c.tapped;
    Sound.play(c.tapped ? 'tap' : 'untap');
    log(`${c.name}を${c.tapped ? 'タップ' : 'アンタップ'}`);
  });
}

function concede() {
  if (!game || game.result || !confirm('投了しますか？')) return;
  act(() => lose('concede'));
}

// 表示する勝敗 { win, text }。自分の負けを優先し、ネット対戦では相手の負け＝自分の勝ち
function currentResult() {
  if (game?.result) return { win: false, text: LOSE_TEXT[game.result.reason] };
  const o = online() && game && opp?.state?.result;
  if (o) return { win: true, text: WIN_TEXT[o.reason] ?? '' };
  return null;
}

function showResultIfNew() {
  const r = currentResult();
  const key = r ? `${r.win}:${r.text}` : null;
  if (key === shownResult) return;
  shownResult = key;
  const dlg = $('result');
  if (!r) {
    if (dlg.open) dlg.close();
    return;
  }
  Sound.play(r.win ? 'win' : 'lose');
  $('result-title').textContent = r.win ? '勝利' : '敗北';
  $('result-text').textContent = r.text;
  dlg.dataset.win = String(r.win);
  if (!dlg.open) dlg.showModal();
}

function askNumber(message, initial = '1') {
  const v = prompt(message, initial);
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ---------- フェイズの進行 ----------

// スマホ：フェイズの一覧を画面下のシートで出して、押したフェイズまで進める
function openPhaseMenu() {
  if (!myTurn()) return;
  const i = PHASES.findIndex(([id]) => id === game.phase);
  const items = [];
  PHASES.forEach(([id, name], j) => {
    if (j <= i && online()) return;
    items.push([`${j === i ? '▶ ' : ''}${name}${j === i ? '（今）' : j < i ? '（次のターン）' : ''}`, () => { if (j !== i) goToPhase(id); }]);
  });
  showMenu(items, 0, 0);
}

function goToPhase(target) {
  if (!myTurn() || game.attack) return;
  if (target === 'start') target = 'draw';
  // 対戦中は今より前のフェイズには進めない（ターンの終わりを越えると相手にターンが渡るため）
  const index = (id) => PHASES.findIndex(([p]) => p === id);
  if (online() && index(target) <= index(game.phase)) return;
  if (target === 'end') return endTurn();
  act(() => {
    let guard = 0;
    do stepPhase(); while (game.phase !== target && ++guard < PHASES.length * 2);
  });
}

// 「次へ」のボタンが今のフェイズで行うこと。メインで攻撃できるクリーチャーがいなければ「ターン終了」だけ
function nextStop() {
  switch (game.phase) {
    case 'start':
    case 'draw': return { label: 'マナチャージへ', to: 'charge' };
    case 'charge': return { label: 'メインへ', to: 'main' };
    case 'main': return canAnyAttack() ? { label: '攻撃へ', to: 'attack' } : null;
    default: return null;
  }
}

function nextPhase() {
  if (!myTurn()) return;
  const stop = nextStop();
  if (stop) goToPhase(stop.to);
  else endTurn();
}

function endTurn() {
  if (!myTurn() || game.attack) return;
  act(() => {
    game.phase = 'end';
    clearAttackers();
    finishTurn();
  });
}

// ---------- 描画 ----------

function render() {
  saveGame();
  if (!game) return;
  $('deck-name').textContent = game.deckName;
  $('turn-label').textContent = game.turn ? `ターン ${game.turn}` : '開始前';
  $('phase-hint').textContent = game.waiting ? '相手プレイヤーのターンです。' : PHASE_HINTS[game.phase] ?? '';
  const mana = game.zones.mana.length;
  $('mana-count').textContent = started() ? `マナ ${untappedMana().length}/${mana}` : '';
  $('mana-count').classList.toggle('over', myTurn() && game.charged > CHARGES_PER_TURN);

  $('phases').replaceChildren(...PHASES.map(([id, name]) => {
    const b = document.createElement('button');
    b.textContent = name;
    b.dataset.phase = id;
    b.className = id === game.phase ? 'current' : '';
    b.disabled = !myTurn() || !!game.attack;
    b.addEventListener('click', () => goToPhase(id));
    return b;
  }));
  const canAdvance = myTurn() && !game.attack;
  for (const id of ['next-phase', 'end-turn']) $(id).disabled = !canAdvance;
  const stop = myTurn() ? nextStop() : null;
  $('next-phase').textContent = stop?.label ?? '次へ';
  $('next-phase').hidden = myTurn() && !stop;
  $('phase-current').textContent = `${phaseName(game.phase) || '—'} ▼`;
  $('phase-current').dataset.phase = game.phase;
  $('phase-current').disabled = !canAdvance;
  for (const id of ['draw', 'shuffle', 'look-top', 'search-library', 'add-shield', 'untap-all']) $(id).disabled = !canPlay();
  $('undo').disabled = !history.length;

  renderBanner();
  renderBattlefield();
  fillZone('hand', game.zones.hand, 'hand');
  // 一人回し：相手のシールドの残り
  $('dealt-count').textContent = !online() && started() ? `相手シールド ${game.oppShields}` : '';
  $('hand-count').textContent = `(${game.zones.hand.length})`;
  $('shield-count').textContent = game.zones.shields.length;
  for (const z of ['library', 'graveyard']) $(`${z}-count`).textContent = game.zones[z].length;

  renderLog();
  renderOpp();
  if (viewer) renderViewer();
  showResultIfNew();
  scheduleSync();
}

function renderBattlefield() {
  fillZone('bf-main', game.zones.battlefield, 'battlefield');
  fillZone('bf-shields', game.zones.shields, 'shields');
  fillZone('bf-mana', game.zones.mana, 'mana');
}

// 自分のログ・相手のログ・チャットを時刻順にまとめて表示
function renderLog() {
  const entries = (game?.log ?? []).map((e) => ({ ...e, who: 'me' }));
  if (online()) {
    entries.push(...(opp?.state?.log ?? []).map((e) => ({ ...e, who: 'opp' })), ...chat);
    entries.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
  }
  const el = $('log');
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
  el.replaceChildren(...entries.slice(-400).map((e) => {
    const li = document.createElement('li');
    li.className = e.who;
    if (e.text !== undefined && (e.who === 'me' || e.who === 'opp') && e.turn !== undefined) {
      const t = document.createElement('span');
      t.className = 't';
      t.textContent = e.turn ? `T${e.turn}` : '—';
      li.append(t);
      if (e.who === 'opp') {
        const n = document.createElement('span');
        n.className = 'who';
        n.textContent = `${oppName()}：`;
        li.append(n);
      }
      li.append(e.text);
    } else if (e.who === 'system') {
      li.className = 'system';
      li.textContent = e.text;
    } else {
      li.className = `chat-line ${e.who}`;
      const n = document.createElement('span');
      n.className = 'who';
      n.textContent = `${e.name}：`;
      li.append(n, e.text);
    }
    return li;
  }));
  if (atBottom || entries.at(-1)?.who === 'me') el.scrollTop = el.scrollHeight;
  markUnread(entries.filter((e) => e.who !== 'me').length);
}

// スマホ：ログを閉じている間に相手の行動・チャットが届いたら、ボタンに印を付ける
let seenOthers = null;
function markUnread(others) {
  const btn = $('sheet-log-btn');
  if (!btn) return;
  if (seenOthers === null || document.body.dataset.sheet === 'log' || !phone()) seenOthers = others;
  btn.classList.toggle('unread', others > seenOthers);
}

// 戦場の上の案内：S・トリガー → 攻撃を受けた → 自分の攻撃の返事待ち → 相手のターン
function renderBanner() {
  const bar = $('banner');
  const span = (text, className = '') => Object.assign(document.createElement('span'), { textContent: text, className });
  const button = (text, fn, primary = false) => {
    const b = Object.assign(document.createElement('button'), { textContent: text, className: primary ? 'primary' : '' });
    b.addEventListener('click', fn);
    return b;
  };
  bar.hidden = false;
  const trigger = game.triggers?.find((iid) => zoneOf(iid) === 'hand');
  if (trigger != null) {
    const c = game.cards[trigger];
    bar.replaceChildren(
      span(`S・トリガー：${c.name}（${c.isSpell ? '呪文' : c.type}）を使いますか？`, 'banner-title'),
      button('使う', () => useTrigger(trigger), true),
      button('使わない', () => skipTrigger(trigger)),
    );
    return;
  }
  if (incomingAttack) {
    const a = oppBattlefield().find((o) => o.iid === incomingAttack.attacker);
    const target = incomingAttack.target === 'player' ? 'あなた' : `あなたの${game.cards[incomingAttack.target]?.name ?? 'クリーチャー'}`;
    const list = blockers(a);
    bar.replaceChildren(
      span(`${oppName()}の${a?.name ?? 'クリーチャー'}（パワー${a ? attackPower(a) : '?'}）が${target}を攻撃`, 'banner-title'),
      ...(a?.ab?.unblockable ? [span('（ブロックされない）')] : []),
      ...list.map((b) => button(`${b.name}（${b.power ?? 0}）でブロック`, () => respondAttack(b.iid))),
      button('ブロックしない', () => respondAttack(null), true),
    );
    return;
  }
  if (game.attack) {
    bar.replaceChildren(
      span('相手の対応（ブロック）を待っています'),
      button('ブロックなしで進める', () => resolveAttack(null)),
      button('攻撃を取り消す', cancelAttack),
    );
    return;
  }
  if (online() && (game.waiting || game.phase === 'ready')) {
    const label = !game.orderFixed
      ? '相手の接続を待っています（先攻・後攻は部屋を作った人が決めます）'
      : game.waiting ? '相手プレイヤーのターンです' : '相手を待っています';
    const force = button('自分のターンを始める', () => {
      if (confirm('相手のターンを待たずに、自分のターンを始めますか？')) forceMyTurn();
    });
    force.title = '通信が止まったときなどに使います';
    bar.replaceChildren(span(label), ...(game.orderFixed ? [force] : []));
    return;
  }
  bar.hidden = true;
}

function fillZone(elId, ids, zone) {
  $(elId).replaceChildren(...ids.map((iid) => cardEl(iid, zone)));
}

function cardEl(iid, zone) {
  const c = game.cards[iid];
  const el = document.createElement('div');
  el.className = 'card' + (c.tapped ? ' tapped' : '') + (c.attacking ? ' attacking' : '');
  el.draggable = !phone() && canPlay();
  el.addEventListener('pointerdown', (e) => { lastPointer = { x: e.clientX, y: e.clientY }; });
  el.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', String(iid)));

  // シールドは裏向き（クリックでメニュー：ブレイク・見る・移動）
  if (zone === 'shields') {
    el.classList.add('shield');
    el.append(Object.assign(document.createElement('div'), { className: 'dm-back' }));
    el.title = 'シールド：クリックでメニュー';
    el.addEventListener('click', (e) => openCardMenu(iid, e.clientX, e.clientY));
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!phone()) openCardMenu(iid, e.clientX, e.clientY);
    });
    if (phone() && canPlay()) onHoldDrag(el, iid, () => openCardMenu(iid, 0, 0));
    return el;
  }

  fillCardFace(el, c);
  if (zone === 'mana') el.classList.add('mana-card');
  if (zone === 'battlefield') {
    addBadges(el, c);
    if (myTurn() && isSick(c)) el.classList.add('sick');
    if (canAttackNow(c)) el.classList.add('can-attack');
  }

  if (zone === 'hand' && !canPlay()) {
    el.addEventListener('click', () => { if (phone()) showCardDetail(detailOf(c)); });
  } else if (zone === 'hand') {
    el.addEventListener('dblclick', () => playFromHand(iid));
    el.addEventListener('click', (e) => { if (phone()) openCardMenu(iid, e.clientX, e.clientY); });
  } else if (zone === 'battlefield') {
    el.addEventListener('click', () => onBattlefieldClick(iid));
  } else if (zone === 'mana') {
    el.addEventListener('click', () => { if (canPlay()) toggleTap(iid); });
  } else {
    el.addEventListener('click', (e) => openCardMenu(iid, e.clientX, e.clientY));
  }
  el.addEventListener('mouseenter', () => showPreview(c));
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!phone()) openCardMenu(iid, e.clientX, e.clientY);
  });
  // スマホ：長押しで拡大表示（そこから操作のメニューも開ける）。長押しのまま指を動かすと移動
  const detail = () => showCardDetail(detailOf(c), canPlay() ? [['操作メニュー', () => openCardMenu(iid, 0, 0)]] : []);
  if (phone() && canPlay() && !zone.endsWith('-viewer')) onHoldDrag(el, iid, detail);
  else onLongPress(el, detail);
  return el;
}

// スマホ：長押ししてそのまま指を動かすと、カードを持ち上げて離した場所の領域（data-zone）へ移す。
// 動かさずに離したら onHold（拡大表示・メニュー）。長押しする前に指を動かしたら、ふつうのスクロール
function onHoldDrag(el, iid, onHold) {
  const HOLD_MS = 380;
  let timer = null;
  let start = null;
  let held = false;
  let ghost = null;
  let target = null;
  const reset = () => {
    clearTimeout(timer);
    timer = null;
    held = false;
    ghost?.remove();
    ghost = null;
    target?.classList.remove('drop-target');
    target = null;
    el.classList.remove('lifted');
  };
  el.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return reset();
    start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    timer = setTimeout(() => {
      timer = null;
      held = true;
      el.classList.add('lifted');
      navigator.vibrate?.(15);
    }, HOLD_MS);
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    if (timer) {
      if (Math.hypot(t.clientX - start.x, t.clientY - start.y) > 10) reset();
      return;
    }
    if (!held) return;
    // 持ち上げている間は画面をスクロールさせない
    e.preventDefault();
    if (!ghost) {
      const r = el.getBoundingClientRect();
      ghost = el.cloneNode(true);
      ghost.classList.add('drag-ghost');
      ghost.style.width = `${r.width}px`;
      ghost.style.height = `${r.height}px`;
      document.body.append(ghost);
    }
    ghost.style.left = `${t.clientX - ghost.offsetWidth / 2}px`;
    ghost.style.top = `${t.clientY - ghost.offsetHeight * 0.8}px`;
    const under = document.elementFromPoint(t.clientX, t.clientY)?.closest('[data-zone]') ?? null;
    if (under !== target) {
      target?.classList.remove('drop-target');
      target = under;
      target?.classList.add('drop-target');
    }
  }, { passive: false });
  el.addEventListener('touchend', (e) => {
    if (!held) return reset();
    // 長押しのあとの click（タップの操作）は起こさない
    e.preventDefault();
    const zone = ghost ? target?.dataset.zone : null;
    const dragged = !!ghost;
    reset();
    if (!dragged) onHold();
    else if (zone) dropCard(iid, zone);
  });
  el.addEventListener('touchcancel', reset);
}

// カードの絵（画像がなければ文字のカード）
function fillCardFace(el, c) {
  el.title = `${c.name}\n${DM.detailText(c)}`;
  el.append(DM.cardFace(c));
}

// バトルゾーンのカードの印：攻撃中・進化元の枚数
function addBadges(el, c) {
  const badge = (className, text) => el.append(Object.assign(document.createElement('span'), { className, textContent: text }));
  if (c.attacking) badge('atk', '攻撃');
  const under = Array.isArray(c.under) ? c.under.length : c.under || 0;
  if (under) badge('under', `進化元${under}`);
}

function showPreview(c) {
  $('preview').replaceChildren(DM.cardFace(c), Object.assign(document.createElement('p'), { className: 'preview-text', textContent: DM.detailText(c) }));
}

// ---------- 相手の表示（ネット対戦） ----------

function oppCardEl(c) {
  const el = document.createElement('div');
  el.className = 'card' + (c.tapped ? ' tapped' : '') + (c.attacking ? ' attacking' : '');
  fillCardFace(el, c);
  addBadges(el, c);
  if (incomingAttack?.attacker === c.iid) el.classList.add('incoming');
  el.addEventListener('mouseenter', () => showPreview(c));
  el.addEventListener('click', () => { if (phone()) showCardDetail(detailOf(c)); });
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  onLongPress(el, () => showCardDetail(detailOf(c)));
  return el;
}

const phaseName = (id) => PHASES.find(([p]) => p === id)?.[1] ?? PHASE_NAMES[id] ?? '';

function renderOpp() {
  const on = online();
  document.body.classList.toggle('online', on);
  for (const id of ['opp-area', 'opp-player', 'chat-form']) $(id).hidden = !on;
  if (!on) return;
  const st = opp?.state;
  $('opp-player-name').textContent = oppName();
  $('my-player-name').textContent = myName();
  $('opp-shield-count').textContent = st ? st.shields : '–';
  const count = (z) => (Array.isArray(st[z]) ? st[z].length : st[z]);
  for (const z of ['library', 'hand', 'graveyard']) $(`opp-${z}-count`).textContent = st ? count(z) : '–';
  $('opp-main').replaceChildren(...(st?.battlefield ?? []).map(oppCardEl));
  $('opp-mana').replaceChildren(...(st?.mana ?? []).map((c) => {
    const el = oppCardEl(c);
    el.classList.add('mana-card');
    return el;
  }));
  $('opp-shields').replaceChildren(...Array.from({ length: st?.shields ?? 0 }, () => {
    const el = document.createElement('div');
    el.className = 'card shield';
    el.append(Object.assign(document.createElement('div'), { className: 'dm-back' }));
    return el;
  }));
  let label;
  if (!opp?.connected) label = st ? `${oppName()}（切断中）` : '相手の参加を待っています';
  else if (!st) label = `${oppName()}：デッキを選んでいます`;
  else if (!st.turn) label = `${oppName()}：${phaseName(st.phase) || '準備中'}`;
  else label = `${oppName()}：ターン${st.turn}${st.waiting ? '（待機中）' : `・${phaseName(st.phase)}`}`;
  $('opp-status').textContent = label;
  $('opp-area').classList.toggle('active-turn', !!st && st.turn > 0 && !st.waiting);
  const waitingGuest = Net.role === 'host' && !opp?.connected;
  $('room-banner').hidden = !waitingGuest;
  if (waitingGuest) $('room-code-big').textContent = Net.code;
}

// 自分の公開情報（手札・シールドの中身、山札の順番は含めない）
function snapshot() {
  if (!game) return null;
  const pub = (iid) => {
    const c = game.cards[iid];
    return {
      iid, name: c.name, image: c.image, civs: c.civs, cost: c.cost, power: c.power, type: c.type, race: c.race, text: c.text,
      ab: c.ab, isCreature: c.isCreature, isSpell: c.isSpell, tapped: !!c.tapped, attacking: !!c.attacking, under: c.under?.length || 0,
    };
  };
  return {
    deckName: game.deckName,
    turn: game.turn,
    phase: game.phase,
    waiting: !!game.waiting,
    hand: game.zones.hand.length,
    library: game.zones.library.length,
    shields: game.zones.shields.length,
    battlefield: game.zones.battlefield.map(pub),
    mana: game.zones.mana.map(pub),
    graveyard: game.zones.graveyard.map(pub),
    log: game.log.slice(-150),
    result: game.result ?? null,
  };
}

let syncTimer = null;
function scheduleSync() {
  if (!Net.connected()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => Net.send({ type: 'state', state: snapshot() }), 60);
}

function sendHello() {
  Net.send({
    type: 'hello',
    name: myName(),
    avatar: myAvatar(),
    // 先攻・後攻は部屋を作った側が決める（ゲーム開始前なら null）
    hostOnDraw: Net.role === 'host' && game ? !!game.onDraw : null,
    matchId: Net.role === 'host' ? game?.matchId ?? null : null,
    needOrder: Net.role === 'guest' && !!game && !game.orderFixed,
  });
}

function systemMessage(text) {
  chat.push({ ts: Date.now(), who: 'system', text });
  saveJson(sessionStorage, CHAT_KEY, chat.slice(-200));
}

function setupNet() {
  Net.on('status', ({ text, state }) => {
    $('net-status').textContent = text;
    $('net-status').dataset.state = state;
  });
  Net.on('open', () => {
    opp = { ...opp, connected: true };
    sendHello();
    if (game) {
      Net.send({ type: 'state', state: snapshot() });
      if (game.waiting && game.turn > 0 && !game.passSent) game.passSent = Net.send({ type: 'pass', matchId: game.matchId });
    }
    if (game) render(); else renderOpp();
  });
  Net.on('close', () => {
    opp = { ...opp, connected: false };
    systemMessage(`${oppName()}との接続が切れました`);
    if (game) render(); else renderOpp();
  });
  Net.on('hello', (msg) => {
    const first = !opp?.name;
    opp = { ...opp, name: String(msg.name || '相手').slice(0, 16), avatar: validAvatar(msg.avatar), connected: true };
    renderAvatars();
    if (first) systemMessage(`${oppName()}が参加しました`);
    if (Net.role === 'host' && msg.needOrder) sendHello();
    if (Net.role === 'guest' && msg.hostOnDraw !== null && msg.hostOnDraw !== undefined) {
      pendingHost = { onDraw: !!msg.hostOnDraw, matchId: msg.matchId ?? null };
      // 1ターン目が始まる前なら、部屋を作った側が始め直したゲームにも合わせる
      if (game && game.turn === 0 && isNewHostGame(pendingHost)) {
        netUpdate(() => {
          adoptHostOrder(pendingHost);
          log(`先攻・後攻が決まりました：あなたは${game.onDraw ? '後攻' : '先攻'}`);
          tryFirstTurn();
        });
        return;
      }
    }
    if (game) render(); else renderOpp();
  });
  Net.on('state', (msg) => {
    opp = { ...opp, state: msg.state, connected: true };
    if (game) {
      renderBattlefield();
      renderBanner();
    }
    renderOpp();
    showResultIfNew();
    renderLog();
    if (viewer?.opp) renderViewer();
  });
  Net.on('pass', (msg) => { if (game) receivePass(msg); });
  Net.on('attack', (msg) => { if (game) receiveAttack(msg); });
  Net.on('attackReply', (msg) => { if (game?.attack?.id === msg.id) resolveAttack(msg.blocker ?? null); });
  Net.on('attackCancel', (msg) => {
    if (incomingAttack?.id !== msg.id) return;
    incomingAttack = null;
    if (game) render();
  });
  Net.on('combat', (msg) => { if (game) receiveCombat(msg); });
  Net.on('chat', (msg) => {
    chat.push({ ts: Date.now(), who: 'opp', name: oppName(), text: String(msg.text).slice(0, 300) });
    saveJson(sessionStorage, CHAT_KEY, chat.slice(-200));
    renderLog();
  });
}

// 部屋コードを共有（共有できなければコピー）
async function shareRoomCode() {
  const code = Net.code;
  const text = `デュエマ System の部屋コード：${code}`;
  if (navigator.share) {
    try { await navigator.share({ text }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  try {
    await navigator.clipboard.writeText(code);
    $('room-share').textContent = 'コピーしました';
  } catch {
    $('room-share').textContent = '長押しでコピー';
  }
  setTimeout(() => ($('room-share').textContent = '共有・コピー'), 1500);
}

function sendChat(e) {
  e.preventDefault();
  const text = $('chat-input').value.trim();
  if (!text) return;
  chat.push({ ts: Date.now(), who: 'me', name: myName(), text });
  saveJson(sessionStorage, CHAT_KEY, chat.slice(-200));
  Net.send({ type: 'chat', text });
  $('chat-input').value = '';
  renderLog();
}

// ---------- メニュー ----------

function showMenu(items, x, y, card = null) {
  const menu = $('menu');
  // モーダルダイアログ表示中は最前面レイヤーに入れないと隠れる
  (viewer ? $('viewer') : document.body).append(menu);
  if (phone()) items = [...items, ...(items.length ? ['-'] : []), ['閉じる', () => {}]];
  menu.replaceChildren(...items.map((item) => {
    if (item === '-') return document.createElement('hr');
    const [label, fn] = item;
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', () => {
      hideMenu();
      fn();
    });
    return b;
  }));
  if (phone() && card) {
    const pv = DM.cardFace(card);
    pv.classList.add('menu-preview');
    menu.prepend(pv);
  }
  menu.hidden = false;
  const { width, height } = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(x, innerWidth - width - 8))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, innerHeight - height - 8))}px`;
}

function hideMenu() {
  $('menu').hidden = true;
}

function openCardMenu(iid, x, y) {
  if (!canPlay()) return;
  const c = game.cards[iid];
  const zone = zoneOf(iid);
  const items = [];
  if (zone === 'hand') {
    items.push(
      [c.isSpell ? '唱える（マナを支払う）' : c.ab.evolution ? '進化する…' : '召喚する（マナを支払う）', () => playFromHand(iid)],
      ['マナゾーンへ（チャージ）', () => chargeMana(iid)],
      '-',
    );
  } else if (zone === 'battlefield') {
    if (canAttackNow(c)) items.push(['攻撃する…', () => openAttackMenu(iid)]);
    items.push([c.tapped ? 'アンタップ' : 'タップ', () => toggleTap(iid)], '-');
  } else if (zone === 'mana') {
    items.push([c.tapped ? 'アンタップ' : 'タップ', () => toggleTap(iid)], '-');
  } else if (zone === 'shields') {
    items.push(
      ['ブレイク（手札へ・S・トリガーを確認）', () => act(() => { Sound.play('break'); breakShield(iid); })],
      ['中を見る', () => showCardDetail(detailOf(c))],
      '-',
    );
  }
  const moves = [['hand', '手札へ'], ['battlefield', 'バトルゾーンへ'], ['mana', 'マナゾーンへ'], ['shields', 'シールドへ'], ['graveyard', '墓地へ']];
  for (const [to, label] of moves) {
    if (to !== zone && !(zone === 'hand' && to === 'mana')) items.push([label, () => moveByUser(iid, to)]);
  }
  items.push(
    ['山札の一番上へ', () => act(() => moveCard(iid, 'library'))],
    ['山札の一番下へ', () => act(() => moveCard(iid, 'library', { bottom: true }))],
  );
  showMenu(items, x, y, zone === 'shields' ? null : c);
}

function openLibraryMenu(x, y) {
  if (!canPlay()) return;
  showMenu([
    ['1枚引く', drawOne],
    ['X枚引く…', () => {
      const n = askNumber('何枚引きますか？');
      if (n) act(() => drawCards(n));
    }],
    ['シャッフル', shuffleLibrary],
    '-',
    ['上からX枚を見る…', lookTop],
    ['山札を探す', searchLibrary],
    '-',
    ['上からX枚をマナゾーンへ…', () => topTo('mana')],
    ['上からX枚を墓地へ…', () => topTo('graveyard')],
    ['上から1枚をシールドに追加', addShield],
  ], x, y);
}

function drawOne() {
  if (canPlay()) act(() => drawCards(1));
}

function shuffleLibrary() {
  if (!canPlay()) return;
  act(() => {
    shuffle(game.zones.library);
    Sound.play('shuffle');
    log('山札をシャッフル');
  });
}

function topTo(zone) {
  if (!canPlay()) return;
  const n = askNumber(`上から何枚を${ZONES[zone]}に置きますか？`);
  if (!n) return;
  act(() => {
    const ids = game.zones.library.slice(0, n);
    for (const iid of ids) moveCard(iid, zone, { silent: true });
    log(`山札の上から${ids.length}枚を${ZONES[zone]}へ：${ids.map((i) => game.cards[i]?.name).join('、')}`);
    checkDeckOut();
  });
}

function addShield() {
  if (!canPlay() || !game.zones.library.length) return;
  act(() => {
    moveCard(game.zones.library[0], 'shields', { silent: true });
    log('山札の上から1枚をシールドに追加');
    checkDeckOut();
  });
}

function lookTop() {
  if (!canPlay()) return;
  const n = askNumber('上から何枚見ますか？', '3');
  if (!n) return;
  const shown = Math.min(n, game.zones.library.length);
  act(() => log(`山札の上から${shown}枚を見た`));
  openViewer('library', `山札の上から${shown}枚（左が一番上）`, game.zones.library.slice(0, n));
}

function searchLibrary() {
  if (!canPlay()) return;
  act(() => log('山札を探した'));
  openViewer('library', '山札（左が一番上）', null);
}

// ---------- 一覧ダイアログ ----------

function openViewer(zone, title, ids) {
  viewer = { zone, title, ids };
  renderViewer();
  if (!$('viewer').open) $('viewer').showModal();
}

function renderViewer() {
  if (viewer.opp) {
    const cards = [...(opp?.state?.[viewer.opp] ?? [])].reverse();
    $('viewer-title').textContent = `${viewer.title}（${cards.length}枚）`;
    $('viewer-shuffle').hidden = true;
    $('viewer-hint').hidden = true;
    $('viewer-cards').replaceChildren(...cards.map(oppCardEl));
    return;
  }
  $('viewer-hint').hidden = false;
  const { zone, title, ids } = viewer;
  const shown = game.zones[zone].filter((iid) => !ids || ids.includes(iid));
  if (zone !== 'library') shown.reverse();
  $('viewer-title').textContent = `${title}（${shown.length}枚）`;
  $('viewer-shuffle').hidden = zone !== 'library';
  $('viewer-cards').replaceChildren(...shown.map((iid) => cardEl(iid, `${zone}-viewer`)));
}

function openOppViewer(zone) {
  if (!opp?.state) return;
  viewer = { opp: zone, title: `${oppName()}の${ZONES[zone]}` };
  renderViewer();
  if (!$('viewer').open) $('viewer').showModal();
}

function closeViewer() {
  viewer = null;
  hideMenu();
  document.body.append($('menu'));
  $('viewer').close();
}

// ---------- 開始画面 ----------

const deckSize = (d) => Object.entries(d.cards).reduce((n, [cid, qty]) => n + (cardData[cid] ? qty : 0), 0);

function openSetup() {
  const select = $('setup-deck');
  select.replaceChildren(...decks.map((d) => new Option(`${d.name}（${deckSize(d)}枚）`, d.id)));
  const requested = Number(new URLSearchParams(location.search).get('deck'));
  select.value = String(requested || game?.deckId || decks[0]?.id || '');
  $('setup-error').textContent = decks.length ? '' : 'デッキがありません。デッキ作成画面で作ってください。';
  renderSetupPlayer();
  const mode = netInfo?.role === 'host' ? 'host' : netInfo?.role === 'guest' ? 'join' : 'solo';
  $('setup-form').elements.mode.value = mode;
  $('room-code').value = netInfo?.role === 'guest' ? netInfo.code : '';
  updateSetupMode();
  $('setup').showModal();
}

function updateSetupMode() {
  const mode = $('setup-form').elements.mode.value;
  $('room-code').disabled = mode !== 'join';
  for (const r of $('setup-form').elements.order) r.disabled = mode === 'join';
  $('order-note').hidden = mode !== 'join';
}

function startFromSetup(e) {
  e.preventDefault();
  const deck = decks.find((d) => d.id === Number($('setup-deck').value));
  // シールド5枚と手札5枚を配るので、11枚以上必要（山札が0枚になると負け）
  if (!deck || deckSize(deck) <= DM.SHIELDS + DM.HAND) {
    $('setup-error').textContent = `デッキに${DM.SHIELDS + DM.HAND + 1}枚以上のカードが必要です。`;
    return;
  }
  const form = new FormData($('setup-form'));
  const mode = form.get('mode');
  const code = String(form.get('room') ?? '').trim().toUpperCase();
  if (mode === 'join' && !/^[A-Z0-9]{4,12}$/.test(code)) {
    $('setup-error').textContent = '部屋コードを入力してください。';
    return;
  }

  // 接続の開始・切り替え（同じ部屋のままなら接続を保つ）
  if (mode === 'solo') {
    Net.stop();
    netInfo = null;
    opp = null;
  } else if (mode === 'host' && !(Net.role === 'host')) {
    Net.stop();
    opp = null;
    chat = [];
    netInfo = { role: 'host', code: Net.host() };
    systemMessage(`部屋 ${netInfo.code} を作りました。この部屋コードを相手に伝えてください`);
  } else if (mode === 'join' && !(Net.role === 'guest' && Net.code === code)) {
    Net.stop();
    opp = null;
    chat = [];
    pendingHost = null;
    earlyPass = null;
    netInfo = { role: 'guest', code: Net.join(code) };
  }
  saveJson(sessionStorage, NET_KEY, netInfo);
  if (mode === 'solo') saveJson(sessionStorage, CHAT_KEY, null);

  // 先攻・後攻：ランダムなら、ここで決める（ネット対戦では部屋を作った側の結果が相手にも伝わる）
  const order = form.get('order');
  const random = order === 'random';
  const onDraw = random ? Math.random() < 0.5 : order === 'draw';
  $('setup').close();
  newGame(deck, onDraw, random && mode !== 'join');
}

// ---------- 初期化 ----------

function setupDropZones() {
  for (const el of document.querySelectorAll('[data-zone]')) {
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.add('drop-target');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      // シールド・マナの列はバトルゾーンの中にあるので、外側に伝えない
      e.stopPropagation();
      el.classList.remove('drop-target');
      dropCard(Number(e.dataTransfer.getData('text/plain')), el.dataset.zone);
    });
  }
}

// ドラッグしたカードを領域に置く（PC のドラッグ、スマホの長押しで移動）
function dropCard(iid, zone) {
  if (!game?.cards[iid] || zoneOf(iid) === zone) return;
  // 手札からバトルゾーンへは召喚（マナを支払う）
  if (zone === 'battlefield' && zoneOf(iid) === 'hand') return playFromHand(iid);
  moveByUser(iid, zone);
}

function init() {
  $('next-phase').addEventListener('click', nextPhase);
  $('end-turn').addEventListener('click', endTurn);
  $('undo').addEventListener('click', undo);
  $('restart').addEventListener('click', openSetup);

  $('pile-library').addEventListener('click', drawOne);
  onContextMenu($('pile-library'), (e) => openLibraryMenu(e.clientX ?? 0, e.clientY ?? 0));
  $('tools').addEventListener('click', (e) => {
    if (phone() && e.target.closest('button')) window.setPhoneSheet?.('');
  });
  window.addEventListener('phonesheet', () => {
    hideMenu();
    renderLog();
  });
  $('pile-graveyard').addEventListener('click', () => openViewer('graveyard', '墓地', null));

  $('draw').addEventListener('click', drawOne);
  $('shuffle').addEventListener('click', shuffleLibrary);
  $('look-top').addEventListener('click', lookTop);
  $('search-library').addEventListener('click', searchLibrary);
  $('add-shield').addEventListener('click', addShield);
  $('untap-all').addEventListener('click', () => { if (canPlay()) act(() => { untapAll(); log('すべてアンタップ'); }); });

  $('viewer-close').addEventListener('click', closeViewer);
  $('viewer-shuffle').addEventListener('click', () => {
    shuffleLibrary();
    closeViewer();
  });
  $('viewer').addEventListener('cancel', (e) => {
    e.preventDefault();
    closeViewer();
  });

  // ゲームがないまま開始画面を閉じると操作できない画面が残るので、閉じさせない
  $('setup').addEventListener('cancel', (e) => { if (!game) e.preventDefault(); });
  $('setup').addEventListener('close', () => { if (!game) $('setup').showModal(); });
  $('setup-form').addEventListener('submit', startFromSetup);
  $('concede').addEventListener('click', concede);
  $('my-avatar').addEventListener('click', Settings.open);
  $('setup-settings').addEventListener('click', Settings.open);
  window.addEventListener('settingschange', onSettingsChange);
  renderAvatars();
  $('result-close').addEventListener('click', () => $('result').close());
  $('result-again').addEventListener('click', () => {
    $('result').close();
    openSetup();
  });
  for (const r of $('setup-form').elements.mode) r.addEventListener('change', updateSetupMode);
  $('chat-form').addEventListener('submit', sendChat);
  $('room-share').addEventListener('click', shareRoomCode);
  $('phase-current').addEventListener('click', openPhaseMenu);
  $('opp-pile-graveyard').addEventListener('click', () => openOppViewer('graveyard'));

  document.addEventListener('pointerdown', (e) => { lastPointer = { x: e.clientX, y: e.clientY }; }, true);
  document.addEventListener('click', (e) => {
    if (!$('menu').contains(e.target) && !e.target.closest('[data-longpress]')) hideMenu();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') return hideMenu();
    if (document.querySelector('dialog[open]') || e.target.matches('input, select, textarea')) return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault();
      undo();
    } else if (e.key === ' ') {
      e.preventDefault();
      nextPhase();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      endTurn();
    } else if ((e.key === 'd' || e.key === 'D') && !e.ctrlKey && !e.metaKey && !e.altKey && started()) {
      drawOne();
    }
  });

  setupDropZones();
  setupNet();

  // 再読み込みしたら同じ部屋に戻る
  if (netInfo?.role === 'host') Net.host(netInfo.code);
  else if (netInfo?.role === 'guest') Net.join(netInfo.code);

  const requested = Number(new URLSearchParams(location.search).get('deck'));
  if (game && (!requested || requested === game.deckId)) render();
  else {
    game = null;
    renderOpp();
    renderLog();
    openSetup();
  }
}

init();
