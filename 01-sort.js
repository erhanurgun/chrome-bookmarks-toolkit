/**
 * 01 - Recursive A-Z Sort
 *
 * Ne yapar: Chrome yer imleri ağacında her klasör için alt klasörleri
 *   ve URL'leri alfabetik olarak sıralar. Klasörler önce, URL'ler sonra.
 *   "Other" (veya "Diğer") adıyla başlayan klasörleri kendi grubunun
 *   en sonuna alır.
 * Nasıl kullanılır: chrome://bookmarks → F12 → Console → kodu yapıştır → Enter.
 */
(async () => {
  'use strict';

  // ======== USER SETTINGS ========
  // Sıralamada sona atılacak klasör adları (büyük/küçük harf duyarsız).
  // Kendi dilinize göre ekleyin; örn. Almanca için 'Sonstiges'.
  const LAST_NAMES = ['other', 'diğer', 'misc', 'sonstiges'];
  // Locale: sıralama karşılaştırması bu dile göre yapılır.
  const LOCALE = 'tr';
  // Yer imleri çubuğu başlık varyasyonları (Chrome dil ayarı).
  const BAR_TITLES = ['Bookmarks bar', 'Yer işareti çubuğu', 'Barre de favoris', 'Lesezeichenleiste'];
  // ================================

  const api = {
    getTree: () => new Promise(r => chrome.bookmarks.getTree(r)),
    getChildren: (id) => new Promise(r => chrome.bookmarks.getChildren(id, r)),
    move: (id, dest) => new Promise((ok, fail) => chrome.bookmarks.move(id, dest, (n) => {
      if (chrome.runtime.lastError) fail(chrome.runtime.lastError); else ok(n);
    })),
  };
  const log = (...a) => console.log('[sort]', ...a);
  const warn = (...a) => console.warn('[sort]', ...a);

  // Türkçe locale duyarlı ve sayı-aware karşılaştırma.
  const cmp = (a, b) => {
    const ta = (a.title || '').toString();
    const tb = (b.title || '').toString();
    if (!ta && tb) return 1;
    if (ta && !tb) return -1;
    return ta.localeCompare(tb, LOCALE, { sensitivity: 'base', numeric: true });
  };

  // Bir öge "en sonda" konuma aday mı?
  const isLastGroup = (item) => {
    const t = (item.title || '').trim().toLocaleLowerCase(LOCALE);
    return LAST_NAMES.some(n => t === n || t.startsWith(n + ' '));
  };

  // Normal öğeler A-Z, "Other/Diğer" grubu en sona (kendi içinde A-Z).
  const sortWithLastGroup = (items) => {
    const regular = items.filter(i => !isLastGroup(i));
    const lastGroup = items.filter(i => isLastGroup(i));
    regular.sort(cmp);
    lastGroup.sort(cmp);
    return [...regular, ...lastGroup];
  };

  const tree = await api.getTree();
  const bar = tree[0].children.find(c => c.id === '1' || BAR_TITLES.includes(c.title));
  if (!bar) { console.error('[sort] Yer imleri çubuğu bulunamadı'); return; }

  let foldersSorted = 0, itemsMoved = 0, errors = 0;

  const sortFolder = async (folderId) => {
    const kids = await api.getChildren(folderId);
    if (kids.length === 0) return;

    const folders = kids.filter(k => !k.url);
    const urls = kids.filter(k => k.url);
    const desired = [...sortWithLastGroup(folders), ...sortWithLastGroup(urls)];

    // Zaten sıralıysa atla (gereksiz API çağrısı yok).
    let alreadySorted = true;
    for (let i = 0; i < kids.length; i++) {
      if (kids[i].id !== desired[i].id) { alreadySorted = false; break; }
    }

    if (!alreadySorted) {
      // Her ögeyi sırayla sona gönder; final sıra desired ile eşleşir.
      for (const item of desired) {
        try {
          await api.move(item.id, { parentId: folderId });
          itemsMoved++;
        } catch (e) { warn('move fail:', item.title, e); errors++; }
      }
    }
    foldersSorted++;

    for (const f of folders) await sortFolder(f.id);
  };

  log('Sıralama başladı...');
  const t0 = performance.now();
  await sortFolder(bar.id);
  const dt = ((performance.now() - t0) / 1000).toFixed(1);

  log('======== ÖZET ========');
  log(`İşlenen klasör: ${foldersSorted}`);
  log(`Taşınan öğe: ${itemsMoved}`);
  log(`Hata: ${errors}`);
  log(`Süre: ${dt} saniye`);
  log('TAMAMLANDI');
  return { foldersSorted, itemsMoved, errors };
})();
