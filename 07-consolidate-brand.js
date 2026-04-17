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

  const api = {
    getTree: () => new Promise(r => chrome.bookmarks.getTree(r)),
    getChildren: (id) => new Promise(r => chrome.bookmarks.getChildren(id, r)),
    create: (det) => new Promise((ok, fail) => chrome.bookmarks.create(det, (n) => {
      if (chrome.runtime.lastError) fail(chrome.runtime.lastError); else ok(n);
    })),
    move: (id, dest) => new Promise((ok, fail) => chrome.bookmarks.move(id, dest, (n) => {
      if (chrome.runtime.lastError) fail(chrome.runtime.lastError); else ok(n);
    })),
    removeTree: (id) => new Promise((ok, fail) => chrome.bookmarks.removeTree(id, () => {
      if (chrome.runtime.lastError) fail(chrome.runtime.lastError); else ok();
    })),
  };
  const log = (...a) => console.log('[brand]', ...a);
  const warn = (...a) => console.warn('[brand]', ...a);

  const getRegistrable = (hostname) => {
    const parts = hostname.toLowerCase().split('.').filter(Boolean);
    if (parts.length < 2) return hostname.toLowerCase();
    const lastTwo = parts.slice(-2).join('.');
    if (COMMON_SLDS.has(lastTwo) && parts.length >= 3) return parts.slice(-3).join('.');
    return lastTwo;
  };

  const getHost = (url) => {
    try {
      let h = new URL(url).hostname.toLowerCase();
      if (h.startsWith('www.')) h = h.slice(4);
      return h;
    } catch { return ''; }
  };

  const extractPrefix = (title) => {
    if (!title) return null;
    for (const sep of PREFIX_SEPARATORS) {
      const idx = title.indexOf(sep);
      if (idx >= MIN_BRAND_LEN) {
        const prefix = title.slice(0, idx).trim();
        if (prefix.length >= MIN_BRAND_LEN && prefix.length <= 30) return prefix;
      }
    }
    return null;
  };

  const tree = await api.getTree();
  const bar = tree[0].children.find(c => c.id === '1' || BAR_TITLES.includes(c.title));
  if (!bar) { console.error('[brand] Yer imleri çubuğu bulunamadı'); return; }

  // Tüm URL'leri path bilgili düz listeye çıkar
  const all = [];
  const walk = (node, path = '') => {
    if (node.url) { all.push({ id: node.id, title: node.title || '', url: node.url, path, parentId: node.parentId }); return; }
    const t = (node.id === bar.id) ? '' : node.title;
    const mp = t ? (path ? path + '/' + t : t) : path;
    for (const c of (node.children || [])) walk(c, mp);
  };
  walk(bar);

  const rootKids = await api.getChildren(bar.id);
  const rootFolders = rootKids.filter(k => !k.url);

  // Marka haritası: key (lowercase) → { prefixName, regDomain, items, viaPrefix, viaDomain }
  const brandMap = new Map();
  for (const it of all) {
    const p = extractPrefix(it.title);
    const h = getHost(it.url);
    const reg = h ? getRegistrable(h) : '';
    const domainFirst = reg ? reg.split('.')[0] : '';

    if (p) {
      const key = p.toLocaleLowerCase();
      if (!brandMap.has(key)) brandMap.set(key, { prefixName: p, regDomain: reg, items: [], viaPrefix: 0, viaDomain: 0 });
      const e = brandMap.get(key);
      e.items.push(it); e.viaPrefix++;
      if (!e.regDomain && reg) e.regDomain = reg;
    } else if (domainFirst) {
      const key = domainFirst.toLowerCase();
      if (!brandMap.has(key)) brandMap.set(key, { prefixName: null, regDomain: reg, items: [], viaPrefix: 0, viaDomain: 0 });
      const e = brandMap.get(key);
      e.items.push(it); e.viaDomain++;
      if (!e.regDomain) e.regDomain = reg;
    }
  }

  const pickCanonical = (entry) => {
    // (0) Kullanıcı zorlu kural
    if (entry.regDomain && USER_PRIORITY_MAP[entry.regDomain]) return USER_PRIORITY_MAP[entry.regDomain];
    // (1) Prefix'li marka: kök klasör başlangıç eşleşmesi
    if (entry.prefixName) {
      const lb = entry.prefixName.toLocaleLowerCase();
      for (const rf of rootFolders) {
        if (rf.title.toLocaleLowerCase().startsWith(lb)) return rf.title;
      }
    }
    // (2) En sık kök kategori altında marka alt klasörü
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

  const fragmented = [];
  for (const [key, entry] of brandMap) {
    if (entry.items.length < MIN_GROUP) continue;
    const folders = new Set(entry.items.map(i => i.path));
    if (folders.size < MIN_FOLDERS) continue;
    const brand = entry.prefixName ? entry.prefixName : `*.${entry.regDomain}`;
    fragmented.push({ brand, items: entry.items, folders: [...folders], canonical: pickCanonical(entry), viaPrefix: entry.viaPrefix, viaDomain: entry.viaDomain });
  }

  log(`======== ANALİZ (DRY_RUN=${DRY_RUN}) ========`);
  log(`Parçalanmış marka sayısı: ${fragmented.length}`);
  fragmented.sort((a, b) => b.items.length - a.items.length);
  for (const f of fragmented) {
    log(`\n[${f.brand}]  (${f.items.length} öğe: ${f.viaPrefix} prefix + ${f.viaDomain} domain, ${f.folders.length} farklı klasörde)`);
    const byPath = {};
    for (const i of f.items) byPath[i.path] = (byPath[i.path] || 0) + 1;
    for (const [p, n] of Object.entries(byPath).sort((a, b) => b[1] - a[1])) {
      log(`    ${String(n).padStart(3)}  ${p || '(kök)'}`);
    }
    log(`    → kanonik: ${f.canonical}`);
  }

  if (DRY_RUN) {
    log('');
    log('DRY_RUN=true → değişiklik yok. Onayla: DRY_RUN=false');
    return { fragmented: fragmented.length };
  }

  // Path oluşturma (yoksa)
  const ensurePath = async (pathStr) => {
    const parts = pathStr.split('/');
    let currentId = bar.id;
    for (const p of parts) {
      const kids = await api.getChildren(currentId);
      let f = kids.find(k => !k.url && k.title === p);
      if (!f) { f = await api.create({ parentId: currentId, title: p }); log(`  [+] klasör: ${pathStr}`); }
      currentId = f.id;
    }
    return currentId;
  };

  let moved = 0, inplace = 0, errors = 0;
  for (const f of fragmented) {
    try {
      const targetId = await ensurePath(f.canonical);
      for (const item of f.items) {
        if (item.parentId === targetId) { inplace++; continue; }
        try { await api.move(item.id, { parentId: targetId }); moved++; }
        catch (e) { warn('move fail:', item.url, e); errors++; }
      }
    } catch (e) { warn('ensurePath fail:', f.canonical, e); errors += f.items.length; }
  }

  // Boş klasör temizliği (kök klasörleri koru)
  const currentRootKids = await api.getChildren(bar.id);
  const rootIds = new Set(currentRootKids.map(k => k.id));
  const cleanEmpty = async (folderId) => {
    const kids = await api.getChildren(folderId);
    for (const k of kids) if (!k.url) await cleanEmpty(k.id);
    const after = await api.getChildren(folderId);
    if (after.length === 0 && folderId !== bar.id && !rootIds.has(folderId)) {
      try { await api.removeTree(folderId); } catch {}
    }
  };
  await cleanEmpty(bar.id);

  log('');
  log('======== ÖZET ========');
  log(`Konsolide edilen marka: ${fragmented.length}`);
  log(`Taşınan URL: ${moved}`);
  log(`Yerinde kalan: ${inplace}`);
  log(`Hata: ${errors}`);
  log('TAMAMLANDI. 01-sort.js ile sıralamayı yenileyin.');
  return { fragmented: fragmented.length, moved, inplace, errors };
})();
