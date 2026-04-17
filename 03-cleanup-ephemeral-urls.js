/**
 * 03 - Cleanup Ephemeral URLs
 *
 * Ne yapar: "Aramayla bulunabilir" kategorisindeki URL'leri (sosyal medya
 *   postları, e-ticaret ürün sayfaları, arama sonuçları, YouTube videoları,
 *   spesifik blog makaleleri) tespit eder ve siler. Ana sayfalar ve
 *   profiller korunur.
 *
 * Korunan (silinmeyen):
 *   - linkedin.com/in/<user>  (profil)
 *   - amazon.com, amazon.com.tr  (ana sayfa)
 *   - instagram.com/<user>  (profil)
 *   - duckduckgo.com/bangs
 *   - medium.com ana, reddit ana
 *
 * Nasıl kullanılır:
 *   1) DRY_RUN = true ile kategori bazlı rapor oku.
 *   2) İstemediğiniz kategoriyi PATTERNS listesinden yorum satırı yapın.
 *   3) DRY_RUN = false yap, uygula.
 *
 * chrome://bookmarks → F12 → Console → yapıştır → Enter.
 */
(async () => {
  'use strict';

  // ======== USER SETTINGS ========
  const DRY_RUN = true;
  const SHOW_PER_CATEGORY = 20;
  // Silinecek URL pattern'leri: [etiket, regex] çifti. İstemediğiniz satırı silin.
  const PATTERNS = [
    // Sosyal medya dinamik içerik
    ['LinkedIn post/feed/pulse',     /^https?:\/\/(www\.|tr\.)?linkedin\.com\/(posts|feed|pulse)\//i],
    ['LinkedIn job view',            /^https?:\/\/(www\.|tr\.)?linkedin\.com\/jobs\/view\//i],
    ['LinkedIn recent-activity',     /^https?:\/\/(www\.|tr\.)?linkedin\.com\/in\/[^/]+\/recent-activity/i],
    ['Facebook post/photo/video',    /^https?:\/\/(www\.|m\.)?facebook\.com\/(permalink|watch|story|photo|video|reel|share|[^/?#]+\/(posts|photos|videos|reels))/i],
    ['Instagram post/reel/tv',       /^https?:\/\/(www\.)?instagram\.com\/(p|reel|reels|tv|stories)\//i],
    ['TikTok video',                 /^https?:\/\/((www\.)?tiktok\.com\/@[^/]+\/(video|photo)\/|vm\.tiktok\.com\/)/i],
    ['Pinterest pin',                /^https?:\/\/(www\.|tr\.)?pinterest\.(com|com\.tr|de|fr|es|it|co\.uk|ca|nl|au|pt)\/pin\//i],

    // E-ticaret ürün sayfaları
    ['Amazon product',               /^https?:\/\/(www\.|smile\.)?amazon\.(com|com\.tr|co\.uk|de|fr|es|it|nl|ca|com\.au|com\.mx|com\.br|co\.jp|cn|in|ae|sa|se|pl|tr|eg)\/.*(\/dp\/|\/gp\/(product|offer-listing)|\/exec\/obidos)/i],
    ['Trendyol product',             /^https?:\/\/(www\.)?trendyol\.com\/.+-p-\d+/i],
    ['Hepsiburada product',          /^https?:\/\/(www\.)?hepsiburada\.com\/.+-p[A-Za-z]*\d+/i],
    ['Ebay item',                    /^https?:\/\/(www\.)?ebay\.(com|co\.uk|de|fr|es|it|com\.au|ca|com\.hk|com\.sg|com\.tr|nl|pl)\/itm\//i],
    ['Aliexpress item',              /^https?:\/\/[^/]*aliexpress\.(com|ru|us)\/item\//i],
    ['N11 product',                  /^https?:\/\/(www\.)?n11\.com\/urun\//i],

    // Arama sonuç sayfaları
    ['Google search',                /^https?:\/\/(www\.)?google\.[a-z.]+\/search\?/i],
    ['Bing search',                  /^https?:\/\/(www\.)?bing\.com\/search\?/i],
    ['DuckDuckGo search',            /^https?:\/\/(www\.)?duckduckgo\.com\/\?q=/i],
    ['Yandex search',                /^https?:\/\/(www\.)?yandex\.(com|ru|com\.tr)\/search/i],
    ['YouTube watch/short',          /^https?:\/\/(www\.|m\.|music\.)?(youtube\.com\/(watch|shorts)|youtu\.be\/)/i],

    // Forum threadleri
    ['Reddit post',                  /^https?:\/\/(www\.|old\.|new\.|m\.|np\.)?reddit\.com\/r\/[^/]+\/comments\//i],

    // Spesifik makaleler (ana sayfa değil, belirli yazı)
    ['Medium article',               /^https?:\/\/(www\.)?medium\.com\/[^/]+\/[^/?#]+$/i],
    ['Dev.to article',               /^https?:\/\/(www\.)?dev\.to\/[^/]+\/[^/?#]+$/i],
    ['Hashnode post',                /^https?:\/\/[^./]+\.hashnode\.(dev|com)\/[^/?#]+$/i],
  ];
  const BAR_TITLES = ['Bookmarks bar', 'Yer işareti çubuğu', 'Barre de favoris', 'Lesezeichenleiste'];
  // ================================

  // ======== CONSTANTS ========
  // Kaç silme başında bir ilerleme satırı yazılsın (sadece büyük ağaçlar için anlamlı).
  const PROGRESS_EVERY = 100;
  // ================================

  // ======== HELPERS ========
  const makeLogger = (prefix) => ({
    log: (...args) => console.log(`[${prefix}]`, ...args),
    warn: (...args) => console.warn(`[${prefix}]`, ...args),
    error: (...args) => console.error(`[${prefix}]`, ...args),
  });

  const makeApi = () => ({
    getTree: () => new Promise((resolve) => chrome.bookmarks.getTree(resolve)),
    remove: (id) => new Promise((resolve, reject) => chrome.bookmarks.remove(id, () => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError); else resolve();
    })),
  });

  const findBar = async (api, barTitles) => {
    const tree = await api.getTree();
    return tree[0].children.find((c) => c.id === '1' || barTitles.includes(c.title)) || null;
  };

  // Bar'ın kendi başlığı path'e dahil edilmez: kök klasörler path'in başlangıcıdır.
  const collectBookmarks = (bar) => {
    const all = [];
    const walk = (node, path) => {
      if (node.url) {
        all.push({ id: node.id, url: node.url, title: node.title || '', path });
        return;
      }
      const childPath = path ? path + '/' + node.title : node.title;
      for (const c of (node.children || [])) walk(c, childPath);
    };
    for (const c of (bar.children || [])) walk(c, '');
    return all;
  };

  // İlk eşleşen pattern etiketi veya null.
  const classifyUrl = (url, patterns) => {
    for (const [name, re] of patterns) if (re.test(url)) return name;
    return null;
  };

  const matchAgainstPatterns = (bookmarks, patterns) => {
    const matched = [];
    const byCategory = new Map();
    for (const b of bookmarks) {
      const cat = classifyUrl(b.url, patterns);
      if (!cat) continue;
      matched.push({ ...b, category: cat });
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat).push(b);
    }
    return { matched, byCategory };
  };

  const printCategoryReport = (total, matched, byCategory, showPerCategory, dryRun, log) => {
    log(`======== ANALİZ (DRY_RUN=${dryRun}) ========`);
    log(`Toplam ${total} URL tarandı, ${matched.length} eşleşme`);
    log('');
    const sorted = [...byCategory.entries()].sort((a, b) => b[1].length - a[1].length);
    for (const [cat, items] of sorted) log(`  ${String(items.length).padStart(4)}  ${cat}`);

    log('');
    log('======== KATEGORİ BAZLI ÖRNEKLER ========');
    for (const [cat, items] of sorted) {
      log(`\n[${cat}]  (${items.length} adet)`);
      for (const b of items.slice(0, showPerCategory)) {
        log(`  ${b.path || '(kök)'} / ${b.title.slice(0, 60) || '(başlıksız)'}`);
        log(`     ${b.url.slice(0, 100)}`);
      }
      if (items.length > showPerCategory) log(`  ... ve ${items.length - showPerCategory} daha`);
    }
  };

  // Progress log'u PROGRESS_EVERY adımda bir; büyük ağaçlarda ilerleme görünür.
  const applyDeletes = async (matched, api, log, warn, progressEvery) => {
    let deleted = 0, errors = 0;
    for (const b of matched) {
      try {
        await api.remove(b.id);
        deleted++;
        if (deleted % progressEvery === 0) log(`  ilerleme: ${deleted}/${matched.length}`);
      } catch (e) { warn('remove fail:', b.url, e); errors++; }
    }
    return { deleted, errors };
  };

  // ======== MAIN ========
  const { log, warn } = makeLogger('ephemeral');
  const api = makeApi();

  const bar = await findBar(api, BAR_TITLES);
  if (!bar) { console.error('[ephemeral] Yer imleri çubuğu bulunamadı'); return; }

  const all = collectBookmarks(bar);
  const { matched, byCategory } = matchAgainstPatterns(all, PATTERNS);
  printCategoryReport(all.length, matched, byCategory, SHOW_PER_CATEGORY, DRY_RUN, log);

  if (DRY_RUN) {
    log('');
    log('DRY_RUN=true → hiçbir silme yapılmadı. Onayla: DRY_RUN=false');
    return { total: matched.length };
  }

  const { deleted, errors } = await applyDeletes(matched, api, log, warn, PROGRESS_EVERY);

  // ======== SUMMARY ========
  log('');
  log('======== ÖZET ========');
  log(`Silinen: ${deleted}`);
  log(`Hata: ${errors}`);
  log('TAMAMLANDI');
  return { deleted, errors };
})();
