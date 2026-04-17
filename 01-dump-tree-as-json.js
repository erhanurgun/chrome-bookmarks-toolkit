/**
 * 01 - Dump Bookmark Tree As JSON
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

  // ======== HELPERS ========
  const makeLogger = (prefix) => ({
    log: (...args) => console.log(`[${prefix}]`, ...args),
    warn: (...args) => console.warn(`[${prefix}]`, ...args),
    error: (...args) => console.error(`[${prefix}]`, ...args),
  });

  const makeApi = () => ({
    getTree: () => new Promise((resolve) => chrome.bookmarks.getTree(resolve)),
  });

  // Tüm ağacı tek geçişte gezip URL/klasör/derinlik istatistiği toplar.
  const collectStats = (root) => {
    const stats = { urlCount: 0, folderCount: 0, maxDepth: 0 };
    const walk = (node, depth) => {
      if (depth > stats.maxDepth) stats.maxDepth = depth;
      for (const child of (node.children || [])) {
        if (child.url) stats.urlCount++;
        else { stats.folderCount++; walk(child, depth + 1); }
      }
    };
    walk(root, 0);
    return stats;
  };

  // Tarayıcıda programatik indirme: geçici anchor + blob URL.
  const downloadBlob = (filename, content, mimeType) => {
    const blob = new Blob([content], { type: mimeType });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  };

  // ======== MAIN ========
  const { log } = makeLogger('dump');
  const api = makeApi();

  const tree = await api.getTree();
  const stats = collectStats(tree[0]);
  const json = PRETTY_PRINT ? JSON.stringify(tree, null, 2) : JSON.stringify(tree);

  downloadBlob(FILENAME, json, 'application/json');

  // ======== SUMMARY ========
  log(`${FILENAME} indirildi`);
  log(`Boyut: ${(json.length / 1024).toFixed(1)} KB`);
  log(`Toplam URL: ${stats.urlCount}, klasör: ${stats.folderCount}, maksimum derinlik: ${stats.maxDepth}`);
  log(`İndirme yeri: varsayılan Downloads klasörünüz`);
})();
