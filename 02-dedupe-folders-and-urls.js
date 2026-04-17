/**
 * 02 - Dedupe Folders and URLs
 *
 * Ne yapar:
 *   1) Aynı parent altında aynı isimde duplicate klasörleri birleştirir
 *      (içerikleri ilk klasöre taşır, diğerlerini siler).
 *   2) Her klasör içinde aynı URL'ye sahip duplicate yer imlerini dedup eder.
 *      URL karşılaştırması normalize edilmiş haliyle yapılır (www, scheme,
 *      trailing slash, utm/fbclid/gclid gibi tracking paramları temizlenir).
 *   3) Rekursif: tüm ağaç gezilir.
 *
 * Nasıl kullanılır:
 *   1) DRY_RUN = true ile çalıştır, raporu oku.
 *   2) DRY_RUN = false yap, yeniden yapıştır → uygula.
 *
 * chrome://bookmarks → F12 → Console → yapıştır → Enter.
 */
(async () => {
  'use strict';

  // ======== USER SETTINGS ========
  const DRY_RUN = true;
  const BAR_TITLES = ['Bookmarks bar', 'Yer işareti çubuğu', 'Barre de favoris', 'Lesezeichenleiste'];
  // Normalize sırasında silinecek query paramları.
  const TRACKING_PARAMS = /^(utm_.*|fbclid|gclid|mc_cid|mc_eid|ref|ref_src|ref_url|igshid|yclid|dclid|msclkid)$/i;
  // ================================

  // ======== CONSTANTS ========
  // Merge raporunda gösterilecek en büyük N grup.
  const MERGE_LOG_HEAD = 30;
  const DEFAULT_PORTS = { 'http:': '80', 'https:': '443' };
  // ================================

  // ======== HELPERS ========
  const makeLogger = (prefix) => ({
    log: (...args) => console.log(`[${prefix}]`, ...args),
    warn: (...args) => console.warn(`[${prefix}]`, ...args),
    error: (...args) => console.error(`[${prefix}]`, ...args),
  });

  const makeApi = () => ({
    getTree: () => new Promise((resolve) => chrome.bookmarks.getTree(resolve)),
    getChildren: (id) => new Promise((resolve) => chrome.bookmarks.getChildren(id, resolve)),
    move: (id, dest) => new Promise((resolve, reject) => chrome.bookmarks.move(id, dest, (node) => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError); else resolve(node);
    })),
    remove: (id) => new Promise((resolve, reject) => chrome.bookmarks.remove(id, () => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError); else resolve();
    })),
    removeTree: (id) => new Promise((resolve, reject) => chrome.bookmarks.removeTree(id, () => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError); else resolve();
    })),
  });

  const findBar = async (api, barTitles) => {
    const tree = await api.getTree();
    return tree[0].children.find((c) => c.id === '1' || barTitles.includes(c.title)) || null;
  };

  // URL normalize: aynı adresin farklı yazımlarını eşitler.
  // http/https dışı şemalar dokunulmadan döner (chrome://, javascript: vb.).
  const normalizeUrl = (url, trackingRegex) => {
    try {
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return url;
      let host = u.hostname.toLowerCase();
      if (host.startsWith('www.')) host = host.slice(4);
      const port = u.port === DEFAULT_PORTS[u.protocol] ? '' : (u.port ? ':' + u.port : '');
      let path = u.pathname || '';
      if (path.endsWith('/') && path.length > 1) path = path.slice(0, -1);
      const params = new URLSearchParams(u.search);
      const kept = [];
      for (const [k, v] of params) if (!trackingRegex.test(k)) kept.push([k, v]);
      kept.sort((a, b) => a[0].localeCompare(b[0]));
      const query = kept.length
        ? '?' + kept.map(([k, v]) => v === '' ? encodeURIComponent(k) : encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&')
        : '';
      let frag = u.hash || '';
      // SPA fragment'i (örn. #/path, #?k=v) korunur; boş anchor atılır.
      if (frag && !frag.includes('/') && !frag.includes('?') && !frag.includes('=')) frag = '';
      return u.protocol + '//' + host + port + path + query + frag;
    } catch { return url; }
  };

  // Aynı parent altında aynı isimdeki folder'ları birleştirir.
  // Grubun ilki korunur, diğerlerinin içeriği oraya taşınır, boş kalan silinir.
  const mergeDuplicateFolders = async (folderId, path, ctx) => {
    const kids = await ctx.api.getChildren(folderId);
    const folderGroups = new Map();
    for (const k of kids) {
      if (k.url) continue;
      if (!folderGroups.has(k.title)) folderGroups.set(k.title, []);
      folderGroups.get(k.title).push(k);
    }

    for (const [name, group] of folderGroups) {
      if (group.length <= 1) continue;
      ctx.counters.foldersMerged++;
      ctx.counters.foldersRemoved += group.length - 1;
      ctx.mergeLog.push({ path: path ? path + '/' + name : name, count: group.length });
      if (ctx.dryRun) continue;

      const keep = group[0];
      for (let i = 1; i < group.length; i++) {
        const dup = group[i];
        try {
          const dupKids = await ctx.api.getChildren(dup.id);
          for (const dk of dupKids) {
            try { await ctx.api.move(dk.id, { parentId: keep.id }); }
            catch (e) { ctx.counters.errors++; ctx.warn('move fail:', dk.title, e); }
          }
          await ctx.api.removeTree(dup.id);
        } catch (e) { ctx.warn('merge fail:', name, e); ctx.counters.errors++; }
      }
    }
  };

  // Aynı klasör içinde normalize-eşit URL'leri dedup eder (ilki korunur).
  const dedupeFolderUrls = async (folderId, ctx) => {
    const kids = await ctx.api.getChildren(folderId);
    const seen = new Map();
    for (const k of kids) {
      if (!k.url) continue;
      const nu = normalizeUrl(k.url, ctx.trackingRegex);
      if (seen.has(nu)) {
        ctx.counters.urlsRemoved++;
        if (!ctx.dryRun) {
          try { await ctx.api.remove(k.id); }
          catch (e) { ctx.counters.errors++; ctx.warn('remove fail:', k.url, e); }
        }
      } else {
        seen.set(nu, k);
      }
    }
  };

  // Rekursif tarama: önce folder merge, sonra URL dedup, sonra alt klasörlere iniş.
  // Sıra önemli: merge sonrası klasör listesi değişmiş olabilir, yeniden okunur.
  const traverseAndDedupe = async (folderId, path, ctx) => {
    await mergeDuplicateFolders(folderId, path, ctx);
    await dedupeFolderUrls(folderId, ctx);
    const finalKids = await ctx.api.getChildren(folderId);
    for (const k of finalKids) {
      if (k.url) continue;
      const childPath = path ? path + '/' + k.title : k.title;
      await traverseAndDedupe(k.id, childPath, ctx);
    }
  };

  const formatMergeReport = (mergeLog, head, log) => {
    log('');
    log(`======== FOLDER MERGE DETAYI (ilk ${head}) ========`);
    mergeLog.sort((a, b) => b.count - a.count);
    for (const m of mergeLog.slice(0, head)) log(`  ${String(m.count).padStart(3)}x  ${m.path}`);
    if (mergeLog.length > head) log(`  ... ve ${mergeLog.length - head} daha`);
  };

  // ======== MAIN ========
  const { log, warn } = makeLogger('dedupe');
  const api = makeApi();

  const bar = await findBar(api, BAR_TITLES);
  if (!bar) { console.error('[dedupe] Yer imleri çubuğu bulunamadı'); return; }

  const ctx = {
    api,
    warn,
    dryRun: DRY_RUN,
    trackingRegex: TRACKING_PARAMS,
    mergeLog: [],
    counters: { foldersMerged: 0, foldersRemoved: 0, urlsRemoved: 0, errors: 0 },
  };

  log(`Başlıyor (DRY_RUN=${DRY_RUN})...`);
  const t0 = performance.now();
  await traverseAndDedupe(bar.id, '', ctx);
  const dt = ((performance.now() - t0) / 1000).toFixed(1);

  formatMergeReport(ctx.mergeLog, MERGE_LOG_HEAD, log);

  // ======== SUMMARY ========
  const { foldersMerged, foldersRemoved, urlsRemoved, errors } = ctx.counters;
  log('');
  log('======== ÖZET ========');
  log(`Birleştirilen klasör grubu: ${foldersMerged}`);
  log(`Silinen duplicate klasör: ${foldersRemoved}`);
  log(`Silinen duplicate URL: ${urlsRemoved}`);
  log(`Hata: ${errors}`);
  log(`Süre: ${dt} saniye`);
  if (DRY_RUN) log('DRY_RUN=true → değişiklik yapılmadı. Onayla: DRY_RUN=false');
  else log('TAMAMLANDI. 01-sort.js çalıştırmak iyi olur.');
  return { foldersMerged, foldersRemoved, urlsRemoved, errors };
})();
