// デュエマ System — カードの効果の自動処理（クラシック基本編）
// FX[カード名] = { cast: 呪文を唱えたとき, summon: バトルゾーンに出たとき, attack: 攻撃するとき, death: バトルゾーンから墓地に置かれたとき }
// それぞれ async (x) => {...}。x（fxApi）は、カードを選ぶ・引く・移すなどの操作をまとめたもの。
// 相手のカードを動かすときは相手に「fx」メッセージを送り、相手の画面で動かす（相手が選ぶものは相手の画面で選ぶ）。
// FX にない効果（常在型能力・コストの増減など）は、これまでどおり手で処理する。
// play.js より先に読み込む（ここの関数は play.js の game・act・moveCard などを、呼ばれたときに使う）。

// ---------- カードごとの効果 ----------

const fxOpp1 = (to, f = {}, o = {}) => (x) => x.pick({ side: 'opp', f, n: 1, to, ...o });
const fxDraw = (n) => (x) => x.draw(n, { may: true });
const fxSearch = (f = {}, o = {}) => (x) => x.search({ f, ...o });
const myShieldToGrave = (x) => x.pick({ zone: 'shields', n: 1, to: 'graveyard' });
// 各プレイヤーが自分のカードを選ぶ（自分はここで選び、相手には相手の画面で選んでもらう）
const eachChooses = (zone, n, to, f = {}) => async (x) => {
  await x.pick({ zone, n, to, f });
  x.oppChoose({ zone, n, to, f });
};
// 自分の他のクリーチャーを n 体墓地に置く。置けなければ、このクリーチャーを墓地に置く
const sacrificeOrSelf = (n) => async (x) => {
  if (x.count('me', 'battlefield', { other: true }) < n) return x.selfTo('graveyard');
  await x.pick({ f: { other: true }, n, to: 'graveyard' });
};

const FX = {
  // ---- バトルゾーンに出たとき ----
  '真理の伝道師レイーラ': { summon: fxSearch({ spell: true }) },
  'キング・ポセイドン': { summon: fxDraw(2) },
  'アクア・ハルカス': { summon: fxDraw(1) },
  '磁力の使徒マグリス': { summon: fxDraw(1) },
  'アストラル・リーフ': { summon: fxDraw(3) },
  'ミラージュ・マーメイド': { summon: (x) => x.count('me', 'battlefield', { race: 'サイバーロード' }) && x.draw(3, { may: true }) },
  '妖姫シルフィ': { summon: (x) => x.all({ side: 'any', f: { maxPower: 3000 }, to: 'graveyard' }) },
  'ギガルゴン': { summon: (x) => x.pick({ zone: 'graveyard', f: { creature: true }, n: 2, upTo: true, to: 'hand' }) },
  'トゲ刺しマンドラ': { summon: (x) => x.pick({ zone: 'graveyard', f: { creature: true }, n: 1, may: true, to: 'mana' }) },
  'ソーサーヘッド・シャーク': { summon: (x) => x.all({ side: 'any', f: { maxPower: 2000 }, to: 'hand' }) },
  '一角魚': { summon: (x) => x.pick({ side: 'any', n: 1, may: true, to: 'hand' }) },
  'アクア・バウンザー': { summon: (x) => x.pick({ side: 'any', n: 1, may: true, to: 'hand' }) },
  'キング・マゼラン': { summon: (x) => x.pick({ side: 'any', n: 1, may: true, to: 'hand' }) },
  'アクア・サーファー': { summon: (x) => x.pick({ side: 'any', n: 1, may: true, to: 'hand' }) },
  'アクア・スナイパー': { summon: (x) => x.pick({ side: 'any', n: 2, upTo: true, to: 'hand' }) },
  'ギガベロス': { summon: sacrificeOrSelf(2) },
  '凶食虫スティンガーワーム': { summon: sacrificeOrSelf(1) },
  '怒りの影ブラック・フェザー': { summon: sacrificeOrSelf(1) },
  '爆勇士ユーカーン': { summon: (x) => x.pick({ zone: 'mana', n: 2, to: 'graveyard' }) },
  '強襲兵ギガントス': { summon: (x) => x.pick({ zone: 'mana', n: 1, to: 'graveyard' }) },
  '職人ピコラ': { summon: (x) => x.pick({ zone: 'mana', n: 1, to: 'graveyard' }) },
  '銃神兵ディオライオス': { summon: eachChooses('battlefield', 1, 'graveyard') },
  'シェル・ストーム': { summon: (x) => x.oppChoose({ zone: 'battlefield', n: 1, to: 'mana' }) },
  '腐食虫スワンプワーム': { summon: (x) => x.oppChoose({ zone: 'battlefield', n: 1, to: 'graveyard' }) },
  '嘲りの影マスクド・ホラー': { summon: (x) => x.discardRandom(1) },
  '汽車男': { summon: (x) => x.discardRandom(1) },
  'メテオザウルス': { summon: fxOpp1('graveyard', { maxPower: 2000 }, { may: true }) },
  '超巨岩獣ドボルガイザー': { summon: fxOpp1('graveyard', { maxPower: 3000 }, { may: true }) },
  '魔獣虫カオス・ワーム': { summon: fxOpp1('graveyard', {}, { may: true }) },
  'シビレアシダケ': { summon: (x) => x.pick({ zone: 'hand', n: 1, may: true, to: 'mana' }) },
  '雷光の使徒ミール': { summon: fxOpp1('tap', {}, { may: true }) },
  '預言者フィンチ': { summon: fxOpp1('tap', {}, { may: true }) },
  '予言者コロン': { summon: fxOpp1('tap', {}, { may: true }) },
  '青銅の鎧': { summon: (x) => x.top(1, 'mana') },
  '大勇者「ふたつ牙」': { summon: (x) => x.top(2, 'mana') },
  'クリムゾン・ワイバーン': { summon: (x) => x.all({ side: 'any', f: { blocker: true }, to: 'graveyard' }) },
  '暁の守護者ファル・イーガ': { summon: (x) => x.pick({ zone: 'graveyard', f: { spell: true }, n: 1, may: true, to: 'hand' }) },
  '毒煙虫ポイズン・ワーム': { summon: (x) => x.pick({ f: { maxPower: 3000 }, n: 1, to: 'graveyard' }) },
  'シェル・フォートレス': { summon: (x) => x.pick({ side: 'opp', zone: 'mana', n: 2, upTo: true, to: 'graveyard' }) },
  '鳴動するギガ・ホーン': { summon: fxSearch({ creature: true }) },
  '守護聖天ラルバ・ギア': { summon: (x) => x.all({ side: 'opp', f: { blocker: true }, to: 'tap' }) },
  'コーライル': { summon: fxOpp1('library') },
  'アクア・デフォーマー': { summon: eachChooses('mana', 2, 'hand') },
  'シュトラ': { summon: eachChooses('mana', 1, 'hand') },
  '邪剣バラガ': { summon: (x) => x.pick({ zone: 'shields', n: 1, to: 'hand' }) },
  '閃光の使徒レーナ': { summon: (x) => x.pick({ zone: 'mana', f: { spell: true }, n: 1, may: true, to: 'hand' }) },
  '光翼の精霊サイフォス': { summon: (x) => x.pick({ zone: 'mana', f: { spell: true }, n: 1, may: true, to: 'hand' }) },
  'エメラル': {
    summon: async (x) => {
      const put = await x.pick({ zone: 'hand', n: 1, may: true, to: 'shields', title: '手札を1枚シールドに加えますか？（加えたら、シールドを1枚手札に加えます）' });
      if (put.length) await x.pick({ zone: 'shields', n: 1, to: 'hand' });
    },
  },
  '凶骨の邪将クエイクス': { summon: (x) => x.discardRandom(x.count('me', 'battlefield', { civ: '闇', other: true })) },
  'アクアン': {
    summon: async (x) => {
      if (await x.ask('山札の上から5枚を表向きにしますか？（光と闇のカードを手札に、ほかを墓地に）')) x.reveal(5, { civ: ['光', '闇'] });
    },
  },
  'マグマティラノス': { summon: (x) => x.all({ side: 'any', f: { power: 1000 }, to: 'graveyard' }) },
  '彗星の精霊リムエル': {
    summon: (x) => x.pick({ side: 'opp', n: x.count('me', 'mana', { civ: '光', untapped: true }), upTo: true, to: 'tap' }),
  },
  'キング・アクアカムイ': {
    summon: async (x) => {
      const f = { race: ['エンジェル・コマンド', 'デーモン・コマンド'] };
      if (x.count('me', 'graveyard', f) && await x.ask('墓地のエンジェル・コマンドとデーモン・コマンドをすべて手札に戻しますか？')) {
        x.all({ zone: 'graveyard', f, to: 'hand' });
      }
    },
  },
  '悪魔神バロム': { summon: (x) => x.all({ side: 'any', f: { notCiv: '闇' }, to: 'graveyard' }) },
  'ガルクライフ・ドラゴン': { summon: (x) => x.all({ side: 'any', f: { civ: '光', maxPower: 4000 }, to: 'graveyard' }) },
  '護りの角フィオナ': { summon: fxSearch({ creature: true, civ: '自然' }, { may: true }) },
  'シザーズ・ビートル': { summon: fxSearch({ race: 'ジャイアント・インセクト' }, { may: true }) },
  '闇をあばく者スケルトン・シーフ': { summon: (x) => x.pick({ zone: 'graveyard', f: { race: 'リビング・デッド' }, n: 1, may: true, to: 'hand' }) },
  '光魂の伝道士クルス': { summon: (x) => x.oppCount('mana') > x.count('me', 'mana') && x.top(1, 'mana') },
  '岩肌魚': { summon: (x) => x.pick({ zone: 'mana', n: 1, to: 'hand' }) },
  'キング・アトランティス': { summon: (x) => x.all({ side: 'any', f: { other: true }, to: 'hand' }) },
  '殺戮の羅刹デス・クルーザー': { summon: (x) => x.all({ f: { other: true }, to: 'graveyard' }) },

  // ---- 攻撃するとき ----
  'プラズマ・チェイサー': { attack: (x) => x.draw(x.oppCount('battlefield'), { may: true }) },
  '暗黒巨兵マギン': { attack: (x) => x.discardRandom(1) },
  '卵胞虫ゼリー・ワーム': { attack: (x) => x.discardRandom(1) },
  'ボルザード・ドラゴン': { attack: (x) => x.pick({ side: 'opp', zone: 'mana', n: 1, to: 'graveyard' }) },
  '閃光の伝道師ラグナ': { attack: fxSearch({ spell: true }, { may: true }) },
  'ウォルタ': { attack: fxDraw(1) },
  'ツインヘッド・タートルβ': { attack: fxDraw(1) },
  '魔将ダーク・フリード': { attack: myShieldToGrave },
  'アンバー・ピアス': { attack: (x) => x.pick({ zone: 'graveyard', f: { creature: true }, n: 1, may: true, to: 'hand' }) },
  'メタルウィング・ワイバーン': { attack: fxOpp1('graveyard', { blocker: true }) },
  '予言者ウィン': { attack: (x) => x.peekShields(1, { may: true }) },
  'スティンガー・ボール': { attack: (x) => x.peekShields(1, { may: true }) },
  'ステンドグラス': { attack: (x) => x.pick({ side: 'any', f: { civ: ['火', '自然'] }, n: 1, may: true, to: 'hand' }) },
  'キング・ネプタス': { attack: (x) => x.pick({ side: 'any', f: { maxPower: 2000 }, n: 1, may: true, to: 'hand' }) },
  '憎悪の騎士ガミル': { attack: (x) => x.pick({ zone: 'graveyard', f: { creature: true, civ: '闇' }, n: 1, may: true, to: 'hand' }) },
  'フレムトロプス': {
    attack: async (x) => {
      const paid = await x.pick({ zone: 'mana', n: 1, may: true, to: 'graveyard', title: 'マナを1枚墓地に置いて「パワーアタッカー+3000」と「W・ブレイカー」を得ますか？' });
      if (paid.length) x.buff([x.src], { pa: 3000, breaker: 2 });
    },
  },
  'マボロシキリダケ': { attack: (x) => x.pick({ zone: 'graveyard', f: { civ: '自然' }, n: 1, may: true, to: 'mana' }) },
  '雷電の求道者ラ・ビュー': { attack: (x) => x.pick({ zone: 'graveyard', f: { spell: true, civ: '光' }, n: 1, may: true, to: 'hand' }) },
  'キング・ボニータス': { attack: fxSearch({ civ: '水' }, { may: true }) },
  '切断伯爵ムラマサ': { attack: fxOpp1('graveyard', { maxPower: 2000 }, { may: true }) },
  '甲神兵クエロス': { attack: eachChooses('mana', 1, 'graveyard', { notCiv: '火' }) },
  'スナイプ・モスキート': { attack: (x) => x.pick({ zone: 'mana', n: 1, to: 'hand' }) },
  '混沌魚': { attack: (x) => x.drawUpTo(x.count('me', 'battlefield', { civ: '水', other: true })) },
  '天空の超人': { attack: (x) => x.all({ zone: 'mana', f: { creature: true }, to: 'hand' }) },
  'スマイル・アングラー': { attack: (x) => x.pick({ side: 'opp', zone: 'mana', n: 1, may: true, to: 'hand' }) },
  'スリーアイズ・ドラゴンフライ': {
    attack: async (x) => {
      const gone = await x.pick({ f: { other: true }, n: 1, may: true, to: 'graveyard', title: '自分の他のクリーチャーを1体墓地に置いて、パワー+2000と「W・ブレイカー」を得ますか？' });
      if (gone.length) x.buff([x.src], { power: 2000, breaker: 2 });
    },
  },
  'ダーク・ティアラγ': { attack: (x) => x.oppChoose({ zone: 'hand', n: 1, to: 'graveyard' }) },
  'ブラッドウイング・マンティス': { attack: (x) => x.pick({ zone: 'mana', f: { creature: true }, n: 2, to: 'hand' }) },
  '予言者レクイル': { attack: (x) => x.pick({ side: 'any', f: { civ: ['闇', '火'] }, n: 1, may: true, to: 'tap' }) },
  '銀の戦斧': { attack: async (x) => { if (await x.ask('山札の一番上をマナゾーンに置きますか？')) x.top(1, 'mana'); } },
  'シェル・ブリゲードγ': { attack: (x) => x.reveal(1, { race: 'サバイバー' }) },

  // ---- バトルゾーンから墓地に置かれたとき ----
  'ボマーザウルス': { death: eachChooses('mana', 2, 'graveyard') },
  '技師ピーポ': { death: eachChooses('mana', 1, 'graveyard') },
  'ボーン・ピアース': { death: (x) => x.pick({ zone: 'mana', f: { creature: true }, n: 1, may: true, to: 'hand' }) },
  '冥将ダムド': { death: (x) => x.all({ side: 'any', f: { maxPower: 3000 }, to: 'graveyard' }) },
  'オブシディアン・ビートル': { death: (x) => x.pick({ zone: 'mana', f: { name: 'オブシディアン・ビートル' }, n: 1, may: true, to: 'battlefield' }) },
  'アンブッシュ・スコーピオン': { death: (x) => x.pick({ zone: 'mana', f: { name: 'アンブッシュ・スコーピオン' }, n: 1, may: true, to: 'battlefield' }) },
  'スパイダー・ジュエル': { death: (x) => x.pick({ zone: 'shields', n: 1, may: true, to: 'hand' }) },
  'ギガスタンド': {
    death: async (x) => {
      const d = await x.pick({ zone: 'hand', n: 1, may: true, to: 'graveyard', title: '手札を1枚墓地に置いて、ギガスタンドを手札に戻しますか？' });
      if (d.length && zoneOf(x.src) === 'graveyard') x.selfTo('hand');
    },
  },

  // ---- 呪文 ----
  'ホーリー・スパーク': { cast: (x) => x.all({ side: 'opp', to: 'tap' }) },
  'レーザー・ウイング': { cast: async (x) => x.buff(await x.pick({ n: 2, upTo: true, title: 'このターン、ブロックされないクリーチャーを2体まで選んでください' }), { unblockable: true }) },
  'ソニック・ウイング': { cast: async (x) => x.buff(await x.pick({ n: 1, title: 'このターン、ブロックされないクリーチャーを選んでください' }), { unblockable: true }) },
  'テレポーテーション': { cast: (x) => x.pick({ side: 'any', n: 2, upTo: true, to: 'hand' }) },
  'スパイラル・ゲート': { cast: (x) => x.pick({ side: 'any', n: 1, to: 'hand' }) },
  'クリスタル・メモリー': { cast: fxSearch() },
  'デーモン・ハンド': { cast: fxOpp1('graveyard') },
  'ブラック・スレイヤー': { cast: (x) => x.turnFx('blackSlayer', true) },
  'マグマ・ゲイザー': { cast: async (x) => x.buff(await x.pick({ n: 1, title: '「パワーアタッカー+4000」と「W・ブレイカー」を得るクリーチャーを選んでください' }), { pa: 4000, breaker: 2 }) },
  'カオス・ストライク': {
    cast: async (x) => {
      const t = await x.pick({ side: 'opp', n: 1, title: 'このターン、タップされていなくても攻撃できる相手のクリーチャーを選んでください' });
      if (t.length) x.turnFx('attackable', [...(game.turnFx?.attackable ?? []), t[0].iid]);
    },
  },
  'ナチュラル・トラップ': { cast: fxOpp1('mana') },
  'オーラ・ブラスター': { cast: (x) => x.buffAll({ pa: 2000 }) },
  'ムーンライト・フラッシュ': { cast: (x) => x.pick({ side: 'opp', n: 2, upTo: true, to: 'tap' }) },
  'サイバー・ブレイン': { cast: (x) => x.drawUpTo(3) },
  'ダーク・リバース': { cast: (x) => x.pick({ zone: 'graveyard', f: { creature: true }, n: 1, to: 'hand' }) },
  'トルネード・フレーム': { cast: fxOpp1('graveyard', { maxPower: 4000 }) },
  'ガイアズ・ソング': { cast: (x) => x.pick({ n: 1, to: 'mana' }) },
  'ソーラー・レイ': { cast: fxOpp1('tap') },
  'エレメンタル・トラップ': { cast: fxOpp1('tap') },
  'デス・スモーク': { cast: fxOpp1('graveyard', { untapped: true }) },
  'ゴースト・タッチ': { cast: (x) => x.discardRandom(1) },
  'クリムゾン・ハンマー': { cast: fxOpp1('graveyard', { maxPower: 2000 }) },
  'バーニング・パワー': { cast: async (x) => x.buff(await x.pick({ n: 1, title: 'このターンの攻撃中、パワー+2000するクリーチャーを選んでください' }), { pa: 2000 }) },
  'アルティメット・フォース': { cast: (x) => x.top(2, 'mana') },
  'ディメンジョン・ゲート': { cast: fxSearch({ creature: true }) },
  'ダイヤモンド・カッター': { cast: (x) => x.buffAll({ freeAttack: true }) },
  'ディープ・オペレーション': { cast: (x) => x.draw(x.oppCount('battlefield')) },
  'ロスト・ソウル': { cast: (x) => x.oppAll('hand', 'graveyard') },
  'バースト・ショット': { cast: (x) => x.all({ side: 'any', f: { maxPower: 2000 }, to: 'graveyard' }) },
  'マナ・クライシス': { cast: (x) => x.pick({ side: 'opp', zone: 'mana', n: 1, to: 'graveyard' }) },
  'ロジック・キューブ': { cast: fxSearch({ spell: true }) },
  'マインド・サーチ': { cast: (x) => x.peekShields(3, { upTo: true }) },
  'クリティカル・ブレード': { cast: fxOpp1('graveyard', { blocker: true }) },
  'クエイク・ゲート': { cast: (x) => x.buffAll({ power: 1000, attackUntapped: true }) },
  'レインボー・ストーン': { cast: fxSearch({}, { to: 'mana' }) },
  'プロテクト・キューブ': { cast: (x) => x.pick({ zone: 'mana', f: { spell: true }, n: 1, to: 'hand' }) },
  'ストリーミング・シェイパー': { cast: (x) => x.reveal(4, { civ: '水' }) },
  'デビル・ドレーン': { cast: (x) => x.pick({ zone: 'shields', n: 99, upTo: true, to: 'hand' }) },
  'ブレイズ・キャノン': {
    cast: (x) => {
      const mana = game.zones.mana.map((i) => game.cards[i]);
      if (mana.length && mana.every((c) => c.civs.includes('火'))) x.buffAll({ pa: 4000, breaker: 2 });
      else x.note('マナゾーンのカードがすべて火ではないので、効果はありません');
    },
  },
  '逆転のオーロラ': { cast: (x) => x.pick({ zone: 'shields', n: 99, upTo: true, to: 'mana' }) },
  'ライト・ブーメラン': {
    cast: async (x) => {
      x.selfTo('mana');
      await x.pick({ zone: 'mana', n: 1, to: 'hand' });
    },
  },
  'ハイパー・ウェーブ': { cast: (x) => x.pick({ zone: 'mana', n: 1, to: 'hand' }) },
  '魔流毒': {
    cast: async (x) => {
      await x.pick({ f: { civ: '闇' }, n: 1, to: 'graveyard' });
      await x.pick({ zone: 'mana', f: { creature: true }, n: 1, to: 'hand' });
    },
  },
  '灼熱波': {
    cast: async (x) => {
      x.all({ side: 'opp', f: { maxPower: 3000 }, to: 'graveyard' });
      await myShieldToGrave(x);
    },
  },
  '深緑の魔方陣': { cast: (x) => x.pick({ zone: 'mana', n: 1, to: 'shields' }) },
  'ホーリー・メール': { cast: (x) => x.pick({ zone: 'hand', n: 1, to: 'shields' }) },
  'リキッド・スコープ': { cast: async (x) => { await x.peekHand(); await x.peekShields(99, { all: true }); } },
  'スネークアタック': {
    cast: async (x) => {
      x.buffAll({ breaker: 2 });
      await myShieldToGrave(x);
    },
  },
  'ボルカニック・アロー': {
    cast: async (x) => {
      await x.pick({ side: 'any', f: { maxPower: 6000 }, n: 1, to: 'graveyard' });
      await myShieldToGrave(x);
    },
  },
  '大地の咆哮': { cast: (x) => x.pick({ zone: 'mana', f: { creature: true, minCost: 6 }, n: 1, to: 'hand' }) },
  'フル・ディフェンサー': { cast: (x) => x.buffAll({ guard: true }) },
  'ハイドロ・ハリケーン': {
    cast: async (x) => {
      await x.pick({ side: 'opp', n: x.count('me', 'battlefield', { civ: '闇' }), upTo: true, to: 'hand' });
      await x.pick({ side: 'opp', zone: 'mana', n: x.count('me', 'battlefield', { civ: '光' }), upTo: true, to: 'hand' });
    },
  },
  'いけにえの鎖': {
    cast: async (x) => {
      await x.pick({ side: 'opp', n: 2, upTo: true, to: 'graveyard' });
      await x.pick({ n: 1, to: 'graveyard' });
    },
  },
  'メガ・ブラスター': {
    cast: async (x) => {
      const d = await x.pick({ zone: 'hand', n: 99, upTo: true, to: 'graveyard', title: '墓地に置く手札を選んでください（同じ数のクリーチャーが「W・ブレイカー」を得ます）' });
      if (d.length) x.buff(await x.pick({ n: d.length, title: `「W・ブレイカー」を得るクリーチャーを${d.length}体選んでください` }), { breaker: 2 });
    },
  },
  'ミステリー・ブレス': { cast: (x) => x.top(1, 'shields') },
  'ブレス・ソード': { cast: (x) => x.buffAll({ power: 1000 * x.count('me', 'battlefield', { civ: '光' }) }) },
  'エンジェル・ソング': { cast: (x) => x.all({ side: 'any', f: { notCiv: '光' }, to: 'tap' }) },
  'ソウル・イーター': { cast: (x) => x.oppChoose({ zone: 'hand', n: x.oppCount('battlefield', { civ: '光' }), to: 'graveyard' }) },
  'デーモン・ソード': { cast: (x) => x.buffAll({ pa: 1000 * x.count('me', 'mana', { civ: '闇' }) }) },
  'ライト・ディフェンス': { cast: (x) => x.turnFx('untapAtEnd', true) },
  'クローン・ファクトリー': { cast: (x) => x.pick({ zone: 'mana', n: 2, upTo: true, to: 'hand' }) },
  '悪魔の契約': {
    cast: async (x) => {
      const d = await x.pick({ zone: 'mana', n: 99, upTo: true, to: 'graveyard', title: '墓地に置くマナを選んでください（同じ枚数を引きます）' });
      if (d.length) x.draw(d.length);
    },
  },
  'グローリー・スノー': { cast: (x) => (x.oppCount('mana') > x.count('me', 'mana') ? x.top(2, 'mana') : x.note('相手のマナが自分より多くないので、効果はありません')) },
  '神々の逆流': {
    cast: (x) => {
      x.all({ zone: 'mana', to: 'hand' });
      x.oppAll('mana', 'hand');
    },
  },
  '竜脈噴火': { cast: (x) => x.pick({ side: 'opp', zone: 'mana', n: x.count('me', 'battlefield', { civ: '自然' }), upTo: true, to: 'graveyard' }) },
  'サンダー・ネット': { cast: (x) => x.pick({ side: 'opp', n: x.count('me', 'battlefield', { civ: '水' }), upTo: true, to: 'tap' }) },
  'ミラクル・サーチャー': { cast: (x) => x.turnFx('miracle', true) },
  '策略の手': { cast: (x) => x.peekHand({ discard: 1 }) },
  'サイクロン・パニック': {
    cast: (x) => {
      act(() => cycloneHand());
      x.send([{ op: 'cyclone' }]);
    },
  },
  '再誕の森': { cast: (x) => x.pick({ zone: 'graveyard', f: { creature: true }, n: 2, upTo: true, to: 'mana' }) },
  'ファントム・ベール': {
    cast: (x) => {
      if (!x.send([{ op: 'phantomVeil' }])) return x.note('相手がいないので省略');
      act(() => log(`${x.self.name}：${oppName()}の次のターン、攻撃できるクリーチャーはすべて攻撃しなければならない`));
    },
  },
  // ターンの終わりに処理する（endTurn が turnFx.beastCharge を見る）
  'ビースト・チャージ': { cast: (x) => x.turnFx('beastCharge', [...(game.turnFx?.beastCharge ?? []), x.src]) },
  'シェル・ポーチ': {
    summon: async (x) => {
      const t = await x.pick({ side: 'opp', f: { evolution: true }, n: 1, may: true, title: '一番上のカードを墓地に置く、相手の進化クリーチャーを選んでください' });
      if (t.length && x.send([{ op: 'evoTop', iid: t[0].iid }])) act(() => log(`${x.self.name}の効果で${oppName()}の${t[0].card.name}の一番上のカードを墓地へ`));
    },
  },

  // ---- ほかのクリーチャーが出た・墓地に置かれたとき（onOtherEnter・onOtherDie） ----
  '雷鳴の守護者ミスト・リエス': { otherEnter: fxDraw(1) },
  '屑男': { otherDie: fxDraw(1) },
};

// 自動で処理できる効果があるか（呪文は、なければ「処理完了」を手で押す）
const hasFx = (name, on) => !!FX[name]?.[on];

// ---------- 処理の順番 ----------

let fxRunning = 0;
let fxTail = Promise.resolve();
// moveCard が積む、あとで処理する効果 [{ iid, on }]（墓地に置かれたとき）
const fxQueue = [];
const fxBusy = () => fxRunning > 0;

// 効果は1つずつ順に処理する（選んでいる間に別の効果が割り込まない）
function fxSerial(fn) {
  const run = fxTail.then(async () => {
    fxRunning++;
    if (game) render();
    try {
      return await fn();
    } catch (e) {
      console.error(e);
      return false;
    } finally {
      fxRunning--;
      if (game) {
        render();
        if (!fxRunning) finishTriggers();
      }
    }
  });
  fxTail = run.catch(() => {});
  return run;
}

// カードの効果を処理する。効果がなければ false
function runFx(iid, on) {
  const c = game?.cards[iid];
  if (!c || !hasFx(c.name, on)) return Promise.resolve(false);
  return fxSerial(async () => {
    await FX[c.name][on](fxApi(iid));
    return true;
  });
}

// 積んである効果を処理する（act・netUpdate のあとで呼ぶ）
function drainFx() {
  while (fxQueue.length) {
    const { iid, on, run } = fxQueue.shift();
    if (run) fxSerial(run);
    else runFx(iid, on);
  }
}

// 呪文：効果を処理してから墓地へ（自動で処理できなければ「処理完了」を待つ）
async function castFx(iid) {
  if (await runFx(iid, 'cast')) finishSpell(iid);
}

// ---------- 対象 ----------

const FX_TO = { graveyard: '墓地へ', hand: '手札へ', mana: 'マナゾーンへ', shields: 'シールドへ', library: '山札の上へ', battlefield: 'バトルゾーンへ', tap: 'タップ' };
const fxPower = (c) => (Number(c.power) || 0) + (c.buff?.power || 0);
const fxList = (v) => [].concat(v);

function fxMatch(c, f = {}) {
  if (!c) return false;
  if (f.creature && !c.isCreature) return false;
  if (f.spell && !c.isSpell) return false;
  if (f.civ && !fxList(f.civ).some((v) => c.civs?.includes(v))) return false;
  if (f.notCiv && fxList(f.notCiv).some((v) => c.civs?.includes(v))) return false;
  if (f.maxPower != null && !(c.isCreature && fxPower(c) <= f.maxPower)) return false;
  if (f.power != null && !(c.isCreature && fxPower(c) === f.power)) return false;
  if (f.race && !fxList(f.race).some((r) => (c.race ?? '').includes(r))) return false;
  if (f.name && c.name !== f.name) return false;
  if (f.blocker && !abOf(c).blocker) return false;
  if (f.untapped && c.tapped) return false;
  if (f.minCost != null && !((Number(c.cost) || 0) >= f.minCost)) return false;
  if (f.evolution && !c.ab?.evolution) return false;
  return true;
}

// 選べるカード [{ side, iid, card }]。相手のカードは相手の公開情報（バトルゾーン・マナ・墓地）から
function fxCands(side, zone, f, src) {
  const out = [];
  if (side !== 'opp') {
    for (const iid of game.zones[zone] ?? []) {
      if (f?.other && iid === src) continue;
      if (fxMatch(game.cards[iid], f)) out.push({ side: 'me', iid, card: game.cards[iid] });
    }
  }
  if (side !== 'me' && online()) {
    const list = opp?.state?.[zone];
    for (const c of Array.isArray(list) ? list : []) if (fxMatch(c, f)) out.push({ side: 'opp', iid: c.iid, card: c });
  }
  return out;
}

// ---------- 効果の操作（x） ----------

function fxApi(src) {
  const self = game.cards[src];
  const note = (text) => act(() => log(`${self.name}：${text}`));
  const send = (ops) => {
    if (!Net.connected()) return false;
    Net.send({ type: 'fx', src: self.name, ops });
    return true;
  };
  // 選んだカードを移す・タップする（相手のカードは相手に送る）
  const apply = (refs, to) => {
    const mine = refs.filter((r) => r.side === 'me').map((r) => r.iid);
    const theirs = refs.filter((r) => r.side === 'opp');
    if (mine.length) {
      act(() => {
        for (const iid of mine) {
          const c = game.cards[iid];
          if (to === 'tap') {
            c.tapped = true;
            log(`${self.name}の効果で${c.name}をタップ`);
          } else {
            moveCard(iid, to, { destroy: zoneOf(iid) === 'battlefield' && to === 'graveyard' });
          }
        }
        if (to === 'tap') Sound.play('tap');
      });
    }
    if (theirs.length && send([{ op: to === 'tap' ? 'tap' : 'move', iids: theirs.map((r) => r.iid), to }])) {
      act(() => log(`${self.name}の効果で${oppName()}の${theirs.map((r) => r.card.name).join('、')}を${FX_TO[to]}`));
    }
  };
  const x = {
    src,
    self,
    note,
    send,
    count: (side, zone, f) => fxCands(side, zone, f, src).length,
    // 相手のカードの枚数（バトルゾーン・マナは公開情報から数える）
    oppCount: (zone, f) => {
      if (!online()) return 0;
      const list = opp?.state?.[zone];
      return Array.isArray(list) ? list.filter((c) => fxMatch(c, f)).length : Number(list) || 0;
    },
    async draw(n, { may = false } = {}) {
      if (n <= 0) return note('引くカードはありません');
      if (may && !(await fxAsk(self, `カードを${n}枚引きますか？`))) return;
      act(() => drawCards(n));
    },
    async drawUpTo(n) {
      if (n <= 0) return note('引くカードはありません');
      const k = await fxButtons(self, `カードを何枚引きますか？（${n}枚まで）`, Array.from({ length: n + 1 }, (_, i) => `${i}枚`));
      if (k) act(() => drawCards(k));
    },
    ask: (text) => fxAsk(self, text),
    // カードを選ぶ。to があれば、選んだカードをそこへ移す。選んだカードを返す
    async pick({ side = 'me', zone = 'battlefield', f = {}, n = 1, upTo = false, may = false, to = null, title = null }) {
      const list = fxCands(side, zone, f, src);
      if (!list.length || n <= 0) {
        note('選べるカードがありません');
        return [];
      }
      const max = Math.min(n, list.length);
      const where = side === 'opp' ? `${oppName()}の${ZONES[zone]}` : side === 'any' ? ZONES[zone] : `自分の${ZONES[zone]}`;
      const count = n >= 99 ? '好きな枚数' : `${max}${zone === 'battlefield' ? '体' : '枚'}${upTo ? 'まで' : ''}`;
      const picked = await fxChoose({
        src: self,
        title: title ?? `${where}から${count}選んでください${to ? `（${FX_TO[to]}）` : ''}`,
        items: list,
        min: upTo || may ? 0 : max,
        max,
        hidden: zone === 'shields',
        skip: may ? '使わない' : null,
      });
      if (to && picked.length) apply(picked, to);
      return picked;
    },
    // 条件に合うカードすべて
    all({ side = 'me', zone = 'battlefield', f = {}, to }) {
      const list = fxCands(side, zone, f, src);
      if (!list.length) return note('対象のカードがありません');
      apply(list, to);
    },
    // 山札からさがす（そのあとシャッフル）
    async search({ f = {}, n = 1, to = 'hand', may = false } = {}) {
      const list = fxCands('me', 'library', f, src);
      const picked = list.length
        ? await fxChoose({ src: self, title: `山札から${n}枚選んでください（${FX_TO[to]}）`, items: list, min: may ? 0 : Math.min(n, list.length), max: Math.min(n, list.length), skip: may ? '加えない' : null })
        : [];
      act(() => {
        for (const r of picked) moveCard(r.iid, to);
        if (!list.length) log(`${self.name}：山札に対象のカードがない`);
        shuffle(game.zones.library);
        Sound.play('shuffle');
        log('山札をシャッフル');
      });
    },
    // 山札の上から n 枚を移す
    top(n, to) {
      act(() => {
        const ids = game.zones.library.slice(0, n);
        for (const iid of ids) moveCard(iid, to, { silent: true });
        log(`${self.name}の効果で山札の上から${ids.length}枚を${ZONES[to]}へ${to === 'shields' ? '' : `：${ids.map((i) => game.cards[i].name).join('、')}`}`);
        checkDeckOut();
      });
    },
    // 山札の上から n 枚を表向きにして、条件に合うものを手札、ほかを墓地へ
    reveal(n, f) {
      act(() => {
        const ids = game.zones.library.slice(0, n);
        const hit = ids.filter((i) => fxMatch(game.cards[i], f));
        for (const iid of ids) moveCard(iid, hit.includes(iid) ? 'hand' : 'graveyard', { silent: true });
        const names = (list) => list.map((i) => game.cards[i].name).join('、') || 'なし';
        log(`${self.name}：山札の上から${ids.length}枚を表向きに。手札へ：${names(hit)}／墓地へ：${names(ids.filter((i) => !hit.includes(i)))}`);
        checkDeckOut();
      });
    },
    // 相手の手札から見ないで選んで捨てさせる
    discardRandom(n) {
      if (n <= 0) return note('捨てさせるカードはありません');
      if (!send([{ op: 'discardRandom', n }])) return note('相手がいないので、相手の手札の効果は省略');
      act(() => log(`${self.name}の効果で${oppName()}の手札を${n}枚、見ないで選んで墓地へ`));
    },
    // 相手が自分のカードを選ぶ（相手の画面で選ぶ）
    oppChoose({ zone, n, to, f = {} }) {
      if (n <= 0) return;
      if (!send([{ op: 'choose', zone, n, to, f }])) return note('相手がいないので、相手が選ぶ効果は省略');
      act(() => log(`${self.name}の効果で${oppName()}が${ZONES[zone]}から${n}枚選んで${FX_TO[to]}`));
    },
    // 相手の領域のカードすべて
    oppAll(zone, to) {
      if (!send([{ op: 'all', zone, to }])) return note('相手がいないので、相手の効果は省略');
      act(() => log(`${self.name}の効果で${oppName()}の${ZONES[zone]}のカードすべてを${FX_TO[to]}`));
    },
    // 相手のシールドを見る（n 枚まで選ぶ。all ならすべて）
    async peekShields(n, { may = false, upTo = false, all = false } = {}) {
      const total = online() ? opp?.state?.shields ?? 0 : 0;
      if (!total || !Net.connected()) return note('見られる相手のシールドがありません');
      let idx = Array.from({ length: total }, (_, i) => i);
      if (!all) {
        const backs = idx.map((i) => ({ side: 'opp', iid: i, card: { name: `シールド${i + 1}` } }));
        const max = Math.min(n, total);
        const picked = await fxChoose({ src: self, title: `${oppName()}のシールドから、見るものを${max}枚${upTo || may ? 'まで' : ''}選んでください`, items: backs, min: upTo || may ? 0 : max, max, hidden: true, skip: may ? '見ない' : null });
        idx = picked.map((r) => r.iid);
        if (!idx.length) return;
      }
      const cards = await requestPeek('shields', idx);
      act(() => log(`${self.name}の効果で${oppName()}のシールドを${idx.length}枚見た`));
      if (cards) await fxShow(self, `${oppName()}のシールド（左から${idx.map((i) => i + 1).join('・')}枚目）`, cards);
    },
    // 相手の手札を見る（discard：その中から選んで捨てさせる枚数）
    async peekHand({ discard = 0 } = {}) {
      if (!Net.connected()) return note('相手がいないので、相手の手札の効果は省略');
      const cards = await requestPeek('hand');
      if (!cards) return note('相手の手札を見られませんでした');
      act(() => log(`${self.name}の効果で${oppName()}の手札を見た`));
      if (!discard) return fxShow(self, `${oppName()}の手札`, cards);
      if (!cards.length) return note('相手の手札がありません');
      const items = cards.map((c) => ({ side: 'opp', iid: c.iid, card: c }));
      const max = Math.min(discard, items.length);
      const picked = await fxChoose({ src: self, title: `${oppName()}の手札から${max}枚選んでください（墓地へ）`, items, min: max, max });
      if (picked.length && send([{ op: 'move', iids: picked.map((r) => r.iid), to: 'graveyard' }])) {
        act(() => log(`${self.name}の効果で${oppName()}の${picked.map((r) => r.card.name).join('、')}を墓地へ`));
      }
    },
    // このターンだけの能力・パワー（選んだカード、またはその iid）
    buff(refs, b) {
      const ids = refs.map((r) => (typeof r === 'object' ? r.iid : r)).filter((iid) => zoneOf(iid) === 'battlefield');
      if (!ids.length) return;
      act(() => {
        for (const iid of ids) addBuff(game.cards[iid], b);
        log(`${self.name}の効果：${ids.map((i) => game.cards[i].name).join('、')}が${buffText(b)}`);
      });
    },
    buffAll(b) {
      x.buff(game.zones.battlefield.filter((i) => game.cards[i].isCreature), b);
    },
    // このターンの間の効果（turnFx）
    turnFx(key, value) {
      act(() => {
        game.turnFx = { ...game.turnFx, [key]: value };
        log(`${self.name}の効果を使った（このターンの間）`);
      });
    },
    // このカードを移す
    selfTo(zone) {
      if (zoneOf(src)) act(() => moveCard(src, zone));
    },
  };
  return x;
}

// ---------- このターンだけの能力 ----------

function addBuff(c, b) {
  if (b.guard) {
    c.guard = true;
    return;
  }
  const cur = c.buff ?? {};
  c.buff = {
    ...cur,
    pa: (cur.pa || 0) + (b.pa || 0),
    power: (cur.power || 0) + (b.power || 0),
    breaker: Math.max(cur.breaker || 1, b.breaker || 1),
    unblockable: cur.unblockable || !!b.unblockable,
    attackUntapped: cur.attackUntapped || !!b.attackUntapped,
    freeAttack: cur.freeAttack || !!b.freeAttack,
  };
}

function buffText(b) {
  const parts = [];
  if (b.pa) parts.push(`攻撃中パワー+${b.pa}`);
  if (b.power) parts.push(`パワー+${b.power}`);
  if (b.breaker === 2) parts.push('W・ブレイカー');
  if (b.unblockable) parts.push('ブロックされない');
  if (b.attackUntapped) parts.push('タップされていないクリーチャーを攻撃できる');
  if (b.freeAttack) parts.push('相手プレイヤーを攻撃できる');
  if (b.guard) parts.push('次のターンまでブロッカー');
  return `${parts.join('・')}（このターン）`;
}

// 効果で得ている能力をまとめて表示（バトルゾーンのカードの印）
function buffBadge(c) {
  const b = c.buff ?? {};
  const parts = [];
  if (b.pa || b.power) parts.push(`+${(b.pa || 0) + (b.power || 0)}`);
  if (b.breaker === 2) parts.push('W');
  if (b.unblockable) parts.push('ブロック不可');
  if (b.freeAttack || b.attackUntapped) parts.push('攻撃可');
  if (c.guard) parts.push('ブロッカー');
  return parts.join(' ');
}

// サイクロン・パニック：手札を山札に戻してシャッフルし、同じ枚数を引く
function cycloneHand() {
  const n = game.zones.hand.length;
  game.zones.library.push(...game.zones.hand);
  game.zones.hand = [];
  shuffle(game.zones.library);
  log(`手札${n}枚を山札に戻してシャッフル`);
  drawCards(n);
}

// ---------- 相手から届いた効果 ----------

function receiveFx(msg) {
  if (!game) return;
  const src = String(msg.src ?? '効果').slice(0, 40);
  fxSerial(async () => {
    for (const op of Array.isArray(msg.ops) ? msg.ops : []) await applyFxOp(op, src);
  });
}

const FX_ZONES = ['battlefield', 'mana', 'hand', 'graveyard', 'shields', 'library'];

async function applyFxOp(op, src) {
  const from = `${oppName()}の${src}`;
  // 相手の効果で自分のカードを移す（シュノーク・ラーがいれば、墓地に置かれるマナを戻してよい）
  const moveMine = async (ids, to) => {
    let keep = [];
    const manaToGrave = ids.filter((iid) => zoneOf(iid) === 'mana' && to === 'graveyard');
    const schnook = game.zones.battlefield.map((i) => game.cards[i]).find((c) => c.name === '神魂の守護者シュノーク・ラー');
    if (manaToGrave.length && schnook && await fxAsk(schnook, `${from}の効果でマナ${manaToGrave.length}枚が墓地に置かれます。マナゾーンに戻しますか？`)) keep = manaToGrave;
    netUpdate(() => {
      log(`${from}の効果`);
      if (keep.length) log(`${schnook.name}の効果でマナを墓地に置かずに戻した`);
      for (const iid of ids) if (!keep.includes(iid)) moveCard(iid, to, { destroy: zoneOf(iid) === 'battlefield' && to === 'graveyard' });
    });
  };
  if (op.op === 'move' && FX_ZONES.includes(op.to)) {
    await moveMine((op.iids ?? []).filter((iid) => game.cards[iid] && ['battlefield', 'mana', 'hand'].includes(zoneOf(iid))), op.to);
  } else if (op.op === 'phantomVeil') {
    netUpdate(() => {
      game.forcedAttack = true;
      log(`${from}の効果：次の自分のターン、攻撃できるクリーチャーはすべて攻撃しなければならない`);
    });
  } else if (op.op === 'evoTop') {
    // 進化クリーチャーの一番上のカードを墓地へ（すぐ下の進化元がバトルゾーンに残る）
    netUpdate(() => {
      const c = game.cards[op.iid];
      if (!c || zoneOf(op.iid) !== 'battlefield' || !c.under?.length) return;
      const below = c.under.at(-1);
      const bf = game.zones.battlefield;
      bf[bf.indexOf(op.iid)] = below;
      game.zones.under = game.zones.under.filter((x) => x !== below);
      game.cards[below].under = c.under.slice(0, -1);
      game.cards[below].tapped = c.tapped;
      c.under = [];
      game.zones.battlefield = bf.filter((x) => x !== op.iid);
      game.zones.graveyard.push(op.iid);
      log(`${from}の効果で${c.name}を墓地へ（${game.cards[below].name}が残る）`);
    });
  } else if (op.op === 'tap') {
    netUpdate(() => {
      for (const iid of op.iids ?? []) {
        if (zoneOf(iid) !== 'battlefield') continue;
        game.cards[iid].tapped = true;
        log(`${from}の効果で${game.cards[iid].name}をタップ`);
      }
      Sound.play('tap');
    });
  } else if (op.op === 'discardRandom') {
    netUpdate(() => {
      for (let k = 0; k < op.n && game.zones.hand.length; k++) {
        const iid = game.zones.hand[Math.floor(Math.random() * game.zones.hand.length)];
        log(`${from}の効果で手札から捨てた`);
        moveCard(iid, 'graveyard');
      }
    });
  } else if (op.op === 'all' && FX_ZONES.includes(op.zone) && FX_ZONES.includes(op.to)) {
    netUpdate(() => {
      log(`${from}の効果で${ZONES[op.zone]}のカードすべてを${FX_TO[op.to]}`);
      for (const iid of [...game.zones[op.zone]]) moveCard(iid, op.to, { silent: true });
    });
  } else if (op.op === 'choose' && FX_ZONES.includes(op.zone) && FX_ZONES.includes(op.to)) {
    const list = fxCands('me', op.zone, op.f ?? {});
    if (!list.length) return;
    const max = Math.min(Number(op.n) || 1, list.length);
    const picked = await fxChoose({ src: { name: from }, title: `${from}の効果：あなたの${ZONES[op.zone]}から${max}枚選んでください（${FX_TO[op.to]}）`, items: list, min: max, max });
    await moveMine(picked.map((r) => r.iid), op.to);
  } else if (op.op === 'cyclone') {
    netUpdate(() => {
      log(`${from}の効果`);
      cycloneHand();
    });
  }
}

// ---------- 相手の手札・シールドを見る ----------

const peekWaits = {};

function requestPeek(zone, idx = null) {
  return new Promise((resolve) => {
    const id = Math.random().toString(36).slice(2);
    peekWaits[id] = resolve;
    Net.send({ type: 'peek', id, zone, idx });
    setTimeout(() => {
      if (!peekWaits[id]) return;
      delete peekWaits[id];
      resolve(null);
    }, 8000);
  });
}

function receivePeek(msg) {
  if (!game) return;
  const ids = msg.zone === 'hand' ? game.zones.hand : (msg.idx ?? []).map((i) => game.zones.shields[i]).filter((i) => i != null);
  Net.send({ type: 'peekReply', id: msg.id, cards: ids.map(pubCard) });
  act(() => log(`${oppName()}が${msg.zone === 'hand' ? '手札' : `シールド${ids.length}枚`}を見た`));
}

function receivePeekReply(msg) {
  const resolve = peekWaits[msg.id];
  if (!resolve) return;
  delete peekWaits[msg.id];
  resolve(Array.isArray(msg.cards) ? msg.cards : []);
}

// ---------- 選ぶ画面 ----------

function fxDialog() {
  let dlg = document.getElementById('fx-dialog');
  if (dlg) return dlg;
  dlg = document.createElement('dialog');
  dlg.id = 'fx-dialog';
  dlg.className = 'fx-dialog';
  dlg.innerHTML = `
    <h2 class="panel-head"><b>EFFECT</b><small id="fx-src"></small></h2>
    <div class="dialog-body">
      <div class="fx-head"><div id="fx-face" class="fx-face"></div><p id="fx-text" class="fx-text"></p></div>
      <p id="fx-title" class="fx-title"></p>
      <div id="fx-cards" class="fx-cards"></div>
      <div id="fx-actions" class="dialog-actions"></div>
    </div>`;
  // 選び終えるまで閉じさせない
  dlg.addEventListener('cancel', (e) => e.preventDefault());
  document.body.append(dlg);
  return dlg;
}

// カードを選ぶ。選んだもの（items の一部）を返す。buttons を渡すと、押したボタンの番号を返す
function fxChoose({ src, title, items = [], min = 0, max = 0, hidden = false, skip = null, buttons = null, ok = '決定' }) {
  return new Promise((resolve) => {
    const dlg = fxDialog();
    const picked = new Set();
    document.getElementById('fx-src').textContent = src?.name ?? '';
    const face = document.getElementById('fx-face');
    face.replaceChildren(...(src?.civs ? [DM.cardFace(src)] : []));
    document.getElementById('fx-text').textContent = src?.text ?? '';
    document.getElementById('fx-title').textContent = title;
    const close = (value) => {
      dlg.close();
      resolve(value);
    };
    const okBtn = Object.assign(document.createElement('button'), { type: 'button', className: 'primary' });
    const update = () => {
      okBtn.disabled = picked.size < min || picked.size > max;
      okBtn.textContent = max > 1 ? `${ok}（${picked.size}/${max}）` : ok;
    };
    okBtn.addEventListener('click', () => close(items.filter((_, i) => picked.has(i))));
    document.getElementById('fx-cards').replaceChildren(...items.map((item, i) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'card fx-pick';
      if (hidden) el.append(Object.assign(document.createElement('div'), { className: 'dm-back' }), Object.assign(document.createElement('span'), { className: 'fx-num', textContent: `${i + 1}` }));
      else el.append(DM.cardFace(item.card));
      if (item.side === 'opp' && !hidden) el.append(Object.assign(document.createElement('span'), { className: 'fx-side', textContent: '相手' }));
      if (item.card?.tapped) el.classList.add('tapped');
      el.title = hidden ? '' : `${item.card.name}\n${DM.detailText(item.card)}`;
      el.disabled = max === 0;
      el.addEventListener('click', () => {
        if (picked.has(i)) picked.delete(i);
        else if (max === 1) {
          picked.clear();
          picked.add(i);
        } else if (picked.size < max) picked.add(i);
        for (const [j, child] of [...document.getElementById('fx-cards').children].entries()) child.classList.toggle('picked', picked.has(j));
        Sound.play('button');
        update();
      });
      return el;
    }));
    document.getElementById('fx-cards').hidden = !items.length;
    const actions = document.getElementById('fx-actions');
    if (buttons) {
      actions.replaceChildren(...buttons.map((label, i) => {
        const b = Object.assign(document.createElement('button'), { type: 'button', textContent: label, className: i === 0 ? 'primary' : '' });
        b.addEventListener('click', () => close(i));
        return b;
      }));
    } else {
      const extra = [];
      if (skip) {
        const s = Object.assign(document.createElement('button'), { type: 'button', textContent: skip });
        s.addEventListener('click', () => close([]));
        extra.push(s);
      }
      actions.replaceChildren(...extra, okBtn);
      update();
    }
    if (!dlg.open) dlg.showModal();
  });
}

const fxAsk = async (src, text) => (await fxChoose({ src, title: text, buttons: ['はい', 'いいえ'] })) === 0;
const fxButtons = (src, text, labels) => fxChoose({ src, title: text, buttons: labels });
const fxShow = (src, title, cards) => fxChoose({ src, title, items: cards.map((c) => ({ side: 'opp', iid: c.iid, card: c })), buttons: ['閉じる'] });

// 攻撃でシールドをブレイクしたあと：ミラクル・サーチャー（1枚につき2枚引いてよい）
function miracleDraw(n) {
  if (!game?.turnFx?.miracle || n <= 0) return;
  const src = { name: 'ミラクル・サーチャー' };
  fxSerial(async () => {
    for (let k = 0; k < n; k++) {
      if (await fxAsk(src, `シールドをブレイクしました。カードを2枚引きますか？（${k + 1}/${n}）`)) act(() => drawCards(2));
    }
  });
}

// ---------- 常在型能力（バトルゾーンにある間ずっと働く） ----------
// パワー（power：いつも、pa：攻撃中だけ）・ブレイカー・ブロッカー・ブロックされない を、盤面から毎回計算する。
// 自分のクリーチャーの分だけ計算し、相手には snapshot で計算済みの値を送る。

const fxRace = (c, r) => (c.race ?? '').includes(r);
const fxCiv = (c, ...v) => v.some((x) => c.civs?.includes(x));

function fxBoard() {
  const mine = game.zones.battlefield.map((i) => game.cards[i]).filter((c) => c.isCreature);
  const theirs = online() ? (opp?.state?.battlefield ?? []).filter((c) => c.isCreature) : [];
  const mana = game.zones.mana.map((i) => game.cards[i]);
  return {
    mine,
    theirs,
    all: [...mine, ...theirs],
    grave: game.zones.graveyard.map((i) => game.cards[i]),
    shields: game.zones.shields.length,
    others: (c) => mine.filter((x) => x !== c),
    // マナゾーンのカードがすべてその文明か
    manaAll: (v) => mana.length > 0 && mana.every((c) => c.civs.includes(v)),
  };
}

// そのクリーチャー自身の能力
const per = (n, list) => n * list.length;
const FX_SELF = {
  'ボルシャック・ドラゴン': (c, B) => ({ pa: per(1000, B.grave.filter((x) => fxCiv(x, '火'))) }),
  '予言者カティノ': (c, B) => B.others(c).some((x) => fxRace(x, 'エンジェル・コマンド')) && { power: 2000 },
  '走神兵ウルヘリオン': (c, B) => B.others(c).some((x) => fxRace(x, 'ヒューマノイド')) && { pa: 2000 },
  '一撃必殺のホーバス': (c, B) => B.others(c).some((x) => fxRace(x, 'アーマロイド')) && { pa: 2000 },
  '突神兵ドガーン': (c, B) => ({ pa: per(2000, B.others(c).filter((x) => x.tapped)) }),
  '機神装甲ヴァルバロス': (c, B) => ({ pa: per(2000, B.all.filter((x) => x !== c && fxRace(x, 'ヒューマノイド'))) }),
  '機神装甲ヴァルボーグ': (c, B) => ({ pa: per(1000, B.all.filter((x) => x !== c && fxCiv(x, '火'))) }),
  'ガルザウルス': (c, B) => !B.others(c).length && { pa: 4000, breaker: 2 },
  '跳躍するトルネード・ホーン': (c, B) => ({ pa: per(1000, B.mine) }),
  '堅牢の伝道師アレーク': (c, B) => ({ power: per(1000, B.others(c).filter((x) => fxCiv(x, '光'))) }),
  '牙男': (c, B) => ({ power: per(1000, B.others(c).filter((x) => fxCiv(x, '闇'))) }),
  '奇面ざくろ': (c, B) => ({ power: per(1000, B.others(c).filter((x) => fxCiv(x, '自然'))) }),
  'ガルカーゴ・ドラゴン': (c, B) => ({ power: per(1000, B.others(c).filter((x) => fxCiv(x, '火'))) }),
  '混沌魚': (c, B) => ({ power: per(1000, B.others(c).filter((x) => fxCiv(x, '水'))) }),
  '陽光の求道者ル・パーレ': (c, B) => B.manaAll('光') && { power: 2000 },
  'アングラー・クラスター': (c, B) => B.manaAll('水') && { power: 3000 },
  '泥男': (c, B) => B.manaAll('闇') && { power: 2000 },
  'チッチ・ホッピー': (c, B) => B.manaAll('火') && { power: 2000 },
  '激昂するダッシュ・ホーン': (c, B) => B.manaAll('自然') && { power: 3000, breaker: 2 },
  '線光花': (c, B) => B.manaAll('光') && { blocker: true },
  '爆裂兵ダーク・ブラスター': (c, B) => B.others(c).some((x) => fxCiv(x, '闇')) && { power: 2000 },
  '爆発サボテン': (c, B) => B.others(c).some((x) => fxCiv(x, '光')) && { power: 2000 },
  'シェル・キャノン': (c, B) => ({ power: 1000 * B.shields }),
  '月浴するムーン・ホーン': (c, B) => ({ power: per(1000, B.theirs.filter((x) => fxCiv(x, '水', '闇'))) }),
  '巨翼の爪': (c, B) => ({ power: per(1000, B.theirs.filter((x) => fxCiv(x, '水', '闇'))) }),
  '威嚇するスマッシュ・ホーンα': () => ({ power: 1000 }),
  'トロピコ': (c, B) => B.others(c).length >= 2 && { unblockable: true },
};

// ほかのクリーチャーに与える能力（s：与える側、t：自分のクリーチャー、own：s が自分のクリーチャーか）
const FX_AURA = {
  '大勇者「大地の猛攻」': (s, t, own) => own && s !== t && s.tapped && fxRace(t, 'ビーストフォーク') && { power: 2000 },
  '機神装甲ヴァルディオス': (s, t, own) => own && s !== t && fxRace(t, 'ヒューマノイド') && { power: 1000 },
  '超竜ジャバハ': (s, t, own) => own && s !== t && fxCiv(t, '火') && { pa: 2000 },
  '聖天使ジーク・バリキューラ': (s, t, own) => own && s !== t && fxCiv(t, '光') && { blocker: true },
  'レジェンダリー・バイロン': (s, t, own) => own && s !== t && fxCiv(t, '水') && { unblockable: true },
  '応援チューリップ': (s, t) => fxRace(t, 'エンジェル・コマンド') && { pa: 4000 },
  '邪妃グレゴリア': (s, t) => fxRace(t, 'デーモン・コマンド') && { power: 2000, blocker: true },
  'カオティック・ワイバーン': (s, t) => fxRace(t, 'デーモン・コマンド') && { pa: 4000, breaker: 2 },
  'キング・アクアカムイ': (s, t) => (fxRace(t, 'エンジェル・コマンド') || fxRace(t, 'デーモン・コマンド')) && { power: 2000 },
  '聖弓の求道者レ・ビール': (s, t) => s !== t && fxCiv(t, '光') && { power: 2000 },
  '呪いの影シャドウ・ムーン': (s, t) => s !== t && fxCiv(t, '闇') && { power: 2000 },
  'チアフル・アビス': (s, t) => fxCiv(t, '光', '闇') && { power: 1000 },
  'ピッピ・クッピー': (s, t) => fxRace(t, 'アーマード・ドラゴン') && { power: 1000 },
  'キング・ノーチラス': (s, t) => fxRace(t, 'リキッド・ピープル') && { unblockable: true },
};

// 自分のバトルゾーンのクリーチャー c が、常在型能力で得ているもの
function staticMods(c) {
  const B = fxBoard();
  const m = { power: 0, pa: 0, breaker: 1, blocker: false, unblockable: false };
  const add = (r) => {
    if (!r) return;
    m.power += r.power || 0;
    m.pa += r.pa || 0;
    m.breaker = Math.max(m.breaker, r.breaker || 1);
    m.blocker ||= !!r.blocker;
    m.unblockable ||= !!r.unblockable;
  };
  add(FX_SELF[c.name]?.(c, B));
  for (const s of B.mine) add(FX_AURA[s.name]?.(s, c, true));
  for (const s of B.theirs) add(FX_AURA[s.name]?.(s, c, false));
  return m;
}

// コストを増やす・減らすクリーチャー（増やすのは誰のカードにも、エルフィンは自分のカードだけ）
const FX_COST_UP = { '牢黒の伝道師ミリエス': ['闇', 2], 'カスミダケ': ['闇', 1], '偽りの影ヘル・スモーク': ['光', 2], '爆弾小僧ミサイルボーイ': ['光', 1], '角男': ['自然', 1] };

function costOf(c) {
  const B = fxBoard();
  let cost = Number(c.cost) || 0;
  for (const s of B.all) {
    const up = FX_COST_UP[s.name];
    if (up && fxCiv(c, up[0]) && (c.isCreature || c.isSpell)) cost += up[1];
  }
  // 「ただし、コストが1のときは少なくならない」
  const down = B.mine.filter((s) => (c.isCreature && s.name === '念仏エルフィン') || (c.isSpell && s.name === 'ラブ・エルフィン')).length;
  for (let k = 0; k < down && cost > 1; k++) cost--;
  return cost;
}

// 使えない S・トリガー（フ・レイル：闇、ギガボルバ：光）
function triggerBlocked(c) {
  const B = fxBoard();
  return (fxCiv(c, '闇') && B.all.some((s) => s.name === '暴風の求道者フ・レイル')) || (fxCiv(c, '光') && B.all.some((s) => s.name === 'ギガボルバ'));
}

// 唱えられない呪文（聖霊王アルカディアス：光以外）
function spellLocked(c) {
  return c.isSpell && !fxCiv(c, '光') && fxBoard().all.some((s) => s.name === '聖霊王アルカディアス');
}

// ---------- カードの移動に合わせて働く能力（moveCard から呼ぶ） ----------

// 破壊されるかわりに：ポッポ・チャッピー（セイバー：アーマード・ドラゴン）。かわりに墓地に置くカード
function fxSaver(card) {
  if (!fxRace(card, 'アーマード・ドラゴン')) return null;
  return game.zones.battlefield.find((i) => i !== card.iid && game.cards[i].name === 'ポッポ・チャッピー') ?? null;
}

// 墓地のかわりに置く場所（大昆虫ギガマンティス：自分の他の自然のクリーチャーはマナへ）
function fxDeathTo(card) {
  if (card.isCreature && fxCiv(card, '自然') && game.zones.battlefield.some((i) => i !== card.iid && game.cards[i].name === '大昆虫ギガマンティス')) return 'mana';
  return null;
}

// 移動のあとで処理する効果を積む
function fxAfterMove(card, from, to) {
  if (!card.isCreature) return;
  const others = (key) => game.zones.battlefield.filter((i) => i !== card.iid && hasFx(game.cards[i].name, key));
  if (to === 'battlefield' && from !== 'battlefield') {
    for (const iid of others('otherEnter')) fxQueue.push({ iid, on: 'otherEnter' });
  }
  if (from === 'battlefield' && to === 'graveyard') {
    if (hasFx(card.name, 'death')) fxQueue.push({ iid: card.iid, on: 'death' });
    for (const iid of others('otherDie')) fxQueue.push({ iid, on: 'otherDie' });
    // 絶望の魔黒ジャックバイパー：自分の他の闇のクリーチャーを手札に戻してよい
    const jack = game.zones.battlefield.find((i) => i !== card.iid && game.cards[i].name === '絶望の魔黒ジャックバイパー');
    if (jack != null && fxCiv(card, '闇')) {
      fxQueue.push({
        run: async () => {
          if (zoneOf(card.iid) !== 'graveyard') return;
          if (await fxAsk(game.cards[jack], `${card.name}を手札に戻しますか？`)) act(() => moveCard(card.iid, 'hand'));
        },
      });
    }
  }
}

// 相手のクリーチャーが出た・墓地に置かれた（相手の snapshot の変化から）：ミスト・リエス・屑男
function fxOppDiff(prev, next) {
  if (!game || !started() || !prev?.battlefield || !next?.battlefield || prev.deckName !== next.deckName) return;
  const before = new Set(prev.battlefield.filter((c) => c.isCreature).map((c) => c.iid));
  const after = new Set(next.battlefield.filter((c) => c.isCreature).map((c) => c.iid));
  const grave = new Set((next.graveyard ?? []).map((c) => c.iid));
  const entered = [...after].filter((i) => !before.has(i)).length;
  const died = [...before].filter((i) => !after.has(i) && grave.has(i)).length;
  const mine = (key) => game.zones.battlefield.filter((i) => hasFx(game.cards[i].name, key));
  for (let k = 0; k < entered; k++) for (const iid of mine('otherEnter')) fxQueue.push({ iid, on: 'otherEnter' });
  for (let k = 0; k < died; k++) for (const iid of mine('otherDie')) fxQueue.push({ iid, on: 'otherDie' });
  drainFx();
}
