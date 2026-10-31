// 更新情報：上部メニューの下の帯（.ticker）に流す。新しいものを上に足していく。文は「〜しました」の形で書く
// ・ゲーム（対戦・一人回しの遊び方）にかかわる変更は文章で書く
// ・見た目の変更は、日付ごとに「見た目を変更しました」1件にまとめる
// ・その他は、日付ごとに「軽微な変更をしました」1件にまとめる
const NEWS = [
  ['2026.10.31', '一人回しと対戦を分けました（一人回しはデッキ作成からすぐ始まります）'],
  ['2026.10.31', '対戦画面から戻ると、途中のゲームを終了するようにしました'],
  ['2026.10.31', '対戦相手との接続が3分以上切れたら、対戦を終了するようにしました'],
  ['2026.10.31', '相手が仕込んだシールドの位置がわかるようにしました'],
  ['2026.10.31', '見た目を変更しました'],
  ['2026.10.31', '軽微な変更をしました'],
  ['2026.10.30', 'ブレイクしたシールドの中身を相手に見せないようにしました'],
  ['2026.10.30', '仕込んだシールドがわかるようにしました'],
  ['2026.10.30', '勝敗が決まったら対戦準備画面に戻るようにしました'],
  ['2026.10.30', 'マッチング画面を追加し、部屋コードを6桁の数字にしました'],
  ['2026.10.30', '見た目を変更しました'],
  ['2026.10.30', '軽微な変更をしました'],
];

// 帯の中身を作る：「日付 内容」を文明のアイコンで区切り、同じ並びを2回続けて切れ目なく流す
(function () {
  const CIVS = ['light', 'water', 'darkness', 'fire', 'nature'];
  function render() {
    for (const ticker of document.querySelectorAll('.ticker')) {
      const span = document.createElement('span');
      for (let round = 0; round < 2; round++) {
        NEWS.forEach(([date, text], i) => {
          span.append(Object.assign(document.createElement('b'), { className: 'tk-date', textContent: date }), ` ${text} `);
          span.append(Object.assign(document.createElement('i'), { className: `tk civ-mark-${CIVS[i % CIVS.length]}` }), ' ');
        });
      }
      // 文字の量に合わせて、読める速さで流す（1文字あたり約0.25秒）
      const chars = NEWS.reduce((n, [d, t]) => n + d.length + t.length, 0);
      span.style.animationDuration = `${Math.max(30, Math.round(chars * 0.25))}s`;
      ticker.replaceChildren(span);
      ticker.title = '更新情報';
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
  else render();
})();
