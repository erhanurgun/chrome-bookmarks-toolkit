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
  });

  // Yer imleri çubuğu node'unu bulur; Chrome dil ayarına göre başlık değişebildiği
  // için hem sabit id '1' hem de bilinen başlık listesi üzerinden arar.
  const findBar = async (api, barTitles) => {
    const tree = await api.getTree();
    return tree[0].children.find((c) => c.id === '1' || barTitles.includes(c.title)) || null;
  };

  // Locale duyarlı + sayı farkındalı başlık karşılaştırıcı factory.
  // Boş başlıklar sona gider (Chrome'un kendi davranışını taklit eder).
  const makeTitleComparator = (locale) => (a, b) => {
    const ta = (a.title || '').toString();
    const tb = (b.title || '').toString();
    if (!ta && tb) return 1;
    if (ta && !tb) return -1;
    return ta.localeCompare(tb, locale, { sensitivity: 'base', numeric: true });
  };

  // "Other / Diğer / Misc" gibi isimlerin grubun sonuna atılması için eşleşme testi:
  // tam eşit ya da isim + boşluk ile başlayan prefix (örn. "Other stuff").
  const isInLastGroup = (item, lastNames, locale) => {
    const t = (item.title || '').trim().toLocaleLowerCase(locale);
    return lastNames.some((n) => t === n || t.startsWith(n + ' '));
  };

  // Normal öğeler önce (A-Z), "last group" ögeleri en sonda (kendi içinde A-Z).
  const sortWithLastGroupBehind = (items, isLast, cmp) => {
    const regular = items.filter((i) => !isLast(i));
    const lastGroup = items.filter((i) => isLast(i));
    regular.sort(cmp);
    lastGroup.sort(cmp);
    return [...regular, ...lastGroup];
  };

  // ======== MAIN ========
  const { log, warn } = makeLogger('sort');
  const api = makeApi();
  const compare = makeTitleComparator(LOCALE);
  const isLast = (item) => isInLastGroup(item, LAST_NAMES, LOCALE);

  const bar = await findBar(api, BAR_TITLES);
  if (!bar) { console.error('[sort] Yer imleri çubuğu bulunamadı'); return; }

  let foldersSorted = 0, itemsMoved = 0, errors = 0;

  // Bir klasördeki istenen sıralı öğe listesi: klasörler önce, URL'ler sonra.
  // Her iki grup kendi içinde A-Z + "last group" sonda.
  const getDesiredOrder = (kids) => {
    const folders = kids.filter((k) => !k.url);
    const urls = kids.filter((k) => k.url);
    return [
      ...sortWithLastGroupBehind(folders, isLast, compare),
      ...sortWithLastGroupBehind(urls, isLast, compare),
    ];
  };

  // İstenen sıraya getirmek için her ögeyi sırayla sona taşır.
  // Chrome API atomic "reorder" sağlamadığından tek yol budur.
  const applyOrder = async (folderId, desired) => {
    for (const item of desired) {
      try {
        await api.move(item.id, { parentId: folderId });
        itemsMoved++;
      } catch (e) {
        warn('move fail:', item.title, e);
        errors++;
      }
    }
  };

  const sortFolder = async (folderId) => {
    const kids = await api.getChildren(folderId);
    if (kids.length === 0) return;

    const desired = getDesiredOrder(kids);
    const alreadySorted = kids.every((k, i) => k.id === desired[i].id);
    if (!alreadySorted) await applyOrder(folderId, desired);
    foldersSorted++;

    // Recursion orijinal (sıralamadan önceki) klasör listesi üzerinde ilerler;
    // sıralama API çağrıları subfolder set'ini değiştirmez.
    const subfolders = kids.filter((k) => !k.url);
    for (const sf of subfolders) await sortFolder(sf.id);
  };

  log('Sıralama başladı...');
  const t0 = performance.now();
  await sortFolder(bar.id);
  const dt = ((performance.now() - t0) / 1000).toFixed(1);

  // ======== SUMMARY ========
  log('');
  log('======== ÖZET ========');
  log(`İşlenen klasör: ${foldersSorted}`);
  log(`Taşınan öğe: ${itemsMoved}`);
  log(`Hata: ${errors}`);
  log(`Süre: ${dt} saniye`);
  log('TAMAMLANDI');
  return { foldersSorted, itemsMoved, errors };
})();
