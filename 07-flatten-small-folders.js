/**
 * 07 - Flatten Small Folders
 *
 * Ne yapar: Az içerikli klasörleri düzleştirir. Seçenekler:
 *   - Boş klasörleri siler
 *   - Tek ögeli klasörleri düzleştirir (içeriği parent'a taşır, klasörü siler)
 *   - İsteğe bağlı: iki ögeli klasörleri de düzleştirir (daha agresif)
 *
 * Güvenlik: Kök seviyedeki (yer imleri çubuğunun doğrudan altındaki)
 *   klasörler düzleştirilmez; bunlar ana kategori çerçevenizdir.
 *
 * Nasıl kullanılır:
 *   1) DRY_RUN = true ile önizle.
 *   2) DRY_RUN = false yap, uygula.
 *
 * chrome://bookmarks → F12 → Console → yapıştır → Enter.
 */
(async () => {
  'use strict';

  // ======== USER SETTINGS ========
  const DRY_RUN = true;
  const DELETE_EMPTY = true;          // boş klasörleri sil
  const FLATTEN_SINGLE_ITEM = true;   // 1 ögeli klasörleri düzleştir
  const FLATTEN_TWO_ITEM = false;     // 2 ögeli klasörleri de düzleştir (risk: kategori kaybı)
  const MIN_DEPTH = 2;                // düzleştirme yalnız bu derinlik ve altında uygulanır
                                       // (1 = kök seviye ana klasörler; 2 = onların altı)
  const BAR_TITLES = ['Bookmarks bar', 'Yer işareti çubuğu', 'Barre de favoris', 'Lesezeichenleiste'];
  // ================================

  // ======== CONSTANTS ========
  // Her kategori için önizleme örnek listesinde gösterilecek ilk N klasör.
  const SAMPLE_HEAD = 15;
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
    get: (id) => new Promise((resolve) => chrome.bookmarks.get(id, resolve)),
    move: (id, dest) => new Promise((resolve, reject) => chrome.bookmarks.move(id, dest, (node) => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError); else resolve(node);
    })),
    removeTree: (id) => new Promise((resolve, reject) => chrome.bookmarks.removeTree(id, () => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError); else resolve();
    })),
  });

  const findBar = async (api, barTitles) => {
    const tree = await api.getTree();
    return tree[0].children.find((c) => c.id === '1' || barTitles.includes(c.title)) || null;
  };

  // Async tree walk: tüm klasörleri path + depth + childCount ile listeler.
  // childCount için ek getChildren çağrısı yapılır; büyük ağaçlarda yavaşlatabilir
  // ama kategorilemeden önce gerekli bilgidir.
  const collectFolders = async (barId, api) => {
    const folders = [];
    const walk = async (folderId, path, depth) => {
      const kids = await api.getChildren(folderId);
      for (const k of kids) {
        if (k.url) continue;
        const childCount = (await api.getChildren(k.id)).length;
        const childPath = path ? path + '/' + k.title : k.title;
        folders.push({ id: k.id, title: k.title, path: childPath, depth, childCount });
        await walk(k.id, childPath, depth + 1);
      }
    };
    await walk(barId, '', 1);
    return folders;
  };

  // Kök seviye (depth === 1) klasörlere dokunulmaması için MIN_DEPTH filtresi
  // tek ve iki ögeli listelere uygulanır; boşlar her derinlikte silinebilir.
  const categorize = (folders, config) => ({
    empty: folders.filter((f) => f.childCount === 0 && f.depth >= 1),
    single: folders.filter((f) => f.childCount === 1 && f.depth >= config.minDepth),
    two: folders.filter((f) => f.childCount === 2 && f.depth >= config.minDepth),
  });

  const printFolderSample = (label, list, headCount, log) => {
    if (list.length === 0) return;
    log('');
    log(`${label} (ilk ${headCount}):`);
    for (const f of list.slice(0, headCount)) log(`  [${f.childCount}]  ${f.path}`);
    if (list.length > headCount) log(`  ... ve ${list.length - headCount} daha`);
  };

  // Klasör içeriğini parent'a taşır, klasörü siler. Başarılı mı döner.
  // Taşıma sırasında tekil hata kabul edilebilir; boşalmayan klasör silinmez.
  const flattenFolder = async (folder, api, warn) => {
    try {
      const info = (await api.get(folder.id))[0];
      if (!info || !info.parentId) return false;
      const kids = await api.getChildren(folder.id);
      for (const k of kids) {
        try { await api.move(k.id, { parentId: info.parentId }); }
        catch (e) { warn('move fail:', k.title, e); }
      }
      const after = await api.getChildren(folder.id);
      if (after.length === 0) {
        await api.removeTree(folder.id);
        return true;
      }
      return false;
    } catch (e) {
      warn('flatten fail:', folder.path, e);
      return false;
    }
  };

  // ======== MAIN ========
  const { log, warn } = makeLogger('flatten');
  const api = makeApi();

  const bar = await findBar(api, BAR_TITLES);
  if (!bar) { console.error('[flatten] Yer imleri çubuğu bulunamadı'); return; }

  const config = {
    deleteEmpty: DELETE_EMPTY,
    flattenSingleItem: FLATTEN_SINGLE_ITEM,
    flattenTwoItem: FLATTEN_TWO_ITEM,
    minDepth: MIN_DEPTH,
  };

  const folders = await collectFolders(bar.id, api);
  const categories = categorize(folders, config);

  log(`======== ANALİZ (DRY_RUN=${DRY_RUN}) ========`);
  log(`Boş klasör: ${categories.empty.length}${config.deleteEmpty ? ' → silinecek' : ' (kapalı)'}`);
  log(`Tek ögeli: ${categories.single.length}${config.flattenSingleItem ? ' → düzleştirilecek' : ' (kapalı)'}`);
  log(`İki ögeli: ${categories.two.length}${config.flattenTwoItem ? ' → düzleştirilecek' : ' (kapalı)'}`);

  if (config.deleteEmpty) printFolderSample('Boş klasör', categories.empty, SAMPLE_HEAD, log);
  if (config.flattenSingleItem) printFolderSample('Tek ögeli', categories.single, SAMPLE_HEAD, log);
  if (config.flattenTwoItem) printFolderSample('İki ögeli', categories.two, SAMPLE_HEAD, log);

  if (DRY_RUN) {
    log('');
    log('DRY_RUN=true → değişiklik yok. Onayla: DRY_RUN=false');
    return { empty: categories.empty.length, single: categories.single.length, two: categories.two.length };
  }

  // Uygulama sırası iki ögeli → tek ögeli → boş.
  // İki ögeli düzleştirme parent'ta yeni tek ögeli yaratabildiği için
  // önce o ele alınır, ardından geride kalan tekler yakalanır.
  let flattened = 0, deleted = 0, errors = 0;

  if (config.flattenTwoItem) {
    log('İki ögeli düzleştirme...');
    for (const f of categories.two) if (await flattenFolder(f, api, warn)) flattened++;
  }
  if (config.flattenSingleItem) {
    log('Tek ögeli düzleştirme...');
    for (const f of categories.single) if (await flattenFolder(f, api, warn)) flattened++;
  }
  if (config.deleteEmpty) {
    log('Boş klasör silme...');
    for (const f of categories.empty) {
      try {
        const kids = await api.getChildren(f.id);
        if (kids.length === 0) { await api.removeTree(f.id); deleted++; }
      } catch { errors++; }
    }
  }

  // ======== SUMMARY ========
  log('');
  log('======== ÖZET ========');
  log(`Düzleştirilen: ${flattened}`);
  log(`Silinen boş: ${deleted}`);
  log(`Hata: ${errors}`);
  log('TAMAMLANDI. 08-sort.js ile sıralamayı yenilemek iyi olur.');
  return { flattened, deleted, errors };
})();
