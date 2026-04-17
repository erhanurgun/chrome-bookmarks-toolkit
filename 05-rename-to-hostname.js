/**
 * 05 - Rename Titles to Hostname
 *
 * Ne yapar: Tüm yer imlerinin başlığını URL'deki hostname'e (www. olmadan)
 *   dönüştürür. Path, query, fragment atılır. Klasör yapınız zaten
 *   kategorize ediyorsa uzun başlıklar yerine temiz hostname'ler daha okunabilir.
 *
 * YouTube istisnası: Path'li YouTube URL'leri (watch, shorts, kanal, vb.)
 *   silinir çünkü genelde aramayla yeniden bulunabilir. Sadece ana sayfa
 *   (youtube.com) kalır. İstemiyorsanız CLEANUP_YOUTUBE_PATHS = false yapın.
 *
 * Nasıl kullanılır:
 *   1) DRY_RUN = true ile önizle (silinecek/değişecek liste).
 *   2) DRY_RUN = false yap, uygula.
 *
 * Not: Bu işlemden sonra aynı klasörde aynı hostname'e sahip birden fazla
 *   URL olabilir (aynı başlık). Bunu düzeltmek için 04-subfolder-by-hostname.js
 *   veya 02-dedupe-folders-and-urls.js çalıştırın.
 *
 * chrome://bookmarks → F12 → Console → yapıştır → Enter.
 */
(async () => {
  'use strict';

  // ======== USER SETTINGS ========
  const DRY_RUN = true;
  const CLEANUP_YOUTUBE_PATHS = true;  // path'li YouTube URL'leri sil
  const YT_DOMAINS = new Set([
    'youtube.com', 'm.youtube.com', 'music.youtube.com', 'studio.youtube.com', 'youtu.be',
  ]);
  const SHOW_SAMPLE = 40;
  // ================================

  const api = {
    getTree: () => new Promise(r => chrome.bookmarks.getTree(r)),
    update: (id, ch) => new Promise(r => chrome.bookmarks.update(id, ch, r)),
    remove: (id) => new Promise((ok, fail) => chrome.bookmarks.remove(id, () => {
      if (chrome.runtime.lastError) fail(chrome.runtime.lastError); else ok();
    })),
  };
  const log = (...a) => console.log('[rename]', ...a);
  const warn = (...a) => console.warn('[rename]', ...a);

  const analyze = (url) => {
    try {
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return { skip: true };
      let host = u.hostname.toLowerCase();
      if (host.startsWith('www.')) host = host.slice(4);
      const hasPath = u.pathname && u.pathname !== '/' && u.pathname !== '';

      if (CLEANUP_YOUTUBE_PATHS && YT_DOMAINS.has(host)) {
        if (hasPath) return { action: 'delete' };
        return { action: 'rename', newTitle: 'youtube.com' };
      }
      return { action: 'rename', newTitle: host };
    } catch { return { skip: true }; }
  };

  const tree = await api.getTree();
  const all = [];
  const walk = (n) => {
    if (n.url) all.push(n);
    if (n.children) for (const c of n.children) walk(c);
  };
  walk(tree[0]);

  const toDelete = [];
  const toRename = [];
  let unchanged = 0, skipped = 0;
  const finalTitleCount = {};

  for (const b of all) {
    const r = analyze(b.url);
    if (r.skip) { skipped++; continue; }
    if (r.action === 'delete') { toDelete.push(b); continue; }
    finalTitleCount[r.newTitle] = (finalTitleCount[r.newTitle] || 0) + 1;
    if ((b.title || '') === r.newTitle) { unchanged++; continue; }
    toRename.push({ id: b.id, oldTitle: b.title || '', newTitle: r.newTitle, url: b.url });
  }

  // Aynı hostname'e sahip birden fazla bookmark uyarısı
  const dupes = Object.entries(finalTitleCount).filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);

  log(`======== ANALİZ (DRY_RUN=${DRY_RUN}) ========`);
  log(`Silinecek (YouTube path'li): ${toDelete.length}`);
  log(`Yeniden adlandırılacak: ${toRename.length}`);
  log(`Zaten uygun: ${unchanged}`);
  log(`Atlanan (http/https dışı): ${skipped}`);

  if (dupes.length) {
    log('');
    log(`Dikkat: ${dupes.length} hostname birden fazla kez (aynı başlığa sahip olurlar):`);
    for (const [h, n] of dupes.slice(0, 15)) log(`  ${String(n).padStart(3)}  ${h}`);
    if (dupes.length > 15) log(`  ... ve ${dupes.length - 15} daha`);
    log('→ sonra 04-subfolder-by-hostname.js çalıştırın');
  }

  if (toDelete.length) {
    log('');
    log(`Silinecek örnekler:`);
    for (const b of toDelete.slice(0, SHOW_SAMPLE)) log(`  "${b.title || '(başlıksız)'}"   ${b.url.slice(0, 80)}`);
    if (toDelete.length > SHOW_SAMPLE) log(`  ... ve ${toDelete.length - SHOW_SAMPLE} daha`);
  }
  if (toRename.length) {
    log('');
    log(`Yeniden adlandırma örnekleri:`);
    for (const r of toRename.slice(0, SHOW_SAMPLE)) log(`  "${r.oldTitle}"  →  "${r.newTitle}"`);
    if (toRename.length > SHOW_SAMPLE) log(`  ... ve ${toRename.length - SHOW_SAMPLE} daha`);
  }

  if (DRY_RUN) {
    log('');
    log('DRY_RUN=true → değişiklik yok. Onayla: DRY_RUN=false');
    return { toDelete: toDelete.length, toRename: toRename.length };
  }

  let deleted = 0, renamed = 0, errors = 0;
  for (const b of toDelete) {
    try { await api.remove(b.id); deleted++; }
    catch (e) { warn('remove fail:', b.url, e); errors++; }
  }
  for (const r of toRename) {
    try { await api.update(r.id, { title: r.newTitle }); renamed++; }
    catch (e) { warn('update fail:', r.url, e); errors++; }
  }

  log('');
  log('======== ÖZET ========');
  log(`Silinen: ${deleted}`);
  log(`Yeniden adlandırılan: ${renamed}`);
  log(`Hata: ${errors}`);
  log('TAMAMLANDI. 04-subfolder-by-hostname.js ve 01-sort.js çalıştırmak iyi olur.');
  return { deleted, renamed, errors };
})();
