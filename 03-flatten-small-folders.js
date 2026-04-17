/**
 * 03 - Flatten Small Folders
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

  const api = {
    getTree: () => new Promise(r => chrome.bookmarks.getTree(r)),
    getChildren: (id) => new Promise(r => chrome.bookmarks.getChildren(id, r)),
    move: (id, dest) => new Promise((ok, fail) => chrome.bookmarks.move(id, dest, (n) => {
      if (chrome.runtime.lastError) fail(chrome.runtime.lastError); else ok(n);
    })),
    removeTree: (id) => new Promise((ok, fail) => chrome.bookmarks.removeTree(id, () => {
      if (chrome.runtime.lastError) fail(chrome.runtime.lastError); else ok();
    })),
    get: (id) => new Promise(r => chrome.bookmarks.get(id, r)),
  };
  const log = (...a) => console.log('[flatten]', ...a);
  const warn = (...a) => console.warn('[flatten]', ...a);

  const tree = await api.getTree();
  const bar = tree[0].children.find(c => c.id === '1' || BAR_TITLES.includes(c.title));
  if (!bar) { console.error('[flatten] Yer imleri çubuğu bulunamadı'); return; }

  // Önce tüm klasörleri düz listeye çıkar (path + depth bilgili)
  const folders = [];
  const walk = async (id, path, depth) => {
    const kids = await api.getChildren(id);
    for (const k of kids) {
      if (!k.url) {
        folders.push({ id: k.id, title: k.title, path: path ? path + '/' + k.title : k.title, depth, childCount: (await api.getChildren(k.id)).length });
        await walk(k.id, path ? path + '/' + k.title : k.title, depth + 1);
      }
    }
  };
  await walk(bar.id, '', 1);

  // Kategorilere ayır
  const empty = folders.filter(f => f.childCount === 0 && f.depth >= 1);
  const single = folders.filter(f => f.childCount === 1 && f.depth >= MIN_DEPTH);
  const two = folders.filter(f => f.childCount === 2 && f.depth >= MIN_DEPTH);

  log(`======== ANALİZ (DRY_RUN=${DRY_RUN}) ========`);
  log(`Boş klasör: ${empty.length}${DELETE_EMPTY ? ' → silinecek' : ' (kapalı)'}`);
  log(`Tek ögeli: ${single.length}${FLATTEN_SINGLE_ITEM ? ' → düzleştirilecek' : ' (kapalı)'}`);
  log(`İki ögeli: ${two.length}${FLATTEN_TWO_ITEM ? ' → düzleştirilecek' : ' (kapalı)'}`);

  const showSample = (list, label) => {
    if (list.length === 0) return;
    log('');
    log(`${label} (ilk 15):`);
    for (const f of list.slice(0, 15)) log(`  [${f.childCount}]  ${f.path}`);
    if (list.length > 15) log(`  ... ve ${list.length - 15} daha`);
  };
  if (DELETE_EMPTY) showSample(empty, 'Boş klasör');
  if (FLATTEN_SINGLE_ITEM) showSample(single, 'Tek ögeli');
  if (FLATTEN_TWO_ITEM) showSample(two, 'İki ögeli');

  if (DRY_RUN) {
    log('');
    log('DRY_RUN=true → değişiklik yok. Onayla: DRY_RUN=false');
    return { empty: empty.length, single: single.length, two: two.length };
  }

  // Düzleştirme yardımcısı: klasör içeriğini parent'a taşır, klasörü siler
  const flatten = async (folder) => {
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
    } catch (e) { warn('flatten fail:', folder.path, e); return false; }
  };

  let flattened = 0, deleted = 0, errors = 0;

  // Önce en agresif (iki ögeli), sonra tek, sonra boş.
  // Sıra önemli: iki ögeli düzleştirme parent'ta yeni tekli oluşturabilir.
  if (FLATTEN_TWO_ITEM) {
    log('İki ögeli düzleştirme...');
    for (const f of two) if (await flatten(f)) flattened++;
  }
  if (FLATTEN_SINGLE_ITEM) {
    log('Tek ögeli düzleştirme...');
    for (const f of single) if (await flatten(f)) flattened++;
  }
  if (DELETE_EMPTY) {
    log('Boş klasör silme...');
    for (const f of empty) {
      try {
        const kids = await api.getChildren(f.id);
        if (kids.length === 0) { await api.removeTree(f.id); deleted++; }
      } catch (e) { errors++; }
    }
  }

  log('');
  log('======== ÖZET ========');
  log(`Düzleştirilen: ${flattened}`);
  log(`Silinen boş: ${deleted}`);
  log(`Hata: ${errors}`);
  log('TAMAMLANDI. 01-sort.js ile sıralamayı yenilemek iyi olur.');
  return { flattened, deleted, errors };
})();
