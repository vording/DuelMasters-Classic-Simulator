// 更新情報：上部メニューの下の帯（.ticker）に流す。新しいものを上に足していく
const NEWS = [
  ['2026.10.31', '一人回しの BGM に「RE-ROOTS」を追加'],
  ['2026.10.31', '一人回しと対戦を分けました（一人回しはデッキ作成から。BGM は WATERING）'],
  ['2026.10.31', '対戦中の BGM に「WATERING」を追加'],
  ['2026.10.31', '上の帯に更新情報を流すようにしました'],
  ['2026.10.31', 'デッキ選択の表紙に、キーカードのイラストを表示'],
  ['2026.10.31', '名称を「DuelMasters Classic Simulator」に変更'],
  ['2026.10.31', 'ロゴを龍のデザインに変更'],
  ['2026.10.31', '対戦中の BGM を3曲からランダムに（始まりに曲名を表示）'],
  ['2026.10.31', '背景に文明のアイコンを追加'],
  ['2026.10.30', '仕込んだシールドがわかるように'],
  ['2026.10.30', 'スマホの対戦画面で自分の盤面が見切れないように'],
  ['2026.10.30', 'マッチング画面と6桁の部屋コード'],
  ['2026.10.30', '召喚の演出・チャットがフィールドに流れるように'],
  ['2026.10.30', 'ブレイクしたシールドの中身を相手に見せないように'],
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
