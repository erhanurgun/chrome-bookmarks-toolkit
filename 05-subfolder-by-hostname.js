/**
 * 04 - Subfolder by Hostname
 *
 * Ne yapar: Aynı klasör içinde aynı hostname'e sahip birden fazla URL varsa
 *   (örn. 3 tane mail.google.com), o hostname adıyla bir alt klasör oluşturur
 *   ve URL'leri oraya taşır. Her URL'nin başlığını "hostname + path" olarak
 *   günceller (örn. "mail.google.com" → "mail.google.com/mail/u/1").
 *
 * Kullanım amacı: Başlıkların sadece hostname olduğu durumda (örneğin
 *   05-rename-to-hostname.js sonrası) birbirinin aynısı görünen yer imlerini
 *   ayırt edilebilir hale getirir.
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
  const MIN_DUP = 2;            // kaç aynı hostname için alt klasör oluşturulsun
  const BAR_TITLES = ['Bookmarks bar', 'Yer işareti çubuğu', 'Barre de favoris', 'Lesezeichenleiste'];
  // ================================

  // ======== CONSTANTS ========
  // Plan raporunda gösterilecek ilk N grup (en büyük gruptan başlayarak).
  const PLAN_REPORT_HEAD = 30;
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
    update: (id, changes) => new Promise((resolve) => chrome.bookmarks.update(id, changes, resolve)),
  });

  const findBar = async (api, barTitles) => {
    const tree = await api.getTree();
    return tree[0].children.find((c) => c.id === '1' || barTitles.includes(c.title)) || null;
  };

  // www. prefix'i atılmış, küçük harf hostname. Hatalı URL boş döner.
  const getHost = (url) => {
    try {
      let h = new URL(url).hostname.toLowerCase();
      if (h.startsWith('www.')) h = h.slice(4);
      return h;
    } catch { return ''; }
  };

  // Başlık olarak "hostname" veya "hostname + path" (trailing slash atılarak).
  // Aynı hostname'den farklı path'leri ayırt edebilmek için kullanılır.
  const buildPathTitle = (url) => {
    try {
      const u = new URL(url);
      let h = u.hostname.toLowerCase();
      if (h.startsWith('www.')) h = h.slice(4);
      let p = u.pathname || '';
      if (p.endsWith('/') && p.length > 1) p = p.slice(0, -1);
      if (!p || p === '/') return h;
      return h + p;
    } catch { return null; }
  };

  // Her klasörü dolaşıp aynı hostname'e sahip >= minDup URL'li grupları bulur.
  // Aynı isimde mevcut alt klasör varsa onu hedef olarak işaretler (yeniden yaratma).
  const planHostnameGroups = async (barId, api, minDup) => {
    const plans = [];
    const walk = async (folderId, folderPath) => {
      const kids = await api.getChildren(folderId);
      const urls = kids.filter((k) => k.url);
      const subfolders = kids.filter((k) => !k.url);

      const byHost = new Map();
      for (const u of urls) {
        const h = getHost(u.url);
        if (!h) continue;
        if (!byHost.has(h)) byHost.set(h, []);
        byHost.get(h).push(u);
      }

      for (const [hostname, items] of byHost) {
        if (items.length < minDup) continue;
        const existingSub = subfolders.find((sf) => sf.title === hostname);
        plans.push({
          folderId, folderPath, hostname, items,
          existingSubId: existingSub ? existingSub.id : null,
        });
      }

      for (const sf of subfolders) {
        const childPath = folderPath ? folderPath + '/' + sf.title : sf.title;
        await walk(sf.id, childPath);
      }
    };
    await walk(barId, '');
    return plans;
  };

  const printPlans = (plans, reportHead, dryRun, log) => {
    log(`======== ANALİZ (DRY_RUN=${dryRun}) ========`);
    log(`Duplicate hostname grubu: ${plans.length}`);
    for (const p of plans.slice(0, reportHead)) {
      const exists = p.existingSubId ? ', mevcut alt klasör' : '';
      log(`  ${p.folderPath || '(kök)'} / ${p.hostname}  (${p.items.length}x${exists})`);
    }
    if (plans.length > reportHead) log(`  ... ve ${plans.length - reportHead} daha`);
  };

  // Her grup için hedef klasörü hazırlar (varsa kullanır, yoksa oluşturur),
  // URL'leri taşır ve başlıklarını "hostname+path" ile günceller.
  const applyHostnameGroups = async (plans, api, warn) => {
    let createdFolders = 0, moved = 0, renamed = 0, errors = 0;
    for (const p of plans) {
      let targetId = p.existingSubId;
      try {
        if (!targetId) {
          const f = await api.create({ parentId: p.folderId, title: p.hostname });
          targetId = f.id;
          createdFolders++;
        }
      } catch (e) { warn('create fail:', p.hostname, e); errors++; continue; }

      for (const item of p.items) {
        try {
          if (item.parentId !== targetId) {
            await api.move(item.id, { parentId: targetId });
            moved++;
          }
          const nt = buildPathTitle(item.url);
          if (nt && nt !== item.title) {
            await api.update(item.id, { title: nt });
            renamed++;
          }
        } catch (e) { warn('move/update fail:', item.url, e); errors++; }
      }
    }
    return { createdFolders, moved, renamed, errors };
  };

  // ======== MAIN ========
  const { log, warn } = makeLogger('hostgroup');
  const api = makeApi();

  const bar = await findBar(api, BAR_TITLES);
  if (!bar) { console.error('[hostgroup] Yer imleri çubuğu bulunamadı'); return; }

  const plans = await planHostnameGroups(bar.id, api, MIN_DUP);
  plans.sort((a, b) => b.items.length - a.items.length);
  printPlans(plans, PLAN_REPORT_HEAD, DRY_RUN, log);

  if (DRY_RUN) {
    log('');
    log('DRY_RUN=true → değişiklik yok. Onayla: DRY_RUN=false');
    return { groups: plans.length };
  }

  const { createdFolders, moved, renamed, errors } = await applyHostnameGroups(plans, api, warn);

  // ======== SUMMARY ========
  log('');
  log('======== ÖZET ========');
  log(`Oluşturulan alt klasör: ${createdFolders}`);
  log(`Taşınan URL: ${moved}`);
  log(`Yeniden adlandırılan: ${renamed}`);
  log(`Hata: ${errors}`);
  log('TAMAMLANDI. 01-sort.js ile sıralamayı yenileyin.');
  return { createdFolders, moved, renamed, errors };
})();
