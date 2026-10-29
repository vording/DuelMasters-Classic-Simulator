// デュエマ System — 一人回し／ネット対戦（カードの効果は effects.js で自動処理。自動にない効果は手で処理）
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
  charge: 'マナチャージ・ステップ。手札を1枚マナゾーンに置けます（ドラッグ、または右クリック →「マナゾーンへ」）。',
  main: 'メイン・ステップ。マナゾーンのカードをクリックしてタップ（支払うマナを選ぶ）→ 手札をダブルクリックで召喚・呪文。クリーチャーをクリックすると攻撃します。',
  attack: '攻撃ステップ。攻撃するクリーチャーをクリックしてください。',
  end: 'ターン終了ステップ。',
};

// 負けた理由 → 表示（自分が負けたとき／相手が負けたとき）
const LOSE_TEXT = { deck: '山札がなくなりました', direct: 'ダイレクトアタックを受けました', concede: '投了しました' };
const WIN_TEXT = { deck: '相手の山札がなくなりました', direct: 'ダイレクトアタックが決まりました', concede: '相手が投了しました' };

const ZONES = { library: '山札', hand: '手札', battlefield: 'バトルゾーン', mana: 'マナゾーン', shields: 'シールド', graveyard: '墓地', under: '進化元', resolving: '処理中' };

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

// 効果で得ている能力（buff：このターンだけ、guard：次の自分のターンまでブロッカー）を足した能力。
// 相手のカード（snapshot）はすでに足してある
// 自分のバトルゾーンのクリーチャーなら、常在型能力（effects.js の staticMods）も足す
const ownOnField = (c) => game?.cards?.[c.iid] === c && c.isCreature && game.zones.battlefield.includes(c.iid);

function abOf(c) {
  const ab = { ...c.ab };
  const b = c.buff ?? {};
  const s = ownOnField(c) ? staticMods(c) : null;
  if (c.guard || s?.blocker) ab.blocker = true;
  const pa = (b.pa || 0) + (s?.pa || 0);
  if (pa) ab.powerAttacker = (ab.powerAttacker || 0) + pa;
  const breaker = Math.max(b.breaker || 1, s?.breaker || 1);
  if (breaker > 1) ab.breaker = Math.max(ab.breaker || 1, breaker);
  if (b.unblockable || s?.unblockable) ab.unblockable = true;
  if (b.attackUntapped) ab.attackUntapped = true;
  if (b.freeAttack) Object.assign(ab, { cannotAttack: false, cannotAttackPlayer: false, speedAttacker: true });
  return ab;
}
const powerOf = (c) => (Number(c.power) || 0) + (c.buff?.power || 0) + (ownOnField(c) ? staticMods(c).power : 0);

// 攻撃するときのパワー（パワーアタッカーを足す）
const attackPower = (c) => powerOf(c) + (abOf(c).powerAttacker || 0);

// 召喚酔い：このターン（自分のターン数で数える）に出たクリーチャーは、スピードアタッカー・進化でなければ攻撃できない
const isSick = (c) => !!c.isCreature && c.enteredTurn != null && c.enteredTurn >= game.turn && !abOf(c).speedAttacker && !c.ab?.evolution;

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
  if (to === 'resolving') return from === 'hand' ? 'spell' : null;
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
    zones: { library: shuffle(library), hand: [], battlefield: [], mana: [], shields: [], graveyard: [], under: [], resolving: [] },
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
  fxQueue.length = 0;
  // ネット対戦は、マッチングするまで手札・シールドを配らず、先攻・後攻も出さない（checkMatch）
  log(online() ? `「${deck.name}」で開始（対戦相手を待っています）` : `「${deck.name}」で開始（${random ? 'ランダムで' : ''}${game.onDraw ? '後攻' : '先攻'}）`);
  game.dealt = false;
  if (!online()) dealHands();
  beginFirstTurn();
  render();
  if (Net.connected()) sendHello();
}

// シールドを5枚置いてから、手札を5枚引く
function dealHands() {
  game.zones.shields = game.zones.library.splice(0, DM.SHIELDS);
  game.zones.hand = game.zones.library.splice(0, DM.HAND);
  game.dealt = true;
  Sound.play('shuffle');
}

// ---------- マッチング（ネット対戦） ----------
// 相手とつながり、同じ対戦（matchId）のゲームを始めたら：
// 「MATCH!」→ 手札・シールドを配る → 先攻・後攻を出す → 1ターン目へ。それまでは盤面を操作できない
let matching = false;
function checkMatch() {
  if (!online() || !game || game.dealt || matching || game.result) return;
  const st = opp?.state;
  if (!game.orderFixed || !opp?.connected || !Net.connected() || !st || !game.matchId || st.matchId !== game.matchId) return;
  matching = true;
  matchIntro().finally(() => { matching = false; });
}

async function matchIntro() {
  const g = game;
  await announce('MATCH!', `${myName()} VS ${oppName()}`);
  if (game !== g) return;
  netUpdate(() => {
    dealHands();
    log(`${oppName()}とマッチングしました：シールド5枚と手札5枚を配りました`);
  });
  await new Promise((resolve) => setTimeout(resolve, 900));
  if (game !== g) return;
  await announce(game.onDraw ? '後攻' : '先攻', game.onDraw ? `${oppName()}が先攻です` : 'あなたが先攻です（1ターン目はドローしません）');
  if (game !== g) return;
  netUpdate(() => {
    log(`あなたは${game.onDraw ? '後攻' : '先攻'}`);
    tryFirstTurn();
  });
}

// 画面いっぱいの文字の演出（cutIn のカードなし版）。終わると resolve
function announce(title, sub) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'cutin order';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<div class="cutin-flash"></div><div class="cutin-band"></div><div class="cutin-inner"><div class="cutin-text"><b class="cutin-title"></b><span class="cutin-name"></span></div></div>';
    el.querySelector('.cutin-title').textContent = title;
    el.querySelector('.cutin-name').textContent = sub;
    document.body.append(el);
    Sound.play('phase');
    setTimeout(resolve, 1250);
    setTimeout(() => el.remove(), 1450);
  });
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
  drainFx();
}

// 相手からのメッセージによる変更（元に戻す対象にしない）
function netUpdate(fn) {
  if (!game) return;
  fn();
  history = [];
  render();
  drainFx();
}

function undo() {
  // 効果の処理中は戻さない（選んでいる途中の状態と食い違うため）
  if (fxBusy()) return;
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
// ネット対戦：自分の攻撃の結果（相手のブロック・S・トリガー）を待っている間は、ほかの操作をさせない
// （攻撃するときの効果を処理している間は、効果の画面で操作する）
const waitingOpp = () => !!game?.attack && online() && !fxBusy();
// 1ターン目が始まる前（相手の1ターン目を待つ後攻も含む）・相手の対応を待っている間は、カードを動かしたり引いたりできない
const canPlay = () => !!game && game.turn > 0 && !waitingOpp();
// 操作できないときにお知らせを出す
function blockedByWait() {
  if (!waitingOpp()) return false;
  showToast(game.attack.triggers ? '相手が S・トリガーを使うか決めています' : '相手の対応（ブロック）を待っています');
  return true;
}

// ---------- 基本操作（act の中で呼ぶ） ----------

// destroy：破壊（バトル・効果で墓地へ）。セイバーで身代わりにできる
function moveCard(iid, to, { bottom = false, silent = false, destroy = false } = {}) {
  const from = zoneOf(iid);
  if (!from) return;
  const card = game.cards[iid];
  if (destroy && from === 'battlefield' && to === 'graveyard') {
    const saver = fxSaver(card);
    if (saver != null) {
      log(`${game.cards[saver].name}がかわりに破壊された（${card.name}は残る）`);
      return moveCard(saver, 'graveyard');
    }
  }
  // 進化元は、一番上のカードが置かれるはずだった場所へ
  const underTo = to;
  // バトルゾーンから墓地へ置かれるとき、かわりに手札・マナ・シールドへ置くクリーチャー
  const instead = from === 'battlefield' && to === 'graveyard' && (card.ab?.onDeath || fxDeathTo(card));
  if (instead) to = instead;
  game.zones[from] = game.zones[from].filter((x) => x !== iid);
  const sound = moveSound(card, from, to);
  if (sound) Sound.play(sound);
  if (to !== 'battlefield') {
    card.attacking = false;
    delete card.buff;
    delete card.guard;
  }
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
    if (underTo === 'library' && !bottom) game.zones.library.unshift(u);
    else game.zones[underTo].push(u);
  }
  if (!silent) {
    const where = to === 'library' ? `山札の一番${bottom ? '下' : '上'}` : ZONES[to];
    const shown = from === 'shields' || to === 'shields' ? 'シールドのカード' : card.name;
    log(`${shown}：${ZONES[from]} → ${where}${instead ? '（墓地に置くかわりに）' : ''}${under.length ? `（進化元${under.length}枚も）` : ''}`);
  }
  // 墓地に置かれたとき・ほかのクリーチャーが出た／墓地に置かれたときの効果は、この操作のあとで処理する（effects.js）
  fxAfterMove(card, from, to);
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
  game.manaPool = [];
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
  skipEmptyCharge();
}

function beginTurn() {
  Sound.play(online() ? 'myturn' : 'endturn');
  game.turn++;
  game.charged = 0;
  log(`ターン${game.turn}開始`);
  clearAttackers();
  untapAll();
  clearTurnFx(true);
  game.phase = 'start';
}

// 効果で得た「このターンだけ」の能力を消す（ターンの始まりには「次のターンまで」のブロッカーも）
function clearTurnFx(guard = false) {
  for (const c of Object.values(game.cards)) {
    delete c.buff;
    if (guard) delete c.guard;
  }
  game.turnFx = null;
  // このターンにブレイクした相手のシールドの枚数（ビースト・チャージ）
  game.brokeThisTurn = 0;
}

// 自分のターンの終わり：「ターンの終わりにアンタップする」クリーチャー
function endOfTurnUntap() {
  const mine = game.zones.battlefield.map((i) => game.cards[i]).filter((c) => c.isCreature);
  const all = game.turnFx?.untapAtEnd || mine.some((c) => c.ab?.endUntap === 'all');
  const list = mine.filter((c) => c.tapped && (all || c.ab?.endUntap === 'self'));
  for (const c of list) c.tapped = false;
  if (list.length) log(`ターンの終わりにアンタップ：${list.map((c) => c.name).join('、')}`);
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
  skipEmptyCharge();
}

// ---------- ターンの受け渡し（ネット対戦） ----------

// 一人回しはすぐ1ターン目。ネット対戦は先攻後攻の確定を待つ
function beginFirstTurn() {
  if (!online()) return startTurnOne();
  game.phase = 'ready';
  tryFirstTurn();
}

function tryFirstTurn() {
  // 手札を配る前（マッチングする前）は始めない
  if (game.phase !== 'ready' || !game.orderFixed || !game.dealt) return;
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
  endOfTurnUntap();
  clearTurnFx();
  // ファントム・ベール（このターンだけ、攻撃できるクリーチャーはすべて攻撃しなければならなかった）
  game.forcedAttack = false;
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
  if (!game?.dealt) return;
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
// 自分でタップして選んだマナ（まだ支払いに使っていないもの）。手札の払えないカードを暗くするのに使う
const manaPool = () => (game.manaPool ?? []).filter((i) => zoneOf(i) === 'mana' && game.cards[i].tapped).map((i) => game.cards[i]);

// 支払うマナを選ぶ：カードの文明をそれぞれ1枚以上含めて、コストの枚数だけ。払えなければ null
// pool：使えるマナ（ふだんはアンタップのマナ、選んだマナで払うときはそのマナ）
function payCost(card, pool = untappedMana()) {
  // コストを増やす・減らすクリーチャーの分を足す（effects.js）
  const cost = costOf(card);
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

// 支払い：自分でタップして選んだマナ（manaPool）からだけ払う。自動で選ばない・払えなければ出せない
function confirmPay(card) {
  const pool = manaPool();
  const pay = payCost(card, pool);
  if (pay) return { pay };
  const need = `コスト${costOf(card)}（${DM.civText(card.civs)}のマナを1枚以上）`;
  showToast(pool.length ? `選んだマナ${pool.length}枚では払えません：${need}` : `マナゾーンのカードをタップして選んでから出してください：${need}`);
  return null;
}

// 自分が今その操作をできるか（自分のターン・そのステップ・相手や効果を待っていない）。できなければ理由を出す
function canAct(phases = null) {
  if (!started() || game.result) return false;
  if (blockedByWait()) return false;
  if (!myTurn()) {
    showToast('相手のターンです');
    return false;
  }
  if (busy()) {
    showToast(pendingTriggers() ? 'S・トリガーを先に決めてください' : resolving().length || fxBusy() ? '効果の処理中です' : '攻撃の処理中です');
    return false;
  }
  if (phases && !phases.includes(game.phase)) {
    showToast(`${phaseName(game.phase)}・ステップではできません`);
    return false;
  }
  return true;
}

// 支払ったマナをタップし、選んだマナから外す
function tapMana(pay) {
  for (const m of pay) m.tapped = true;
  if (pay.length) Sound.play('tap');
  game.manaPool = (game.manaPool ?? []).filter((i) => !pay.some((m) => m.iid === i));
}

// 手札から召喚する・唱える（ダブルクリック）
// 召喚・呪文は自分のターンのマナチャージ・メイン・ステップだけ（攻撃を始めたあとはできない）
function playFromHand(iid) {
  if (zoneOf(iid) !== 'hand' || !canAct(['charge', 'main'])) return;
  const c = game.cards[iid];
  if (spellLocked(c)) return showToast('聖霊王アルカディアスがいるので、光以外の呪文は唱えられません');
  if (c.ab.evolution && c.isCreature) return chooseEvolutionBase(iid);
  const paid = confirmPay(c);
  if (!paid) return;
  act(() => {
    // マナチャージ・ステップで召喚・呪文を使ったら、チャージせずにメインへ進んだことにする
    if (game.phase === 'charge') game.phase = 'main';
    tapMana(paid.pay);
    const mana = paid.pay.length ? `（マナ${paid.pay.length}）` : '';
    if (c.isSpell) {
      // 呪文は効果を処理し終えるまでバトルゾーンの上に置いておく（自動で処理できなければ「処理完了」で墓地へ）
      moveCard(iid, 'resolving', { silent: true });
      log(`${c.name}を唱えた${mana}`);
    } else {
      moveCard(iid, 'battlefield', { silent: true });
      log(`${c.name}を${c.isCreature ? '召喚' : 'バトルゾーンに出した'}${mana}`);
    }
  });
  // 呪文は大きく演出してから効果を処理する
  if (c.isSpell) cutIn(c, 'spell').then(() => playedFx(iid));
  else playedFx(iid);
}

// 呪文・S・トリガーの演出：画面いっぱいにカードと文字を出す（相手の画面にも出す）。演出が終わると resolve
function cutIn(card, kind, { mine = true } = {}) {
  if (mine && Net.connected()) {
    const { name, image, civs, cost, power, type, race, text } = card;
    Net.send({ type: 'cutin', kind, card: { name, image, civs, cost, power, type, race, text } });
  }
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = `cutin ${kind === 'trigger' ? 'trigger' : 'spell'}${mine ? '' : ' opp'}`;
    el.style.setProperty('--cutin-civ', `var(--civ-${DM.civOf(card.civs?.[0])?.cls ?? 'light'})`);
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<div class="cutin-flash"></div><div class="cutin-band"></div><div class="cutin-inner"><div class="cutin-card"></div><div class="cutin-text"><b class="cutin-title"></b><span class="cutin-name"></span></div></div>';
    el.querySelector('.cutin-card').append(DM.cardFace(card));
    el.querySelector('.cutin-title').textContent = kind === 'trigger' ? 'SHIELD TRIGGER!!' : 'SPELL!';
    el.querySelector('.cutin-name').textContent = `${mine ? '' : `${oppName()}の`}${card.name}`;
    document.body.append(el);
    setTimeout(resolve, 1150);
    setTimeout(() => el.remove(), 1450);
  });
}

// 唱えた呪文・出したクリーチャーの効果（effects.js）
function playedFx(iid) {
  const c = game.cards[iid];
  if (c.isSpell) return castFx(iid);
  return runFx(iid, 'summon');
}

// 進化：バトルゾーンの自分のクリーチャーを選んで、その上に重ねる
function chooseEvolutionBase(iid) {
  const bases = game.zones.battlefield.filter((i) => game.cards[i].isCreature);
  if (!bases.length) return showToast('進化元にする自分のクリーチャーがいません');
  // 先に支払えるか確かめる（払えなければ選ぶメニューを出さない）
  if (!confirmPay(game.cards[iid])) return;
  showMenu(bases.map((b) => [`${game.cards[b].name}の上に進化`, () => evolve(iid, b)]), lastPointer.x, lastPointer.y, game.cards[iid]);
}

function evolve(iid, baseIid) {
  if (zoneOf(iid) !== 'hand' || zoneOf(baseIid) !== 'battlefield' || !canAct(['charge', 'main'])) return;
  const c = game.cards[iid];
  const base = game.cards[baseIid];
  const paid = confirmPay(c);
  if (!paid) return;
  act(() => {
    if (game.phase === 'charge') game.phase = 'main';
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
    fxAfterMove(c, 'hand', 'battlefield');
  });
  runFx(iid, 'summon');
}

// マナチャージ：自分のターンのマナチャージ・ステップに、手札から1枚だけ
function chargeMana(iid) {
  if (zoneOf(iid) !== 'hand' || !canAct(['charge'])) return;
  if (game.charged >= CHARGES_PER_TURN) return showToast('マナチャージは1ターンに1枚までです');
  act(() => {
    moveCard(iid, 'mana');
    game.charged++;
    // チャージしたら、そのままメイン・ステップへ
    game.phase = 'main';
  });
}

// ---------- シールド・S・トリガー ----------

// シールドを手札に加える（S・トリガーがあれば使うか選ぶ）
function breakShield(iid) {
  if (zoneOf(iid) !== 'shields') return;
  const c = game.cards[iid];
  moveCard(iid, 'hand', { silent: true });
  // フ・レイル・ギガボルバがいると、その文明の S・トリガーは使えない
  const blocked = c.ab.sTrigger && triggerBlocked(c);
  log(`シールドをブレイク：${c.name}を手札へ${c.ab.sTrigger ? (blocked ? '（S・トリガーは使えない）' : '（S・トリガー）') : ''}`);
  if (c.ab.sTrigger && !blocked) game.triggers.push(iid);
}

function breakShields(n) {
  Sound.play('break');
  for (let k = 0; k < n && game.zones.shields.length; k++) breakShield(game.zones.shields.at(-1));
}

async function useTrigger(iid) {
  if (zoneOf(iid) !== 'hand') return;
  if (spellLocked(game.cards[iid])) return showToast('聖霊王アルカディアスがいるので、光以外の呪文は唱えられません（「使わない」を選んでください）');
  act(() => {
    game.triggers = game.triggers.filter((x) => x !== iid);
    // 攻撃した相手に「S・トリガーを使った」と知らせる（ポコルル）
    game.triggerUsed = true;
    const c = game.cards[iid];
    Sound.play('trigger');
    if (c.isSpell) {
      moveCard(iid, 'resolving', { silent: true });
      log(`S・トリガーで${c.name}を唱えた`);
    } else {
      moveCard(iid, 'battlefield', { silent: true });
      log(`S・トリガーで${c.name}を${c.isCreature ? '召喚' : '出した'}`);
    }
  });
  // 大きく演出して、効果を処理し終えてから、攻撃した相手に知らせる
  await cutIn(game.cards[iid], 'trigger');
  await playedFx(iid);
  finishTriggers();
}

function skipTrigger(iid) {
  act(() => {
    game.triggers = game.triggers.filter((x) => x !== iid);
    log(`${game.cards[iid].name}のS・トリガーを使わない`);
  });
  finishTriggers();
}

// S・トリガーをすべて決め終えたら、攻撃した相手に知らせる（相手はそれまで次の攻撃やターン終了ができない）
function finishTriggers() {
  if (!game || pendingTriggers() || resolving().length || fxBusy() || !game.triggerFor) return;
  const id = game.triggerFor;
  const used = !!game.triggerUsed;
  game.triggerFor = null;
  game.triggerUsed = false;
  saveGame();
  if (!Net.connected()) return;
  // 出したクリーチャーなどが先に相手へ届くよう、今の状態をすぐ送る
  Net.send({ type: 'state', state: snapshot() });
  Net.send({ type: 'triggersDone', id, used });
}

// まだ使うか決めていない S・トリガーの数（手札に残っているものだけ）
const pendingTriggers = () => (game?.triggers ?? []).filter((iid) => zoneOf(iid) === 'hand').length;
// 処理中の呪文
const resolving = () => game?.zones.resolving ?? [];
// 攻撃の結果待ち・S・トリガー・呪文や効果の処理中は、先に進めない
const busy = () => !!game.attack || pendingTriggers() > 0 || resolving().length > 0 || fxBusy();

// 呪文の効果を処理し終えた：墓地へ置く（S・トリガーで唱えた呪文なら、攻撃した相手に知らせる）
function finishSpell(iid) {
  if (zoneOf(iid) !== 'resolving') return;
  act(() => {
    moveCard(iid, 'graveyard', { silent: true });
    log(`${game.cards[iid].name}の処理が終わった`);
  });
  finishTriggers();
}

// ---------- 攻撃 ----------

const oppBattlefield = () => opp?.state?.battlefield ?? [];
// マナチャージ・ステップからでも攻撃できる（チャージせずに攻撃へ進む）
const canAttackNow = (c) => myTurn() && ['charge', 'main', 'attack'].includes(game.phase) && !busy()
  && c.isCreature && !c.tapped && !isSick(c) && !abOf(c).cannotAttack && zoneOf(c.iid) === 'battlefield' && !attackBlockedBy(c);

// 条件つきの「攻撃できない」：相手にシールドがない（ヴァシュナ・ギガゾウル）・相手のクリーチャーのほうが多い（ブルレイザー）
function attackBlockedBy(c) {
  const oppShields = online() ? opp?.state?.shields ?? 0 : game.oppShields;
  if (c.ab?.needOppShields && !oppShields) return '相手にシールドがない';
  if (c.ab?.outnumbered && online() && oppBattlefield().filter((o) => o.isCreature).length > game.zones.battlefield.filter((i) => game.cards[i].isCreature).length) return '相手のクリーチャーのほうが多い';
  return null;
}

// 攻撃しなければならないのに、まだ攻撃していないクリーチャー（毎ターン攻撃する・ファントム・ベール）
const mustAttackers = () => game.zones.battlefield.map((i) => game.cards[i])
  .filter((c) => (c.ab?.mustAttack || game.forcedAttack) && canAttackNow(c) && attackTargets(c).length);
const canAnyAttack = () => game.zones.battlefield.some((i) => canAttackNow(game.cards[i]));

// バトルゾーンのクリーチャーのクリック：攻撃だけ（手でタップ・アンタップはしない）
function onBattlefieldClick(iid) {
  const c = game.cards[iid];
  if (canAttackNow(c)) return openAttackMenu(iid);
  if (!canAct(['charge', 'main', 'attack'])) return;
  if (!c.isCreature) return;
  if (c.tapped) return showToast(`${c.name}はタップされているので攻撃できません`);
  if (isSick(c)) return showToast(`${c.name}はこのターンに出たので攻撃できません（召喚酔い）`);
  const why = abOf(c).cannotAttack ? 'このクリーチャーは攻撃できない' : attackBlockedBy(c);
  if (why) showToast(`${c.name}は攻撃できません（${why}）`);
}

// 攻撃先：プレイヤー、または相手のタップしているクリーチャー
// （「タップされていないクリーチャーを攻撃できる」能力・カオス・ストライクで選ばれたクリーチャーは、アンタップでも）
function attackTargets(c) {
  const ab = abOf(c);
  const items = [];
  if (!ab.cannotAttackPlayer) items.push(['プレイヤーを攻撃', 'player']);
  if (online() && !ab.cannotAttackCreature && !c.buff?.freeAttack) {
    for (const o of oppBattlefield()) {
      if (!o.isCreature) continue;
      // 「闇のクリーチャーに攻撃されない」など
      if (o.ab?.unattackableBy?.some((v) => c.civs.includes(v))) continue;
      const untappedOk = ab.attackUntapped === true || (Array.isArray(ab.attackUntapped) && ab.attackUntapped.some((v) => o.civs?.includes(v)))
        || game.turnFx?.attackable?.includes(o.iid);
      if (o.tapped || untappedOk) items.push([`${o.name}（パワー${o.power ?? 0}${o.tapped ? '' : '・アンタップ'}）を攻撃`, o.iid]);
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
  showMenu(targets.map(([label, target]) => [label, () => declareAttack(iid, target)]), lastPointer.x, lastPointer.y, c);
}

async function declareAttack(iid, target) {
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
  // 攻撃するときの効果（相手がブロックする前に処理する）
  if (hasFx(c.name, 'attack')) {
    await runFx(iid, 'attack');
    if (game.attack?.id !== id) return;
    // 効果で攻撃したクリーチャーがバトルゾーンを離れたら、攻撃は終わり
    if (zoneOf(iid) !== 'battlefield') {
      act(() => {
        game.attack = null;
        log(`${c.name}がバトルゾーンを離れたので、攻撃は終わり`);
      });
      return;
    }
  }
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
  const atkAb = abOf(atk);
  const defIid = blockerIid ?? (a.target !== 'player' ? a.target : null);
  const def = defIid != null ? oppBattlefield().find((o) => o.iid === defIid) : null;
  const msg = { type: 'combat', id: a.id, matchId: game.matchId, dead: [], breaks: 0, direct: false };
  // 割るシールドを選ぶ間は、結果をまだ相手に送らない（選び終えたら sendBreak で送る）
  let send = online();
  let broke = 0;
  act(() => {
    // 攻撃はここで終わり（ネット対戦でシールドをブレイクしたときだけ、相手の S・トリガーを待つため下で残す）
    game.attack = null;
    if (zoneOf(a.attacker) !== 'battlefield') return;
    atk.attacking = false;
    const atkP = attackPower(atk);
    if (defIid != null && !def) {
      // 攻撃先のクリーチャーが（効果などで）いなくなった
      log(`${atk.name}の攻撃先がいなくなった`);
    } else if (def) {
      // バトル：パワーの大きいほうが勝ち、同じなら両方破壊。スレイヤーは負けても相手を破壊する
      // 「バトルに勝っても墓地に置かれる」クリーチャー・ブラック・スレイヤーでブロックしたクリーチャーは、勝っても破壊
      // 「自然・光スレイヤー」はその文明の相手とのバトルだけ。「光クリーチャーとのバトルに負けても墓地に置かれない」も
      const slays = (ab, foe) => !!ab?.slayer || !!ab?.slayerCivs?.some((v) => foe.civs?.includes(v));
      const survives = (ab, foe) => !!ab?.survivesVs && !!foe.civs?.includes(ab.survivesVs);
      const defP = Number(def.power) || 0;
      const atkDies = (defP >= atkP || slays(def.ab, atk) || !!atk.ab.suicide) && !survives(atkAb, def);
      const defDies = (atkP >= defP || slays(atkAb, def) || !!def.ab?.suicide || (blockerIid != null && !!game.turnFx?.blackSlayer)) && !survives(def.ab, atk);
      log(`バトル${blockerIid != null ? '（ブロック）' : ''}：${atk.name}（${atkP}）対 ${def.name}（${defP}）`);
      if (defDies) {
        msg.dead.push(def.iid);
        log(`${def.name}を破壊`);
        Sound.play('destroy');
      }
      if (atkDies) moveCard(atk.iid, 'graveyard', { destroy: true });
      // 神拳の超人：ブロックされたら、相手のシールドを1枚ブレイク
      if (blockerIid != null && atk.ab.blockedBreak) {
        const shields = online() ? opp?.state?.shields ?? 0 : game.oppShields;
        if (shields) {
          log(`${atk.name}がブロックされたので、シールドを1枚ブレイク`);
          broke = 1;
          if (online()) {
            msg.breaks = 1;
            if (Net.connected()) game.attack = { ...a, triggers: true };
          } else game.oppShields--;
        }
      }
    } else if (online()) {
      const shields = opp?.state?.shields ?? 0;
      if (!shields) {
        msg.direct = true;
        log(`${atk.name}でダイレクトアタック！`);
      } else {
        const n = Math.min(atkAb.breaker, shields);
        if (n < shields && Net.connected()) {
          // どのシールドを割るかは攻撃した側が選ぶ（相手のシールドをクリック）
          game.attack = { ...a, pick: { n, picked: [] } };
          send = false;
          log(`${atk.name}がシールドを${n}枚ブレイク：割るシールドを選択中`);
        } else {
          msg.breaks = n;
          broke = n;
          log(`${atk.name}がシールドを${n}枚ブレイク`);
          if (Net.connected()) game.attack = { ...a, triggers: true };
        }
      }
    } else if (game.oppShields > 0) {
      const n = Math.min(atkAb.breaker, game.oppShields);
      game.oppShields -= n;
      broke = n;
      Sound.play('break');
      log(`シールドを${n}枚ブレイク（相手のシールド残り${game.oppShields}枚）`);
    } else {
      Sound.play('win');
      log(`${atk.name}でダイレクトアタック！（一人回し：とどめ）`);
      showToast('ダイレクトアタック！ とどめを刺しました');
    }
    // 相手プレイヤーを攻撃したあと墓地に置かれるクリーチャー
    if (!def && defIid == null && atk.ab.dieAfterPlayerAttack && zoneOf(atk.iid) === 'battlefield') moveCard(atk.iid, 'graveyard');
    game.brokeThisTurn = (game.brokeThisTurn || 0) + broke;
    if (send) clearHistoryAfterAct = true; // 相手に結果を送った後は元に戻せない
  });
  if (send) Net.send(msg);
  miracleDraw(broke);
}

// 割るシールドを選ぶ：相手のシールドを左から数えた番号。選び直しもできる
function pickShield(index) {
  const p = game.attack?.pick;
  if (!p) return;
  const picked = p.picked.includes(index) ? p.picked.filter((i) => i !== index) : [...p.picked, index];
  game.attack = { ...game.attack, pick: { ...p, picked } };
  Sound.play('button');
  saveGame();
  if (picked.length >= p.n) sendBreak();
  else {
    renderOpp();
    renderBanner();
  }
}

// おまかせ：右（新しく置かれたもの）から順に選ぶ
function pickShieldsAuto() {
  const p = game.attack?.pick;
  if (!p) return;
  const total = opp?.state?.shields ?? 0;
  const picked = [...p.picked];
  for (let i = total - 1; i >= 0 && picked.length < p.n; i--) if (!picked.includes(i)) picked.push(i);
  game.attack = { ...game.attack, pick: { ...p, picked } };
  sendBreak();
}

function sendBreak() {
  const a = game.attack;
  if (!a?.pick) return;
  const { n, picked } = a.pick;
  act(() => {
    game.attack = { id: a.id, attacker: a.attacker, target: a.target, triggers: true };
    log(`シールドを${n}枚ブレイク（左から${picked.map((i) => i + 1).sort((x, y) => x - y).join('・')}枚目）`);
    game.brokeThisTurn = (game.brokeThisTurn || 0) + n;
    clearHistoryAfterAct = true;
  });
  Net.send({ type: 'combat', id: a.id, matchId: game.matchId, dead: [], breaks: n, at: picked, direct: false });
  miracleDraw(n);
}

// ---------- 攻撃を受ける側（ネット対戦） ----------

// ブロックできるクリーチャー：アンタップのブロッカー（攻撃クリーチャーが「ブロックされない」なら無し）
// 「パワー○○以下のクリーチャーにブロックされない」などの攻撃クリーチャーは、当てはまるブロッカーを除く
function blockers(attacker) {
  if (attacker?.ab?.unblockable) return [];
  const by = attacker?.ab?.unblockableBy;
  const excluded = (c) => (!!by && ((by.maxPower != null && powerOf(c) <= by.maxPower)
    || (by.minPower != null && powerOf(c) >= by.minPower) || (by.civ && c.civs.includes(by.civ))))
    // 「火・自然ブロッカー」は、その文明の攻撃クリーチャーだけブロックできる
    || (!!c.ab?.blockerCivs && !c.ab.blockerCivs.some((v) => attacker?.civs?.includes(v)));
  return game.zones.battlefield.map((i) => game.cards[i]).filter((c) => c.isCreature && abOf(c).blocker && !c.tapped && !excluded(c));
}

function receiveAttack(msg) {
  if (msg.matchId && game.matchId && msg.matchId !== game.matchId) return;
  incomingAttack = { id: msg.id, attacker: msg.attacker, target: msg.target };
  Sound.play('attacked');
  render();
  // ブロックできるクリーチャーがいなければ、選ぶものがないので自動で「ブロックしない」
  const a = oppBattlefield().find((o) => o.iid === msg.attacker);
  if (!blockers(a).length) {
    setTimeout(() => {
      if (incomingAttack?.id !== msg.id) return;
      act(() => log(`${a?.name ?? 'クリーチャー'}の攻撃：ブロックできるクリーチャーがいない`));
      respondAttack(null);
    }, 700);
  }
}

function respondAttack(blockerIid) {
  const a = incomingAttack;
  if (!a) return;
  incomingAttack = null;
  if (blockerIid != null) {
    act(() => {
      const b = game.cards[blockerIid];
      b.tapped = true;
      game.lastBlocker = blockerIid;
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
      if (zoneOf(iid) === 'battlefield') moveCard(iid, 'graveyard', { destroy: true });
    }
    // 「ブロックしたとき、バトルのあとでアンタップする」ブロッカー
    const b = game.cards[game.lastBlocker];
    if (b && zoneOf(b.iid) === 'battlefield' && b.ab?.untapAfterBlock && b.tapped) {
      b.tapped = false;
      log(`${b.name}をバトルのあとでアンタップ`);
    }
    game.lastBlocker = null;
    if (msg.breaks) {
      // 相手が選んだシールド（左から数えた番号）を割る。番号がなければ右から
      const chosen = (msg.at ?? []).map((i) => game.zones.shields[i]).filter((iid) => iid != null);
      if (chosen.length) {
        Sound.play('break');
        for (const iid of chosen) breakShield(iid);
        if (chosen.length < msg.breaks) breakShields(msg.breaks - chosen.length);
      } else {
        breakShields(msg.breaks);
      }
      game.triggerFor = msg.id;
      game.triggerUsed = false;
    }
    if (msg.direct) {
      log(`${oppName()}のダイレクトアタック`);
      lose('direct');
    }
  });
  // S・トリガーがなければすぐに知らせる
  if (msg.breaks) finishTriggers();
}

// 自分の攻撃でブレイクした相手が、S・トリガーを決め終えた
function receiveTriggersDone(msg) {
  if (game.attack?.id !== msg.id) return;
  const atk = game.cards[game.attack.attacker];
  netUpdate(() => {
    game.attack = null;
    log(`${oppName()}のS・トリガーの確認が終わりました${msg.used ? '（S・トリガーを使った）' : ''}`);
  });
  // ポコルル：相手が S・トリガーを使ったら、アンタップしてよい
  if (msg.used && atk?.ab?.untapOnTrigger && atk.tapped && zoneOf(atk.iid) === 'battlefield') {
    fxSerial(async () => {
      if (await fxAsk(atk, `${oppName()}がS・トリガーを使いました。${atk.name}をアンタップしますか？`)) {
        act(() => {
          atk.tapped = false;
          log(`${atk.name}をアンタップ`);
        });
      }
    });
  }
}

// マナを支払うために選ぶ（タップ）・選び直す（アンタップ）。支払いに使ったマナ・多色で置いたマナは戻せない
function toggleTap(iid) {
  if (zoneOf(iid) !== 'mana' || !canAct(['charge', 'main'])) return;
  const c = game.cards[iid];
  const pooled = (game.manaPool ?? []).includes(iid);
  if (c.tapped && !pooled) return showToast('使ったマナはアンタップできません');
  act(() => {
    c.tapped = !c.tapped;
    Sound.play(c.tapped ? 'tap' : 'untap');
    const pool = (game.manaPool ?? []).filter((i) => i !== iid);
    game.manaPool = c.tapped ? [...pool, iid] : pool;
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


// ---------- フェイズの進行 ----------

// スマホ：フェイズの一覧を画面下のシートで出して、押したフェイズまで進める
function openPhaseMenu() {
  if (!myTurn()) return;
  const i = PHASES.findIndex(([id]) => id === game.phase);
  const items = [];
  PHASES.forEach(([id, name], j) => {
    if (j <= i) return;
    items.push([`${j === i ? '▶ ' : ''}${name}${j === i ? '（今）' : j < i ? '（次のターン）' : ''}`, () => { if (j !== i) goToPhase(id); }]);
  });
  showMenu(items, 0, 0);
}

function goToPhase(target) {
  if (!myTurn() || busy()) return;
  if (target === 'start') target = 'draw';
  // 今より前のフェイズには戻れない（ドローやマナチャージをやり直せないように）
  const index = (id) => PHASES.findIndex(([p]) => p === id);
  if (index(target) <= index(game.phase)) return;
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
  if (!myTurn() || busy()) return;
  stopAutoEnd();
  const must = mustAttackers();
  if (must.length) return showToast(`${must.map((c) => c.name).join('、')}は攻撃しなければなりません`);
  // ビースト・チャージ：ターンが終わるとき、ブレイクしたシールドの数だけクリーチャーを山札から手札へ
  const beast = game.turnFx?.beastCharge;
  if (beast?.length) {
    game.turnFx.beastCharge = [];
    const n = game.brokeThisTurn || 0;
    fxSerial(async () => {
      for (const src of beast) {
        if (n > 0 && game.cards[src]) await fxApi(src).search({ f: { creature: true }, n, may: true });
        else act(() => log('ビースト・チャージ：このターンにブレイクしたシールドがない'));
      }
    }).then(endTurn);
    return;
  }
  act(() => {
    game.phase = 'end';
    clearAttackers();
    finishTurn();
  });
}

// ---------- 自動でターン終了 ----------
// 攻撃し終えて、攻撃できるクリーチャーがいなくなったら、3秒数えてからターンを終了する（設定で切れる・取り消せる）

const AUTO_END_SECONDS = 3;
let autoEnd = null; // { left: 残り秒, timer }
let autoEndSkip = null; // 取り消したターン（そのターンはもう数えない）
const autoEndOn = () => { try { return localStorage.getItem('dm-deckmaker-autoend') !== 'off'; } catch { return true; } };
const autoEndReady = () => autoEndOn() && myTurn() && game.phase === 'attack' && !busy() && !canAnyAttack()
  && !game.result && autoEndSkip !== game.turn;

function stopAutoEnd() {
  if (!autoEnd) return;
  clearInterval(autoEnd.timer);
  autoEnd = null;
}

// render のたびに呼ぶ：条件がそろったら数え始め、くずれたら止める
function checkAutoEnd() {
  if (!game) return;
  if (autoEnd && !autoEndReady()) {
    stopAutoEnd();
    renderBanner();
  } else if (!autoEnd && autoEndReady()) {
    autoEnd = {
      left: AUTO_END_SECONDS,
      timer: setInterval(() => {
        if (!autoEnd) return;
        autoEnd.left--;
        if (autoEnd.left > 0) return renderBanner();
        stopAutoEnd();
        if (autoEndReady()) endTurn();
        else renderBanner();
      }, 1000),
    };
    renderBanner();
  }
}

// マナチャージ・ステップ：チャージする手札がなければ、そのままメインへ
function skipEmptyCharge() {
  if (game.phase === 'charge' && !game.zones.hand.length) {
    game.phase = 'main';
    log('チャージする手札がないので、メイン・ステップへ');
  }
}

// ---------- 描画 ----------

function render() {
  saveGame();
  if (!game) return;
  $('deck-name').textContent = game.deckName;
  $('turn-label').textContent = game.turn ? `ターン ${game.turn}` : '開始前';
  $('phase-hint').textContent = game.waiting ? '相手プレイヤーのターンです。' : PHASE_HINTS[game.phase] ?? '';
  const mana = game.zones.mana.length;
  const pooled = manaPool().length;
  $('mana-count').textContent = started() ? `マナ ${untappedMana().length}/${mana}${pooled ? `（選択${pooled}）` : ''}` : '';
  $('mana-count').classList.toggle('over', myTurn() && game.charged > CHARGES_PER_TURN);

  $('phases').replaceChildren(...PHASES.map(([id, name]) => {
    const b = document.createElement('button');
    b.textContent = name;
    b.dataset.phase = id;
    b.className = id === game.phase ? 'current' : '';
    // 前のフェイズには戻れない
    b.disabled = !myTurn() || busy() || PHASES.findIndex(([p]) => p === id) <= PHASES.findIndex(([p]) => p === game.phase);
    b.addEventListener('click', () => goToPhase(id));
    return b;
  }));
  // 攻撃の結果待ち・S・トリガーを決めている間は先に進めない
  const canAdvance = myTurn() && !busy();
  for (const id of ['next-phase', 'end-turn']) $(id).disabled = !canAdvance;
  const stop = myTurn() ? nextStop() : null;
  $('next-phase').textContent = stop?.label ?? '次へ';
  $('next-phase').hidden = myTurn() && !stop;
  $('phase-current').textContent = `${phaseName(game.phase) || '—'} ▼`;
  $('phase-current').dataset.phase = game.phase;
  $('phase-current').disabled = !canAdvance;
  $('undo').disabled = !history.length || fxBusy();

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
  checkAutoEnd();
  updateBgm();
  checkMatch();
}

// 対戦の準備中（開始画面・相手の参加や1ターン目を待っている間）は ready、ゲームが始まったら battle
function updateBgm() {
  Bgm.play(started() && !$('setup').open ? 'battle' : 'ready');
}

function renderBattlefield() {
  fillZone('bf-main', game.zones.battlefield, 'battlefield');
  fillZone('bf-shields', game.zones.shields, 'shields');
  fillZone('bf-mana', game.zones.mana, 'mana');
  // 処理中の呪文：バトルゾーンの上に置き、「処理完了」で墓地へ
  $('bf-resolving').hidden = !resolving().length;
  $('bf-resolving').replaceChildren(...resolving().map((iid) => {
    const item = document.createElement('div');
    item.className = 'resolving-item';
    const done = Object.assign(document.createElement('button'), { type: 'button', className: 'primary', textContent: '処理完了' });
    done.title = '効果を処理し終えたら押す（呪文を墓地へ置く）';
    done.hidden = fxBusy();
    done.addEventListener('click', () => finishSpell(iid));
    item.append(cardEl(iid, 'resolving'), done);
    return item;
  }));
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
  bar.classList.remove('trigger');
  const trigger = game.triggers?.find((iid) => zoneOf(iid) === 'hand');
  if (trigger != null) {
    // S・トリガー：画面の中央にカードを大きく出して、使うか決めるまで止める
    const c = game.cards[trigger];
    const rest = pendingTriggers() - 1;
    bar.classList.add('trigger');
    const choices = Object.assign(document.createElement('div'), { className: 'choices' });
    choices.append(button('使う', () => useTrigger(trigger), true), button('使わない', () => skipTrigger(trigger)));
    bar.replaceChildren(
      span('SHIELD TRIGGER', 'trigger-title'),
      DM.cardFace(c),
      span(`${c.name}（${c.isSpell ? '呪文' : c.type}）を使いますか？${rest ? `（ほかに${rest}枚）` : ''}`, 'banner-title'),
      choices,
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
  if (fxBusy()) {
    bar.replaceChildren(span('カードの効果を処理しています'));
    return;
  }
  if (resolving().length) {
    const names = resolving().map((iid) => game.cards[iid].name).join('、');
    bar.replaceChildren(
      span(`呪文を処理中：${names}。効果を処理したら「処理完了」を押してください`),
      button('処理完了', () => finishSpell(resolving()[0]), true),
    );
    return;
  }
  if (game.attack?.pick) {
    const { n, picked } = game.attack.pick;
    bar.replaceChildren(
      span(`割るシールドを相手のシールドから${n}枚選んでください（あと${n - picked.length}枚）`, 'banner-title'),
      button('おまかせ', pickShieldsAuto),
    );
    return;
  }
  if (autoEnd) {
    bar.replaceChildren(
      span(`攻撃できるクリーチャーがいないので、${autoEnd.left}秒後にターンを終了します`),
      button('すぐ終了', () => { stopAutoEnd(); endTurn(); }, true),
      button('取り消し', () => { stopAutoEnd(); autoEndSkip = game.turn; renderBanner(); }),
    );
    return;
  }
  // ブロック・S・トリガーは守る側が決める。攻撃した側が先に進められるのは、接続が切れたときだけ
  // 相手が一度つながってから切れたときだけ（まだ誰も来ていないときは「切れた」にしない）
  const lost = !!opp?.name && (!opp.connected || !Net.connected());
  if (game.attack?.triggers) {
    bar.replaceChildren(
      span(lost ? '相手との接続が切れています（S・トリガーの確認待ち）' : '相手が S・トリガーを使うか決めています。お待ちください'),
      ...(lost ? [button('待たずに進める', () => netUpdate(() => { game.attack = null; }))] : []),
    );
    return;
  }
  if (game.attack) {
    bar.replaceChildren(
      span(lost ? '相手との接続が切れています（ブロックの確認待ち）' : '相手がブロックするか決めています。お待ちください'),
      ...(lost ? [button('ブロックなしで進める', () => resolveAttack(null)), button('攻撃を取り消す', cancelAttack)] : []),
    );
    return;
  }
  if (online() && (game.waiting || game.phase === 'ready')) {
    const label = !game.orderFixed
      ? '対戦相手を待っています（マッチングしたら手札を配り、先攻・後攻を決めます）'
      : !game.dealt ? '対戦相手を待っています（マッチングしたら手札を配り、先攻・後攻を決めます）'
        : game.waiting ? '相手プレイヤーのターンです' : '相手を待っています';
    const force = button('自分のターンを始める', () => {
      if (confirm('相手のターンを待たずに、自分のターンを始めますか？')) forceMyTurn();
    });
    force.title = '通信が止まったときに使います';
    // 相手とつながっている間は、相手のターンを飛ばせない
    // 手札を配る前（マッチング前）は、自分のターンを始められない
    const canForce = game.orderFixed && game.dealt && lost;
    bar.replaceChildren(span(lost && game.orderFixed ? `${label}（相手との接続が切れています）` : label), ...(canForce ? [force] : []));
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
  // 動かせるのは手札だけ（バトルゾーンへ＝召喚・呪文、マナゾーンへ＝チャージ）
  el.draggable = !phone() && zone === 'hand' && canPlay();
  el.addEventListener('pointerdown', (e) => { lastPointer = { x: e.clientX, y: e.clientY }; });
  el.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', String(iid)));

  // シールドは裏向き（中は見られない・手で動かせない）
  if (zone === 'shields') {
    el.classList.add('shield');
    el.append(Object.assign(document.createElement('div'), { className: 'dm-back' }));
    el.title = 'シールド';
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    return el;
  }

  fillCardFace(el, c);
  if (zone === 'mana') {
    el.classList.add('mana-card');
    if (c.tapped && (game.manaPool ?? []).includes(iid)) el.classList.add('pooled');
  }
  if (zone === 'battlefield') {
    addBadges(el, c);
    if (myTurn() && isSick(c)) el.classList.add('sick');
    if (canAttackNow(c)) el.classList.add('can-attack');
  }

  if (zone === 'hand') {
    // マナを選んでいるときは、そのマナで払えるカードだけを明るく、ほかは暗くする
    const pool = myTurn() ? manaPool() : [];
    if (pool.length) el.classList.add(payCost(c, pool) ? 'payable' : 'unpayable');
    el.addEventListener('dblclick', () => playFromHand(iid));
    el.addEventListener('click', (e) => { if (phone()) openCardMenu(iid, e.clientX, e.clientY); });
  } else if (zone === 'battlefield') {
    el.addEventListener('click', () => onBattlefieldClick(iid));
  } else if (zone === 'mana') {
    el.addEventListener('click', () => toggleTap(iid));
  }
  el.addEventListener('mouseenter', () => showPreview(c));
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!phone() && !el.dataset.longpress) openCardMenu(iid, e.clientX, e.clientY);
  });
  // 長押ししているあいだ詳細（離したら閉じる）。スマホの手札は、触れて動かすとドラッグ
  const peek = onPeek(el, () => detailOf(c));
  if (phone() && zone === 'hand' && canPlay()) onHoldDrag(el, iid, peek);
  return el;
}

// スマホ：カードに触れて指を動かすと、すぐにカードを持ち上げて、離した場所の領域（data-zone）へ移す（長押しはいらない）。
// 手札は横にスクロールするので、横に動かしたらスクロール、縦に動かしたらドラッグ。
// 動かさずに長押ししているあいだは詳細（peek：onPeek が出す。ドラッグを始めたら取り消す）。ふつうのタップはクリックのまま
function onHoldDrag(el, iid, peek) {
  const MOVE_PX = 8;
  // ブラウザのスクロールより先にドラッグを始められるよう、touch-action を CSS で決める（data-drag）
  el.dataset.drag = '1';
  let start = null;
  let mode = null; // null：まだ決めていない、'drag'：ドラッグ中、'scroll'：スクロールに任せる
  let ghost = null;
  let target = null;
  const reset = () => {
    start = null;
    mode = null;
    ghost?.remove();
    ghost = null;
    target?.classList.remove('drop-target');
    target = null;
    el.classList.remove('lifted');
  };
  el.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return reset();
    start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    // 詳細を出しているあいだは動かさない
    if (mode === 'scroll' || !start || el.dataset.longpress) return;
    if (!mode) {
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (Math.hypot(dx, dy) < MOVE_PX) return;
      peek?.cancel();
      // 手札を横に動かしたらスクロール
      if (el.closest('.hand') && Math.abs(dx) > Math.abs(dy)) {
        mode = 'scroll';
        return;
      }
      mode = 'drag';
      el.classList.add('lifted');
    }
    // ドラッグ中は画面をスクロールさせない
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
    const dragged = mode === 'drag' && !!ghost;
    // ふつうのタップ・スクロールはそのまま（click が起きる）
    if (!dragged) return reset();
    // ドラッグのあとの click（タップの操作）は起こさない
    e.preventDefault();
    const zone = target?.dataset.zone;
    reset();
    if (zone) dropCard(iid, zone);
  });
  el.addEventListener('touchcancel', reset);
}

// カードの絵（画像がなければ文字のカード）
function fillCardFace(el, c) {
  el.title = `${c.name}\n${DM.detailText(c)}`;
  el.append(DM.cardFace(c));
}

// 名前から収録カード（相手のカードの元のパワーを調べる）
const printedByNameCache = {};
const printedByName = (name) => (printedByNameCache[name] ??= Object.values(cardData).find((x) => x.name === name));

// バトルゾーンのカードの印：攻撃中・進化元の枚数
function addBadges(el, c) {
  const badge = (className, text) => el.append(Object.assign(document.createElement('span'), { className, textContent: text }));
  if (c.attacking) badge('atk', '攻撃');
  const under = Array.isArray(c.under) ? c.under.length : c.under || 0;
  if (under) badge('under', `進化元${under}`);
  // 効果で得ている能力（相手のカードは snapshot の buffText）
  const fx = c.buffText ?? (c.buff || c.guard ? buffBadge(c) : '');
  if (fx) badge('fx-buff', fx);
  // 効果・常在型能力でパワーが変わっていれば、今のパワー（相手のカードは snapshot の値）
  if (c.isCreature) {
    const base = (game.cards[c.iid] === c ? cardData[c.cid] : printedByName(c.name))?.power;
    const now = game.cards[c.iid] === c ? powerOf(c) : Number(c.power);
    if (base != null && now !== base) badge('fx-power', `${now}`);
  }
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
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  // 長押ししているあいだ詳細（離したら閉じる）
  onPeek(el, () => detailOf(c));
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
  // 相手が処理中の呪文
  $('opp-resolving').hidden = !st?.resolving?.length;
  $('opp-resolving').replaceChildren(...(st?.resolving ?? []).map(oppCardEl));
  $('opp-mana').replaceChildren(...(st?.mana ?? []).map((c) => {
    const el = oppCardEl(c);
    el.classList.add('mana-card');
    return el;
  }));
  // 割るシールドを選んでいる間は、相手のシールドをクリックで選ぶ
  const pick = game?.attack?.pick;
  $('opp-shields').replaceChildren(...Array.from({ length: st?.shields ?? 0 }, (_, i) => {
    const el = document.createElement('div');
    el.className = 'card shield' + (pick ? ' pickable' : '') + (pick?.picked.includes(i) ? ' picked' : '');
    el.append(Object.assign(document.createElement('div'), { className: 'dm-back' }));
    if (pick) el.addEventListener('click', () => pickShield(i));
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

// 相手に見せるカード（効果で得ている能力・パワーを足しておく）
function pubCard(iid) {
  const c = game.cards[iid];
  return {
    iid, name: c.name, image: c.image, civs: c.civs, cost: c.cost, power: c.isCreature ? powerOf(c) : c.power, type: c.type, race: c.race, text: c.text,
    ab: abOf(c), isCreature: c.isCreature, isSpell: c.isSpell, tapped: !!c.tapped, attacking: !!c.attacking, under: c.under?.length || 0,
    buffText: c.buff || c.guard ? buffBadge(c) : '',
  };
}

// 自分の公開情報（手札・シールドの中身、山札の順番は含めない）
function snapshot() {
  if (!game) return null;
  const pub = pubCard;
  return {
    deckName: game.deckName,
    // 同じ対戦かどうか（マッチングの確認）
    matchId: game.matchId,
    turn: game.turn,
    phase: game.phase,
    waiting: !!game.waiting,
    hand: game.zones.hand.length,
    library: game.zones.library.length,
    shields: game.zones.shields.length,
    battlefield: game.zones.battlefield.map(pub),
    mana: game.zones.mana.map(pub),
    graveyard: game.zones.graveyard.map(pub),
    resolving: resolving().map(pub),
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
          log(`${oppName()}の対戦に参加しました`);
          tryFirstTurn();
        });
        return;
      }
    }
    if (game) render(); else renderOpp();
  });
  Net.on('state', (msg) => {
    const prev = opp?.state;
    opp = { ...opp, state: msg.state, connected: true };
    // 相手のクリーチャーが出た・墓地に置かれた（ミスト・リエス・屑男）
    fxOppDiff(prev, msg.state);
    if (game) {
      renderBattlefield();
      renderBanner();
    }
    renderOpp();
    showResultIfNew();
    renderLog();
    if (viewer?.opp) renderViewer();
    checkMatch();
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
  Net.on('triggersDone', (msg) => { if (game) receiveTriggersDone(msg); });
  // 相手の呪文・S・トリガーの演出
  Net.on('cutin', (msg) => { if (game && msg.card?.name) cutIn(msg.card, msg.kind, { mine: false }); });
  // カードの効果（effects.js）
  Net.on('fx', receiveFx);
  Net.on('peek', receivePeek);
  Net.on('peekReply', receivePeekReply);
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
  Sound.play('open');
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

// カードのメニュー：今できる操作だけ（手で動かす・引く・シールドを見るなどはできない）
function openCardMenu(iid, x, y) {
  if (!canPlay()) return;
  const c = game.cards[iid];
  const zone = zoneOf(iid);
  const items = [];
  if (zone === 'hand' && myTurn()) {
    if (['charge', 'main'].includes(game.phase)) {
      items.push([c.isSpell ? '唱える（選んだマナで支払う）' : c.ab.evolution ? '進化する…' : '召喚する（選んだマナで支払う）', () => playFromHand(iid)]);
    }
    if (game.phase === 'charge' && game.charged < CHARGES_PER_TURN) items.push(['マナゾーンへ（チャージ）', () => chargeMana(iid)]);
  } else if (zone === 'battlefield') {
    if (canAttackNow(c)) items.push(['攻撃する…', () => openAttackMenu(iid)]);
  } else if (zone === 'mana' && myTurn() && ['charge', 'main'].includes(game.phase)) {
    const pooled = (game.manaPool ?? []).includes(iid);
    if (!c.tapped || pooled) items.push([pooled ? '選んだマナを外す（アンタップ）' : '支払いに使う（タップ）', () => toggleTap(iid)]);
  }
  if (!items.length) return;
  showMenu(items, x, y, c);
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
  updateBgm();
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

// ドラッグしたカードを領域に置く（PC のドラッグ、スマホで触れて動かす）
// 手札からバトルゾーン＝召喚・呪文、マナゾーン＝チャージだけ。ほかの場所へは動かせない
function dropCard(iid, zone) {
  if (!game?.cards[iid] || zoneOf(iid) === zone) return;
  if (zoneOf(iid) === 'hand' && zone === 'battlefield') return playFromHand(iid);
  if (zoneOf(iid) === 'hand' && zone === 'mana') return chargeMana(iid);
  showToast('そこへは動かせません');
}

function init() {
  $('next-phase').addEventListener('click', nextPhase);
  $('end-turn').addEventListener('click', endTurn);
  $('undo').addEventListener('click', undo);
  $('restart').addEventListener('click', openSetup);

  $('tools').addEventListener('click', (e) => {
    if (phone() && e.target.closest('button')) window.setPhoneSheet?.('');
  });
  window.addEventListener('phonesheet', () => {
    hideMenu();
    renderLog();
  });
  $('pile-graveyard').addEventListener('click', () => openViewer('graveyard', '墓地', null));

  $('viewer-close').addEventListener('click', closeViewer);
  $('viewer').addEventListener('cancel', (e) => {
    e.preventDefault();
    closeViewer();
  });

  // ゲームがないまま開始画面を閉じると操作できない画面が残るので、閉じさせない
  $('setup').addEventListener('cancel', (e) => { if (!game) e.preventDefault(); });
  $('setup').addEventListener('close', () => {
    if (!game) $('setup').showModal();
    // 開始画面を閉じてゲームに戻ったら、対戦中の曲に戻す
    else updateBgm();
  });
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
    }
  });

  setupDropZones();
  setupNet();
  // BGM：開始画面・相手待ちは ready、ゲームが始まったら battle（render の updateBgm）
  Bgm.play('ready');
  Bgm.preload('battle');

  // 再読み込みしたら同じ部屋に戻る
  if (netInfo?.role === 'host') Net.host(netInfo.code);
  else if (netInfo?.role === 'guest') Net.join(netInfo.code);

  const requested = Number(new URLSearchParams(location.search).get('deck'));
  // 以前の版で始めたゲームには、処理中の呪文を置く場所がない
  if (game) game.zones.resolving ??= [];
  // 以前の版で始めたゲームは、手札を配り終えている
  if (game) game.dealt ??= true;
  if (game && (!requested || requested === game.deckId)) render();
  else {
    game = null;
    renderOpp();
    renderLog();
    openSetup();
  }
}

init();
