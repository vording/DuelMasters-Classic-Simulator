// CPU 対戦の CPU 側の操作（play.html?cpu=強さ で開いたときだけ動く。play.js・effects.js のあとで読み込む）
// 画面を操作する代わりに、play.js の操作（chargeMana・playFromHand・declareAttack・respondAttack など）を
// 少しずつ間をあけて呼ぶ。効果の選択（fxChoose）も自動で決める。
// 強さ：1＝弱い（でたらめに近い）、2＝普通（コストの大きいカードから出し、勝てるバトルをする）、
//       3＝強い（文明をそろえてチャージし、とどめ・ブロッカー・ブレイクする盾まで考える）
(function () {
  if (!CPU_MODE) return;
  const LEVEL = Math.min(3, Math.max(1, Number(CPU_PARAMS.get('cpu')) || 2));
  // 1回の操作のあとに待つ時間（ms）。人が見て追える速さにする
  const STEP_MS = LEVEL === 1 ? 1100 : 900;
  const chance = (p) => Math.random() < p;
  const pickRandom = (list) => list[Math.floor(Math.random() * list.length)];
  const cards = (zone) => game.zones[zone].map((i) => game.cards[i]);
  const cost = (c) => (typeof costOf === 'function' ? costOf(c) : Number(c.cost) || 0);
  const power = (c) => Number(c?.power) || 0;
  // 相手のクリーチャー（相手の画面から届いた公開情報）
  const theirs = () => oppBattlefield().filter((o) => o.isCreature);
  const oppShieldCount = () => opp?.state?.shields ?? 0;

  // 確認の画面（confirm・alert）は出さない
  window.confirm = () => true;
  window.alert = () => {};

  // ---------- 効果の選択（effects.js の fxChoose を置き換える） ----------
  // はい／いいえ：だいたい「はい」（弱いは半々）。
  // カードを選ぶ：選んだカードがどこからどこへ動くか（題の「（手札へ）」など）で、自分の得になるカードだけを選ぶ。
  //   相手のカード → 強いものから。自分のバトルゾーンのクリーチャーを手札・墓地などへ動かすのは損なので、選ばない
  //   （アクア・サーファーで自分自身を手札に戻さないように）。足りないとき（必ず選ぶとき）だけ、弱いものから選ぶ
  const DEST = Object.fromEntries(Object.entries(FX_TO).map(([k, v]) => [v, k]));
  function isGood(it, dest) {
    if (it.side === 'opp') return true;
    const from = zoneOf(it.iid);
    if (from === 'battlefield') return dest == null; // 選ぶだけ（パワーを上げるなど）は得、動かすのは損
    if (from === 'hand') return dest === 'battlefield';
    if (from === 'library' || from === 'graveyard') return dest === 'hand' || dest === 'battlefield' || dest === 'mana';
    if (from === 'mana') return dest === 'hand' || dest === 'battlefield';
    if (from === 'shields') return dest === 'hand';
    return dest == null;
  }
  fxChoose = function ({ title = '', items = [], min = 0, max = 0, buttons = null }) {
    return new Promise((resolve) => setTimeout(() => {
      if (buttons) return resolve(LEVEL === 1 && buttons.length > 1 && chance(0.4) ? 1 : 0);
      if (!items.length || max === 0) return resolve([]);
      const dest = DEST[title.match(/（([^（）]+)）\s*$/)?.[1]] ?? null;
      const value = (it) => power(it.card) / 1000 + cost(it.card);
      const good = items.filter((it) => isGood(it, dest));
      const bad = items.filter((it) => !isGood(it, dest)).sort((a, b) => value(a) - value(b));
      // 得になるカード：弱いはでたらめに、普通以上は強いものから
      const order = LEVEL === 1 ? [...good].sort(() => Math.random() - 0.5) : [...good].sort((a, b) => value(b) - value(a));
      const picked = order.slice(0, max);
      if (picked.length < min) picked.push(...bad.slice(0, min - picked.length));
      resolve(picked);
    }, STEP_MS / 2));
  };

  // ---------- 手番の判断 ----------

  // マナを払えるか（払えるならそのマナ）
  const payable = (c) => (typeof payCost === 'function' ? payCost(c) : null);
  // 進化元にできるクリーチャー（種族が同じもの）
  function evolutionBase(c) {
    const races = String(c.race ?? '').split(/[／/・]/).filter(Boolean);
    const bases = cards('battlefield').filter((b) => b.isCreature && races.some((r) => String(b.race ?? '').includes(r)));
    return bases.sort((a, b) => power(b) - power(a))[0] ?? null;
  }

  // チャージするカード（なければ null）
  function chooseCharge() {
    const hand = cards('hand');
    if (!hand.length) return null;
    const mana = cards('mana');
    if (LEVEL === 1) return chance(0.75) ? pickRandom(hand) : null;
    // マナが十分あって手札が少なければチャージしない
    if (mana.length >= (LEVEL === 3 ? 7 : 8) && hand.length <= 2) return null;
    const haveCiv = (civ) => mana.some((m) => m.civs.includes(civ));
    const score = (c) => {
      let s = cost(c) * 2;
      // 同じカードが手札に2枚以上あれば、1枚はチャージしてよい
      if (hand.filter((h) => h.name === c.name).length > 1) s += 3;
      // 強い：まだマナにない文明のカードを優先して、文明をそろえる
      if (LEVEL === 3 && c.civs.some((v) => !haveCiv(v))) s += 4;
      // 今すぐ出せるカードは残す
      if (payable(c)) s -= 5;
      // S・トリガーは手札に残すより、シールドにあるほうが役に立つので、チャージしてもよい
      if (c.ab?.sTrigger) s += 1;
      return s;
    };
    return [...hand].sort((a, b) => score(b) - score(a))[0];
  }

  // クリーチャーを狙う呪文（破壊・手札に戻す・タップ・マナや墓地に送る など）
  const TARGETS_CREATURE = /クリーチャー[^。]*(破壊|手札に戻|タップ|マナゾーンに置|墓地に置|山札|シールド)/;
  // 相手のクリーチャーがいないときに使っても意味のない呪文か（どの強さでも使わない）
  const AIMS_AT = /相手のクリーチャー|相手クリーチャー|相手の「ブロッカー」|相手の光のクリーチャー|クリーチャーを[12１２]体|クリーチャー(を)?すべて|すべてのクリーチャー/;
  const wasted = (c) => {
    const t = c.text ?? '';
    if (!c.isSpell || theirs().length || !TARGETS_CREATURE.test(t) || !AIMS_AT.test(t)) return false;
    // 自分のクリーチャー・墓地・マナを対象にする呪文（相手のクリーチャーに触れないもの）は、相手のクリーチャーがいなくても使える
    const toOpp = /相手のクリーチャー|相手クリーチャー|相手の「ブロッカー」|相手の光のクリーチャー/.test(t);
    if (!toOpp && /自分の(墓地|マナゾーン|[^、。]{0,4}クリーチャー)/.test(t)) return false;
    // 相手のマナを減らす呪文（竜脈噴火など）は、相手のクリーチャーがいなくても使える
    return !(/相手のマナゾーン/.test(t) && !/相手のクリーチャー/.test(t));
  };

  // 出すカード（なければ null）
  function choosePlay() {
    const hand = cards('hand').filter((c) => !(typeof spellLocked === 'function' && spellLocked(c)) && payable(c) && !wasted(c));
    const usable = hand.filter((c) => !(c.ab?.evolution && c.isCreature) || evolutionBase(c));
    if (!usable.length) return null;
    if (LEVEL === 1) return chance(0.7) ? pickRandom(usable) : null;
    const score = (c) => {
      let s = cost(c) * 10 + power(c) / 1000;
      if (LEVEL === 3) {
        // ブロッカーは、自分のシールドが少ないときに優先
        if (c.ab?.blocker && game.zones.shields.length <= 2) s += 15;
      }
      return s;
    };
    return [...usable].sort((a, b) => score(b) - score(a))[0];
  }

  // 攻撃する（クリーチャーと攻撃先）。なければ null
  function chooseAttack() {
    const attackers = cards('battlefield').filter((c) => canAttackNow(c) && attackTargets(c).length);
    if (!attackers.length) return null;
    const must = mustAttackers();
    if (LEVEL === 1) {
      if (!must.length && !chance(0.7)) return null;
      const c = pickRandom(must.length ? must : attackers);
      return { c, target: pickRandom(attackTargets(c))[1] };
    }
    const blockersThere = theirs().filter((o) => o.ab?.blocker && !o.tapped);
    const shields = oppShieldCount();
    const mineAtk = (c) => attackPower(c);
    // 強い：とどめを刺せるだけ攻撃できるなら、全員でプレイヤーを攻撃する
    const lethal = LEVEL === 3 && attackers.length > shields + blockersThere.length;
    // 強い：自分のシールドが少ないときは、ブロッカーを守りに残す
    const keep = (c) => LEVEL === 3 && !lethal && c.ab?.blocker && game.zones.shields.length <= 1 && theirs().some((o) => !o.tapped);
    const plans = [];
    for (const c of attackers) {
      if (keep(c) && !must.includes(c)) continue;
      for (const [, target] of attackTargets(c)) {
        let s;
        if (target === 'player') {
          s = shields === 0 ? 1000 : 10;
          // ブロッカーに倒されそうなら控える（普通以上）
          const killer = blockersThere.some((b) => power(b) >= mineAtk(c));
          if (killer && !lethal) s -= 25;
          if (lethal) s += 50;
        } else {
          const o = theirs().find((x) => x.iid === target);
          if (!o) continue;
          // 勝てるバトルだけ（相打ちは強いなら相手のほうが強いカードのとき）
          if (mineAtk(c) > power(o)) s = 20 + power(o) / 1000;
          else if (mineAtk(c) === power(o) && LEVEL === 3 && power(o) >= power(c)) s = 12;
          else s = -100;
        }
        plans.push({ c, target, s });
      }
    }
    plans.sort((a, b) => b.s - a.s);
    const best = plans[0];
    if (!best) return null;
    if (best.s <= 0 && !must.includes(best.c)) return null;
    return best;
  }

  // ブロックするか（ブロックするクリーチャー、しなければ null）
  function chooseBlock() {
    const a = oppBattlefield().find((o) => o.iid === incomingAttack.attacker);
    const list = blockers(a);
    if (!list.length) return null;
    if (LEVEL === 1) return chance(0.3) ? pickRandom(list) : null;
    const atk = power(a) + (a?.ab?.powerAttacker || 0);
    const toPlayer = incomingAttack.target === 'player';
    const shields = game.zones.shields.length;
    const winners = list.filter((b) => power(b) > atk).sort((x, y) => power(x) - power(y));
    if (winners.length) return winners[0];
    // とどめを刺されるときは、何でもブロック
    if (toPlayer && shields === 0) return [...list].sort((x, y) => power(x) - power(y))[0];
    // 強い：シールドが少ない・相打ちできるときもブロック
    if (LEVEL === 3) {
      const trades = list.filter((b) => power(b) === atk);
      if (trades.length) return trades[0];
      if (toPlayer && (shields <= 2 || (a?.ab?.breaker ?? 1) >= 2)) return [...list].sort((x, y) => power(x) - power(y))[0];
    } else if (toPlayer && shields <= 1) {
      return [...list].sort((x, y) => power(x) - power(y))[0];
    }
    return null;
  }

  // 割る相手のシールド（左から数えた番号）
  function chooseShield(pick) {
    const total = oppShieldCount();
    const planted = opp?.state?.plantedShields ?? [];
    const free = Array.from({ length: total }, (_, i) => i).filter((i) => !pick.picked.includes(i));
    if (LEVEL === 1) return pickRandom(free);
    // 強い：相手が仕込んだシールドは後回し（S・トリガーかもしれない）
    const order = LEVEL === 3 ? [...free.filter((i) => !planted.includes(i)), ...free.filter((i) => planted.includes(i))] : free;
    return order[0];
  }

  // 自分のマナから支払うマナを選んでタップし、出す（play.js は選んだマナで払う）
  function play(c) {
    const pay = payable(c);
    if (!pay) return false;
    for (const m of pay) m.tapped = true;
    game.manaPool = pay.map((m) => m.iid);
    if (c.ab?.evolution && c.isCreature) evolve(c.iid, evolutionBase(c).iid);
    else playFromHand(c.iid);
    return true;
  }

  // ---------- 1回ずつ、今できることを1つだけする ----------
  let lastKey = '';
  let sameCount = 0;
  function tick() {
    if (!game || game.result || !game.dealt || typeof fxBusy !== 'function' || fxBusy()) return;
    // S・トリガー・ブレイクしたシールドの確認
    const trig = (game.triggers ?? []).find((iid) => zoneOf(iid) === 'hand');
    if (trig != null) {
      const c = game.cards[trig];
      if (!isTrigger(trig)) return confirmShield(trig);
      if (spellLocked(c) || wasted(c) || (LEVEL === 1 && chance(0.3))) return skipTrigger(trig);
      return useTrigger(trig);
    }
    // 相手の攻撃：ブロックするか（ブロックできるクリーチャーがいなければ play.js が自動で「ブロックしない」）
    if (incomingAttack) {
      const a = oppBattlefield().find((o) => o.iid === incomingAttack.attacker);
      if (blockers(a).length) respondAttack(chooseBlock()?.iid ?? null);
      return;
    }
    // 割るシールドを選ぶ
    if (game.attack?.pick) return pickShield(chooseShield(game.attack.pick));
    // 自動で処理できない呪文は、そのまま処理を終える
    if (resolving().length) return finishSpell(resolving()[0]);
    if (!myTurn() || busy()) return;

    // 同じ状態で何度も同じことを試しているときは、ターンを終える（止まらないように）
    const key = `${game.turn}:${game.phase}:${game.zones.hand.length}:${game.zones.battlefield.length}:${game.zones.mana.length}`;
    sameCount = key === lastKey ? sameCount + 1 : 0;
    lastKey = key;
    if (sameCount > 6) return endTurn();

    if (game.phase === 'start' || game.phase === 'draw') return goToPhase('charge');
    if (game.phase === 'charge') {
      const c = game.charged < CHARGES_PER_TURN ? chooseCharge() : null;
      if (c) return chargeMana(c.iid);
      return goToPhase('main');
    }
    if (game.phase === 'main') {
      const c = choosePlay();
      if (c && play(c)) return;
      if (canAnyAttack()) return goToPhase('attack');
      return endTurn();
    }
    if (game.phase === 'attack') {
      const plan = chooseAttack();
      if (plan) return declareAttack(plan.c.iid, plan.target);
      return endTurn();
    }
  }

  setInterval(() => {
    try { tick(); } catch (e) { console.error(e); }
  }, STEP_MS);
})();
