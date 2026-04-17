/**
 * 04 - Rename Titles to Hostname
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
 *   URL olabilir (aynı başlık). Bunu düzeltmek için 05-subfolder-by-hostname.js
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

  // ======== CONSTANTS ========
  // Duplicate uyarı listesinde gösterilecek ilk N hostname.
  const DUP_WARN_HEAD = 15;
  // ================================

  // ======== HELPERS ========
  const makeLogger = (prefix) => ({
    log: (...args) => console.log(`[${prefix}]`, ...args),
    warn: (...args) => console.warn(`[${prefix}]`, ...args),
    error: (...args) => console.error(`[${prefix}]`, ...args),
  });

  const makeApi = () => ({
    getTree: () => new Promise((resolve) => chrome.bookmarks.getTree(resolve)),
    update: (id, changes) => new Promise((resolve) => chrome.bookmarks.update(id, changes, resolve)),
    remove: (id) => new Promise((resolve, reject) => chrome.bookmarks.remove(id, () => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError); else resolve();
    })),
  });

  // Tüm ağacı pre-order gezip URL node'larında visitor çağırır.
  const walkTree = (node, visitor) => {
    if (node.url) { visitor(node); return; }
    for (const child of (node.children || [])) walkTree(child, visitor);
  };

  // Saf fonksiyon: bir URL için yapılacak eylemi belirler.
  //   - skip: http/https dışı (chrome://, javascript:, file://, about:)
  //   - delete: path'li YouTube URL'si ve config izin veriyor
  //   - rename: hostname'e çevrilecek (YouTube ana sayfa dahil)
  const classifyBookmark = (url, config) => {
    try {
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return { action: 'skip' };
      let host = u.hostname.toLowerCase();
      if (host.startsWith('www.')) host = host.slice(4);
      const hasPath = u.pathname && u.pathname !== '/' && u.pathname !== '';

      if (config.cleanupYoutubePaths && config.ytDomains.has(host)) {
        if (hasPath) return { action: 'delete' };
        return { action: 'rename', newTitle: 'youtube.com' };
      }
      return { action: 'rename', newTitle: host };
    } catch { return { action: 'skip' }; }
  };

  // Saf fonksiyon: tüm yer imleri için karar listesi üretir.
  // finalTitleCount, işlem sonrası aynı başlığa sahip URL'leri uyarmak için.
  const analyzeAll = (bookmarks, config) => {
    const toDelete = [];
    const toRename = [];
    const finalTitleCount = {};
    let unchanged = 0, skipped = 0;

    for (const b of bookmarks) {
      const r = classifyBookmark(b.url, config);
      if (r.action === 'skip') { skipped++; continue; }
      if (r.action === 'delete') { toDelete.push(b); continue; }
      finalTitleCount[r.newTitle] = (finalTitleCount[r.newTitle] || 0) + 1;
      if ((b.title || '') === r.newTitle) { unchanged++; continue; }
      toRename.push({ id: b.id, oldTitle: b.title || '', newTitle: r.newTitle, url: b.url });
    }
    return { toDelete, toRename, finalTitleCount, unchanged, skipped };
  };

  const printAnalysis = (report, showSample, dryRun, log) => {
    const { toDelete, toRename, finalTitleCount, unchanged, skipped } = report;
    log(`======== ANALİZ (DRY_RUN=${dryRun}) ========`);
    log(`Silinecek (YouTube path'li): ${toDelete.length}`);
    log(`Yeniden adlandırılacak: ${toRename.length}`);
    log(`Zaten uygun: ${unchanged}`);
    log(`Atlanan (http/https dışı): ${skipped}`);

    const dupes = Object.entries(finalTitleCount).filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);
    if (dupes.length) {
      log('');
      log(`Dikkat: ${dupes.length} hostname birden fazla kez (aynı başlığa sahip olurlar):`);
      for (const [h, n] of dupes.slice(0, DUP_WARN_HEAD)) log(`  ${String(n).padStart(3)}  ${h}`);
      if (dupes.length > DUP_WARN_HEAD) log(`  ... ve ${dupes.length - DUP_WARN_HEAD} daha`);
      log('→ sonra 05-subfolder-by-hostname.js çalıştırın');
    }

    if (toDelete.length) {
      log('');
      log(`Silinecek örnekler:`);
      for (const b of toDelete.slice(0, showSample)) log(`  "${b.title || '(başlıksız)'}"   ${b.url.slice(0, 80)}`);
      if (toDelete.length > showSample) log(`  ... ve ${toDelete.length - showSample} daha`);
    }
    if (toRename.length) {
      log('');
      log(`Yeniden adlandırma örnekleri:`);
      for (const r of toRename.slice(0, showSample)) log(`  "${r.oldTitle}"  →  "${r.newTitle}"`);
      if (toRename.length > showSample) log(`  ... ve ${toRename.length - showSample} daha`);
    }
  };

  const applyChanges = async (report, api, log, warn) => {
    let deleted = 0, renamed = 0, errors = 0;
    for (const b of report.toDelete) {
      try { await api.remove(b.id); deleted++; }
      catch (e) { warn('remove fail:', b.url, e); errors++; }
    }
    for (const r of report.toRename) {
      try { await api.update(r.id, { title: r.newTitle }); renamed++; }
      catch (e) { warn('update fail:', r.url, e); errors++; }
    }
    return { deleted, renamed, errors };
  };

  // ======== MAIN ========
  const { log, warn } = makeLogger('rename');
  const api = makeApi();

  const tree = await api.getTree();
  const all = [];
  walkTree(tree[0], (node) => all.push(node));

  const config = { cleanupYoutubePaths: CLEANUP_YOUTUBE_PATHS, ytDomains: YT_DOMAINS };
  const report = analyzeAll(all, config);
  printAnalysis(report, SHOW_SAMPLE, DRY_RUN, log);

  if (DRY_RUN) {
    log('');
    log('DRY_RUN=true → değişiklik yok. Onayla: DRY_RUN=false');
    return { toDelete: report.toDelete.length, toRename: report.toRename.length };
  }

  const { deleted, renamed, errors } = await applyChanges(report, api, log, warn);

  // ======== SUMMARY ========
  log('');
  log('======== ÖZET ========');
  log(`Silinen: ${deleted}`);
  log(`Yeniden adlandırılan: ${renamed}`);
  log(`Hata: ${errors}`);
  log('TAMAMLANDI. 05-subfolder-by-hostname.js ve 08-sort.js çalıştırmak iyi olur.');
  return { deleted, renamed, errors };
})();
