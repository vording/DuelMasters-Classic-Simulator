// スマホ：カードの長押しで拡大表示（両画面の <head> で読み込む）
// onLongPress(el, fn)：タッチの長押し。showCardDetail({ name, image, text }, [[ボタン名, fn], ...])：拡大表示
(function () {
  // 長押し（タッチのみ。mouse: true ならマウスの左ボタンの長押しも）。長押し後に続けて起きる click は無視する
  function onLongPress(el, fn, { mouse = false } = {}) {
    let timer = null;
    let sx = 0;
    let sy = 0;
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && (!mouse || e.button !== 0)) return;
      // 端末によっては長押しの後に click が起きないので、次に触れたときに印を消す
      delete el.dataset.longpress;
      sx = e.clientX;
      sy = e.clientY;
      timer = setTimeout(() => {
        timer = null;
        el.dataset.longpress = '1';
        fn(e);
      }, 450);
    });
    const cancel = () => { clearTimeout(timer); timer = null; };
    el.addEventListener('pointermove', (e) => {
      if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) cancel();
    });
    el.addEventListener('pointerup', cancel);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('pointerleave', cancel);
    el.addEventListener('click', (e) => {
      if (!el.dataset.longpress) return;
      delete el.dataset.longpress;
      e.stopImmediatePropagation();
      e.preventDefault();
    }, true);
  }

  let dialog = null;

  function build() {
    dialog = document.createElement('dialog');
    dialog.className = 'card-detail';
    dialog.innerHTML = '<div class="card-detail-body"><div class="card-detail-card"></div><div class="name card-detail-name"></div><div class="name card-detail-text"></div><div class="card-detail-actions"></div></div>';
    // ボタン以外のどこを押しても閉じる
    dialog.addEventListener('click', (e) => {
      if (!e.target.closest('.card-detail-actions button')) dialog.close();
    });
    document.body.append(dialog);
  }

  function showCardDetail(card, actions = []) {
    if (!dialog) build();
    const box = dialog.querySelector('.card-detail-card');
    if (card.image) {
      const img = document.createElement('img');
      img.alt = card.name;
      // Scryfall の画像は大きいサイズに差し替える（なければ元の画像）
      const large = card.image.replace('/normal/', '/large/');
      img.src = large;
      if (large !== card.image) img.addEventListener('error', () => { img.src = card.image; }, { once: true });
      box.replaceChildren(img);
    } else {
      const text = document.createElement('div');
      text.className = 'text';
      text.textContent = card.name;
      box.replaceChildren(text);
    }
    dialog.querySelector('.card-detail-name').textContent = card.name;
    // タイプ・効果テキスト・P/T（あれば）
    dialog.querySelector('.card-detail-text').textContent = card.text ?? '';
    // actions: [[ボタン名, fn, { keep: true }なら閉じずに続ける, { primary }], ...]
    dialog.querySelector('.card-detail-actions').replaceChildren(...actions.map(([label, fn, opts = {}]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      if (opts.primary) b.className = 'primary';
      b.addEventListener('click', () => {
        if (!opts.keep) dialog.close();
        fn();
      });
      return b;
    }));
    if (!dialog.open) dialog.showModal();
  }
  // 開いている拡大表示の説明文だけを書き換える（枚数を足したときなど）
  function updateCardDetailText(text) {
    if (dialog?.open) dialog.querySelector('.card-detail-text').textContent = text;
  }
  window.updateCardDetailText = updateCardDetailText;

  // 長押しのあいだだけ詳細を見る（指・マウスを離したら閉じる）。getCard() は showCardDetail に渡すカード
  // 長押し後に続けて起きる click は無視する。onHold を返すと、外から「今すぐ見せる」こともできる
  function onPeek(el, getCard, { mouse = true, delay = 400 } = {}) {
    let timer = null;
    let sx = 0;
    let sy = 0;
    const close = () => {
      removeEventListener('pointerup', close, true);
      removeEventListener('pointercancel', close, true);
      removeEventListener('touchend', close, true);
      removeEventListener('touchcancel', close, true);
      // 印（peek）は閉じてから外す（開け閉めの効果音を鳴らさないため）
      if (dialog?.open) dialog.close();
      dialog?.classList.remove('peek');
    };
    const show = () => {
      el.dataset.longpress = '1';
      if (!dialog) build();
      dialog.classList.add('peek');
      showCardDetail(getCard());
      addEventListener('pointerup', close, true);
      addEventListener('pointercancel', close, true);
      addEventListener('touchend', close, true);
      addEventListener('touchcancel', close, true);
    };
    const cancel = () => { clearTimeout(timer); timer = null; };
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && (!mouse || e.button !== 0)) return;
      delete el.dataset.longpress;
      sx = e.clientX;
      sy = e.clientY;
      cancel();
      timer = setTimeout(() => {
        timer = null;
        show();
      }, delay);
    });
    el.addEventListener('pointermove', (e) => {
      if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) cancel();
    });
    el.addEventListener('pointerup', cancel);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') cancel(); });
    el.addEventListener('click', (e) => {
      if (!el.dataset.longpress) return;
      delete el.dataset.longpress;
      e.stopImmediatePropagation();
      e.preventDefault();
    }, true);
    el.addEventListener('contextmenu', (e) => { if (el.dataset.longpress) e.preventDefault(); });
    return { show, cancel };
  }
  window.onPeek = onPeek;

  // ---------- 画面の切り替え：斜めのパネルが横切るワイプ ----------
  // Wipe.cover()：画面を覆う（覆い終わると resolve）、Wipe.reveal()：覆いをどける、Wipe.run(fn)：覆って fn して、どける
  // 別のページへ移るときは Wipe.mark() してから cover（移った先のページはワイプで開く）
  const WIPE_KEY = 'dm-deckmaker-wipe';
  const COVER_MS = 560;
  let wipe = null;
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  function wipeEl() {
    if (wipe) return wipe;
    wipe = document.createElement('div');
    wipe.className = 'wipe';
    wipe.setAttribute('aria-hidden', 'true');
    wipe.innerHTML = '<i class="wipe-panel p1"></i><i class="wipe-panel p2"></i><i class="wipe-panel p3"></i><span class="logo-mark wipe-logo"></span>';
    document.body.append(wipe);
    window.Logo?.render();
    return wipe;
  }

  function cover() {
    if (reduced()) return Promise.resolve();
    const el = wipeEl();
    el.classList.remove('out', 'instant');
    // パネルを左の外に置いてから動かす
    void el.offsetWidth;
    el.classList.add('in');
    // Sound は sound.js（このファイルより後に読み込む）
    if (typeof Sound !== 'undefined') Sound.play('page');
    return new Promise((resolve) => setTimeout(resolve, COVER_MS));
  }

  function reveal() {
    if (!wipe?.classList.contains('in')) return;
    wipe.classList.remove('in', 'instant');
    wipe.classList.add('out');
    clearTimeout(reveal.timer);
    reveal.timer = setTimeout(() => wipe.classList.remove('out'), 700);
  }

  async function run(fn) {
    await cover();
    try { fn(); } finally { reveal(); }
  }

  const mark = () => { try { sessionStorage.setItem(WIPE_KEY, '1'); } catch {} };

  // ページを開いたとき：前のページがワイプで閉じていたら、覆った状態から開く
  document.addEventListener('DOMContentLoaded', () => {
    let flag = null;
    try {
      flag = sessionStorage.getItem(WIPE_KEY);
      sessionStorage.removeItem(WIPE_KEY);
    } catch {}
    if (!flag || reduced()) return;
    const el = wipeEl();
    el.classList.add('instant', 'in');
    // 覆った状態をいったん描いてから、どける（requestAnimationFrame は裏のタブで止まるので使わない）
    void el.offsetWidth;
    setTimeout(reveal, 150);
  });
  // 戻るでページに戻ってきたとき（ページがそのまま残っている場合）は、覆いをどける
  addEventListener('pageshow', (e) => { if (e.persisted) reveal(); });

  window.Wipe = { cover, reveal, run, mark };

  window.onLongPress = onLongPress;
  window.showCardDetail = showCardDetail;
})();
