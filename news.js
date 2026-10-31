// 更新情報：上部メニューの下の帯（.ticker）に流す。新しいものを上に足していく
// ・ゲーム（対戦・一人回しの遊び方）にかかわる変更は文章で書く
// ・見た目の変更は、日付ごとに「見た目の変更」1件にまとめる
// ・その他は、日付ごとに「軽微な変更」1件にまとめる
const NEWS = [
  ['2026.10.31', '一人回しと対戦を分けました（一人回しはデッキ作成からすぐ始まる）'],
  ['2026.10.31', '対戦画面から戻ると、途中のゲームは終了するように'],
  ['2026.10.31', '対戦相手との接続が3分以上切れたら、対戦を終了するように'],
  ['2026.10.31', '相手が仕込んだシールドの位置がわかるように'],
  ['2026.10.31', '見た目の変更'],
  ['2026.10.31', '軽微な変更'],
  ['2026.10.30', 'ブレイクしたシールドの中身を相手に見せないように・仕込んだシールドがわかるように'],
  ['2026.10.30', '勝敗が決まったら対戦準備画面に戻るように'],
  ['2026.10.30', 'マッチング画面と6桁の部屋コード'],
  ['2026.10.30', '見た目の変更'],
  ['2026.10.30', '軽微な変更'],
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
