// 戦場の背景：グリッド・ギャラクシー・サーキット・ステージ・ミッドナイトから選択（絵は skin.css の CSS で描く）。
// 選んだものはこのブラウザに記憶する
(function () {
  const KEY = 'dm-deckmaker-felt';
  const FIELDS = [
    ['grid', 'グリッド'],
    ['galaxy', 'ギャラクシー'],
    ['circuit', 'サーキット'],
    ['stage', 'ステージ'],
    ['midnight', 'ミッドナイト'],
  ];
  const valid = (c) => FIELDS.some(([id]) => id === c);
  let current = 'grid';
  try {
    const saved = localStorage.getItem(KEY);
    if (valid(saved)) current = saved;
  } catch {}
  document.documentElement.dataset.felt = current;

  // 画面内のすべての .felt-picker に選択肢を並べる（設定画面）
  function build() {
    for (const box of document.querySelectorAll('.felt-picker')) buildBox(box);
  }
  function buildBox(box) {
    for (const [id, name] of FIELDS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `felt-swatch field-${id}`;
      b.setAttribute('aria-label', `戦場の背景：${name}`);
      b.title = name;
      b.setAttribute('aria-pressed', String(id === current));
      b.addEventListener('click', () => {
        current = id;
        document.documentElement.dataset.felt = id;
        try { localStorage.setItem(KEY, id); } catch {}
        for (const s of document.querySelectorAll('.felt-swatch')) s.setAttribute('aria-pressed', String(s.classList.contains(`field-${id}`)));
      });
      box.append(b);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
