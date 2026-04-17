/**
 * 07 - Consolidate Brand
 *
 * Ne yapar: Parçalanmış markaları tek klasöre toplar. Bir "marka" iki yoldan
 *   tespit edilir:
 *     a) Başlık prefix'i: "Google | X", "Microsoft - Y" gibi
 *     b) Aynı registrable domain (eTLD+1): drive.google.com + mail.google.com
 *        → google.com
 *
 *   Aynı markaya ait URL'ler birden fazla klasöre dağılmışsa (≥2 klasör,
 *   ≥3 URL), tek bir "kanonik" konuma toplanır:
 *     1) Marka adıyla başlayan kök klasör varsa oraya
 *        (örn. "Google" prefix → mevcut "Google Services" klasörü)
 *     2) Yoksa: en sık bulunduğu ana kategori altında marka adıyla alt klasör
 *
 * Kök klasör çakışmalarını zorlamak için USER_PRIORITY_MAP ile manuel
 *   hedef tayini yapabilirsiniz.
 *
 * Nasıl kullanılır:
 *   1) DRY_RUN = true ile analizi oku.
 *   2) DRY_RUN = false yap, uygula.
 *
 * chrome://bookmarks → F12 → Console → yapıştır → Enter.
 */
(async () => {
  'use strict';

  // ======== USER SETTINGS ========
  const DRY_RUN = true;
  const MIN_GROUP = 3;                 // minimum URL sayısı
  const MIN_FOLDERS = 2;               // minimum farklı klasör sayısı
  const MIN_BRAND_LEN = 3;
  const MAX_BRAND_LEN = 30;
  const PREFIX_SEPARATORS = [' | ', ' - ', ' — ', ' – '];
  // Özel marka kuralları: registrable domain → hedef klasör path (boş = otomatik)
  const USER_PRIORITY_MAP = {
    // 'google.com': 'Google Services',
    // 'microsoft.com': 'Microsoft',
  };
  // İki seviyeli TLD'ler (Türkiye, UK, AU, vb.)
  const COMMON_SLDS = new Set([
    'gov.tr', 'com.tr', 'org.tr', 'net.tr', 'edu.tr', 'bel.tr', 'k12.tr',
    'co.uk', 'org.uk', 'gov.uk', 'ac.uk',
    'com.au', 'gov.au', 'edu.au',
    'co.jp', 'com.br', 'com.mx', 'co.in',
  ]);
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
    create: (details) => new Promise((resolve, reject) => chrome.bookmarks.create(details, (node) => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError); else resolve(node);
    })),
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

  const getHost = (url) => {
    try {
      let h = new URL(url).hostname.toLowerCase();
      if (h.startsWith('www.')) h = h.slice(4);
      return h;
    } catch { return ''; }
  };

  // eTLD+1 hesabı: iki seviyeli TLD'ler commonSlds ile tanımlı (örn. com.tr).
  const getRegistrable = (hostname, commonSlds) => {
    const parts = hostname.toLowerCase().split('.').filter(Boolean);
    if (parts.length < 2) return hostname.toLowerCase();
    const lastTwo = parts.slice(-2).join('.');
    if (commonSlds.has(lastTwo) && parts.length >= 3) return parts.slice(-3).join('.');
    return lastTwo;
  };

  // Başlıkta marka prefix'i: "Google | X" → "Google". Ayraçlar ve uzunluk
  // eşikleri dışarıdan gelir (farklı ayar için tekrar yazılmadan kullanılabilir).
  const extractPrefix = (title, separators, minLen, maxLen) => {
    if (!title) return null;
    for (const sep of separators) {
      const idx = title.indexOf(sep);
      if (idx >= minLen) {
        const prefix = title.slice(0, idx).trim();
        if (prefix.length >= minLen && prefix.length <= maxLen) return prefix;
      }
    }
    return null;
  };

  // Bar çocuklarından başlar (bar'ın kendi title'ı path'e dahil edilmez).
  // Her URL için path + parentId saklanır; consolidation için gerekli.
  const collectBookmarks = (bar) => {
    const all = [];
    const walk = (node, path) => {
      if (node.url) {
        all.push({ id: node.id, title: node.title || '', url: node.url, path, parentId: node.parentId });
        return;
      }
      const childPath = path ? path + '/' + node.title : node.title;
      for (const c of (node.children || [])) walk(c, childPath);
    };
    for (const c of (bar.children || [])) walk(c, '');
    return all;
  };

  // Her URL için önce prefix, yoksa registrable domain'in ilk parçasıyla
  // marka key'i üretir; aynı key'de toplanan URL'ler grup oluşturur.
  const buildBrandMap = (bookmarks, config) => {
    const { prefixSeparators, minBrandLen, maxBrandLen, commonSlds } = config;
    const brandMap = new Map();

    const ensureEntry = (key, init) => {
      if (!brandMap.has(key)) brandMap.set(key, init);
      return brandMap.get(key);
    };

    for (const it of bookmarks) {
      const prefix = extractPrefix(it.title, prefixSeparators, minBrandLen, maxBrandLen);
      const host = getHost(it.url);
      const reg = host ? getRegistrable(host, commonSlds) : '';
      const domainFirst = reg ? reg.split('.')[0] : '';

      if (prefix) {
        const entry = ensureEntry(prefix.toLocaleLowerCase(), { prefixName: prefix, regDomain: reg, items: [], viaPrefix: 0, viaDomain: 0 });
        entry.items.push(it);
        entry.viaPrefix++;
        if (!entry.regDomain && reg) entry.regDomain = reg;
      } else if (domainFirst) {
        const entry = ensureEntry(domainFirst.toLowerCase(), { prefixName: null, regDomain: reg, items: [], viaPrefix: 0, viaDomain: 0 });
        entry.items.push(it);
        entry.viaDomain++;
        if (!entry.regDomain) entry.regDomain = reg;
      }
    }
    return brandMap;
  };

  // Hedef konum seçimi üç öncelikle: (0) user map, (1) prefix'le eşleşen kök,
  // (2) en sık bulunduğu kök kategori + marka alt klasörü.
  const pickCanonical = (entry, rootFolders, userPriorityMap) => {
    if (entry.regDomain && userPriorityMap[entry.regDomain]) return userPriorityMap[entry.regDomain];

    if (entry.prefixName) {
      const lb = entry.prefixName.toLocaleLowerCase();
      for (const rf of rootFolders) {
        if (rf.title.toLocaleLowerCase().startsWith(lb)) return rf.title;
      }
    }

    const brandDisplay = entry.prefixName ? entry.prefixName : `*.${entry.regDomain}`;
    const rootCount = new Map();
    for (const i of entry.items) {
      const rc = i.path.split('/')[0];
      if (rc) rootCount.set(rc, (rootCount.get(rc) || 0) + 1);
    }
    const top = [...rootCount.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top) return `${top[0]}/${brandDisplay}`;
    return brandDisplay;
  };

  // Eşikten (MIN_GROUP + MIN_FOLDERS) geçenleri seçer; tek klasöre sıkışmış
  // markalar zaten toplu olduğu için liste dışıdır.
  const findFragmented = (brandMap, config) => {
    const fragmented = [];
    for (const [, entry] of brandMap) {
      if (entry.items.length < config.minGroup) continue;
      const folders = new Set(entry.items.map((i) => i.path));
      if (folders.size < config.minFolders) continue;
      const brand = entry.prefixName ? entry.prefixName : `*.${entry.regDomain}`;
      fragmented.push({
        brand,
        items: entry.items,
        folders: [...folders],
        canonical: pickCanonical(entry, config.rootFolders, config.userPriorityMap),
        viaPrefix: entry.viaPrefix,
        viaDomain: entry.viaDomain,
      });
    }
    return fragmented;
  };

  const printFragmentedReport = (fragmented, dryRun, log) => {
    log(`======== ANALİZ (DRY_RUN=${dryRun}) ========`);
    log(`Parçalanmış marka sayısı: ${fragmented.length}`);
    for (const f of fragmented) {
      log(`\n[${f.brand}]  (${f.items.length} öğe: ${f.viaPrefix} prefix + ${f.viaDomain} domain, ${f.folders.length} farklı klasörde)`);
      const byPath = {};
      for (const i of f.items) byPath[i.path] = (byPath[i.path] || 0) + 1;
      for (const [p, n] of Object.entries(byPath).sort((a, b) => b[1] - a[1])) {
        log(`    ${String(n).padStart(3)}  ${p || '(kök)'}`);
      }
      log(`    → kanonik: ${f.canonical}`);
    }
  };

  // Bar altından başlayarak path zincirini klasörler olarak oluşturur;
  // yoksa her eksik klasör yaratılır, varsa mevcut kullanılır.
  const ensurePath = async (barId, pathStr, api, log) => {
    const parts = pathStr.split('/');
    let currentId = barId;
    for (const part of parts) {
      const kids = await api.getChildren(currentId);
      let folder = kids.find((k) => !k.url && k.title === part);
      if (!folder) {
        folder = await api.create({ parentId: currentId, title: part });
        log(`  [+] klasör: ${pathStr}`);
      }
      currentId = folder.id;
    }
    return currentId;
  };

  const consolidateFragmented = async (fragmented, barId, api, log, warn) => {
    let moved = 0, inplace = 0, errors = 0;
    for (const f of fragmented) {
      try {
        const targetId = await ensurePath(barId, f.canonical, api, log);
        for (const item of f.items) {
          if (item.parentId === targetId) { inplace++; continue; }
          try { await api.move(item.id, { parentId: targetId }); moved++; }
          catch (e) { warn('move fail:', item.url, e); errors++; }
        }
      } catch (e) {
        warn('ensurePath fail:', f.canonical, e);
        errors += f.items.length;
      }
    }
    return { moved, inplace, errors };
  };

  // Konsolidasyon sonrası boşalan klasörleri siler; kök (bar) ve ilk seviye
  // ana kategoriler rootIds ile korunur (kullanıcının üst yapısı).
  const cleanEmptyFolders = async (barId, protectedIds, api) => {
    const walk = async (folderId) => {
      const kids = await api.getChildren(folderId);
      for (const k of kids) if (!k.url) await walk(k.id);
      const after = await api.getChildren(folderId);
      if (after.length === 0 && folderId !== barId && !protectedIds.has(folderId)) {
        try { await api.removeTree(folderId); } catch { /* yoksay, kritik değil */ }
      }
    };
    await walk(barId);
  };

  // ======== MAIN ========
  const { log, warn } = makeLogger('brand');
  const api = makeApi();

  const bar = await findBar(api, BAR_TITLES);
  if (!bar) { console.error('[brand] Yer imleri çubuğu bulunamadı'); return; }

  const bookmarks = collectBookmarks(bar);
  const rootKids = await api.getChildren(bar.id);
  const rootFolders = rootKids.filter((k) => !k.url);

  const config = {
    prefixSeparators: PREFIX_SEPARATORS,
    minBrandLen: MIN_BRAND_LEN,
    maxBrandLen: MAX_BRAND_LEN,
    commonSlds: COMMON_SLDS,
    minGroup: MIN_GROUP,
    minFolders: MIN_FOLDERS,
    rootFolders,
    userPriorityMap: USER_PRIORITY_MAP,
  };

  const brandMap = buildBrandMap(bookmarks, config);
  const fragmented = findFragmented(brandMap, config);
  fragmented.sort((a, b) => b.items.length - a.items.length);

  printFragmentedReport(fragmented, DRY_RUN, log);

  if (DRY_RUN) {
    log('');
    log('DRY_RUN=true → değişiklik yok. Onayla: DRY_RUN=false');
    return { fragmented: fragmented.length };
  }

  const { moved, inplace, errors } = await consolidateFragmented(fragmented, bar.id, api, log, warn);

  // Kök klasör id'leri korunur (kullanıcının üst kategori yapısı).
  const protectedIds = new Set((await api.getChildren(bar.id)).map((k) => k.id));
  await cleanEmptyFolders(bar.id, protectedIds, api);

  // ======== SUMMARY ========
  log('');
  log('======== ÖZET ========');
  log(`Konsolide edilen marka: ${fragmented.length}`);
  log(`Taşınan URL: ${moved}`);
  log(`Yerinde kalan: ${inplace}`);
  log(`Hata: ${errors}`);
  log('TAMAMLANDI. 01-sort.js ile sıralamayı yenileyin.');
  return { fragmented: fragmented.length, moved, inplace, errors };
})();
