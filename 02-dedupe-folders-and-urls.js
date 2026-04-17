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

  const api = {
    getTree: () => new Promise(r => chrome.bookmarks.getTree(r)),
    getChildren: (id) => new Promise(r => chrome.bookmarks.getChildren(id, r)),
    move: (id, dest) => new Promise((ok, fail) => chrome.bookmarks.move(id, dest, (n) => {
      if (chrome.runtime.lastError) fail(chrome.runtime.lastError); else ok(n);
    })),
    remove: (id) => new Promise((ok, fail) => chrome.bookmarks.remove(id, () => {
      if (chrome.runtime.lastError) fail(chrome.runtime.lastError); else ok();
    })),
    removeTree: (id) => new Promise((ok, fail) => chrome.bookmarks.removeTree(id, () => {
      if (chrome.runtime.lastError) fail(chrome.runtime.lastError); else ok();
    })),
  };
  const log = (...a) => console.log('[dedupe]', ...a);
  const warn = (...a) => console.warn('[dedupe]', ...a);

  // URL normalize: aynı adresin farklı yazımlarını eşitler.
  const normalizeUrl = (url) => {
    try {
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return url;
      let host = u.hostname.toLowerCase();
      if (host.startsWith('www.')) host = host.slice(4);
      const defaultPorts = { 'http:': '80', 'https:': '443' };
      const port = u.port === defaultPorts[u.protocol] ? '' : (u.port ? ':' + u.port : '');
      let path = u.pathname || '';
      if (path.endsWith('/') && path.length > 1) path = path.slice(0, -1);
      const params = new URLSearchParams(u.search);
      const kept = [];
      for (const [k, v] of params) if (!TRACKING_PARAMS.test(k)) kept.push([k, v]);
      kept.sort((a, b) => a[0].localeCompare(b[0]));
      const query = kept.length
        ? '?' + kept.map(([k, v]) => v === '' ? encodeURIComponent(k) : encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&')
        : '';
      let frag = u.hash || '';
      if (frag && !frag.includes('/') && !frag.includes('?') && !frag.includes('=')) frag = '';
      return u.protocol + '//' + host + port + path + query + frag;
    } catch { return url; }
  };

  const tree = await api.getTree();
  const bar = tree[0].children.find(c => c.id === '1' || BAR_TITLES.includes(c.title));
  if (!bar) { console.error('[dedupe] Yer imleri çubuğu bulunamadı'); return; }

  let foldersMerged = 0, foldersRemoved = 0, urlsRemoved = 0, errors = 0;
  const mergeLog = [];

  const dedupeFolder = async (folderId, path) => {
    let kids = await api.getChildren(folderId);

    // 1) Aynı isimde alt klasörleri grupla
    const folderGroups = new Map();
    for (const k of kids) {
      if (!k.url) {
        if (!folderGroups.has(k.title)) folderGroups.set(k.title, []);
        folderGroups.get(k.title).push(k);
      }
    }

    // Birleştir: grup[0] korunur, diğerlerinin içeriği oraya taşınır.
    for (const [name, group] of folderGroups) {
      if (group.length <= 1) continue;
      foldersMerged++;
      foldersRemoved += group.length - 1;
      mergeLog.push({ path: path ? path + '/' + name : name, count: group.length });
      if (DRY_RUN) continue;

      const keep = group[0];
      for (let i = 1; i < group.length; i++) {
        const dup = group[i];
        try {
          const dupKids = await api.getChildren(dup.id);
          for (const dk of dupKids) {
            try { await api.move(dk.id, { parentId: keep.id }); }
            catch (e) { errors++; warn('move fail:', dk.title, e); }
          }
          await api.removeTree(dup.id);
        } catch (e) { warn('merge fail:', name, e); errors++; }
      }
    }

    // 2) Güncel children (klasör birleştirmesi sonrası değişmiş olabilir)
    kids = await api.getChildren(folderId);

    // 3) Aynı klasör içinde duplicate URL'leri dedup et (ilk korunur).
    const seen = new Map();
    for (const k of kids) {
      if (!k.url) continue;
      const nu = normalizeUrl(k.url);
      if (seen.has(nu)) {
        urlsRemoved++;
        if (!DRY_RUN) {
          try { await api.remove(k.id); }
          catch (e) { errors++; warn('remove fail:', k.url, e); }
        }
      } else {
        seen.set(nu, k);
      }
    }

    // 4) Rekursif iniş
    const finalKids = await api.getChildren(folderId);
    for (const k of finalKids) {
      if (!k.url) await dedupeFolder(k.id, path ? path + '/' + k.title : k.title);
    }
  };

  log(`Başlıyor (DRY_RUN=${DRY_RUN})...`);
  const t0 = performance.now();
  await dedupeFolder(bar.id, '');
  const dt = ((performance.now() - t0) / 1000).toFixed(1);

  log('');
  log('======== FOLDER MERGE DETAYI (ilk 30) ========');
  mergeLog.sort((a, b) => b.count - a.count);
  for (const m of mergeLog.slice(0, 30)) log(`  ${String(m.count).padStart(3)}x  ${m.path}`);
  if (mergeLog.length > 30) log(`  ... ve ${mergeLog.length - 30} daha`);

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
