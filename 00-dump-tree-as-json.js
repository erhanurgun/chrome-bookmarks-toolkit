/**
 * 00 - Dump Bookmark Tree As JSON
 *
 * Ne yapar: Tüm yer imi ağacını JSON dosyası olarak indirir. Bu dosya hem
 *   yedek hem de harici analiz (Python, jq, başka scriptler) için kaynak
 *   olarak kullanılabilir. Chrome'un kendi HTML export fonksiyonundan farklı
 *   olarak programatik işlemeye daha uygun ham yapıyı verir.
 *
 * Kullanım amaçları:
 *   - Harici script (Python/Node) ile kategori analizi yapmak
 *   - Büyük değişikliklerden önce hızlı ham yedek almak
 *   - İki farklı zamanın ağaç farkını karşılaştırmak
 *   - Debug: klasör ID'leri, tarihleri, guid'leri incelemek
 *
 * Hiçbir değişiklik yapmaz, sadece okur ve indirir.
 *
 * chrome://bookmarks → F12 → Console → yapıştır → Enter.
 */
(async () => {
  'use strict';

  // ======== USER SETTINGS ========
  const FILENAME = 'chrome-bookmarks-tree.json';
  const PRETTY_PRINT = true;   // false yaparsan tek satır compact JSON
  // ================================

  const log = (...a) => console.log('[dump]', ...a);

  const tree = await new Promise(r => chrome.bookmarks.getTree(r));

  // Basit istatistik
  let urlCount = 0, folderCount = 0, maxDepth = 0;
  const walk = (node, depth = 0) => {
    if (depth > maxDepth) maxDepth = depth;
    for (const c of (node.children || [])) {
      if (c.url) urlCount++;
      else { folderCount++; walk(c, depth + 1); }
    }
  };
  walk(tree[0]);

  const json = PRETTY_PRINT ? JSON.stringify(tree, null, 2) : JSON.stringify(tree);
  const blob = new Blob([json], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = FILENAME;
  a.click();
  URL.revokeObjectURL(a.href);

  log(`${FILENAME} indirildi`);
  log(`Boyut: ${(json.length / 1024).toFixed(1)} KB`);
  log(`Toplam URL: ${urlCount}, klasör: ${folderCount}, maksimum derinlik: ${maxDepth}`);
  log(`İndirme yeri: varsayılan Downloads klasörünüz`);
})();
