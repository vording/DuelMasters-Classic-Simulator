// 更新情報：上部メニューの下の帯（.ticker）に流す。新しいものを上に足していく
// 細かい修正（見た目の調整・不具合の修正など）は、日付ごとに「軽微な修正」にまとめる
const NEWS = [
  ['2026.10.31', '設定画面とギャラリーを追加（BGM を聞ける。主音量も設定できる）'],
  ['2026.10.31', 'デッキ選択に「編集」を追加（ドラッグで並び替え・削除）'],
  ['2026.10.31', 'エクスポートを追加（カードの一覧・QR コード・テキストでコピー・共有リンク）'],
  ['2026.10.31', '一人回しと対戦を分けました（一人回しはデッキ作成からすぐ始まる）'],
  ['2026.10.31', 'BGM を追加（対戦・一人回しはゲームごとにランダム）'],
  ['2026.10.31', '名称を「DuelMasters Classic Simulator」に変更・ロゴを変更'],
  ['2026.10.31', 'デッキのキーカードを設定できるように'],
  ['2026.10.31', '軽微な修正'],
  ['2026.10.30', 'マッチング画面と6桁の部屋コード'],
  ['2026.10.30', 'ブレイクしたシールドの中身を相手に見せないように'],
  ['2026.10.30', '軽微な修正'],
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
