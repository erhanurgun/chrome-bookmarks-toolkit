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

  const api = {
    getTree: () => new Promise(r => chrome.bookmarks.getTree(r)),
    getChildren: (id) => new Promise(r => chrome.bookmarks.getChildren(id, r)),
    create: (det) => new Promise((ok, fail) => chrome.bookmarks.create(det, (n) => {
      if (chrome.runtime.lastError) fail(chrome.runtime.lastError); else ok(n);
    })),
    move: (id, dest) => new Promise((ok, fail) => chrome.bookmarks.move(id, dest, (n) => {
      if (chrome.runtime.lastError) fail(chrome.runtime.lastError); else ok(n);
    })),
    update: (id, ch) => new Promise(r => chrome.bookmarks.update(id, ch, r)),
  };
  const log = (...a) => console.log('[hostgroup]', ...a);
  const warn = (...a) => console.warn('[hostgroup]', ...a);

  // Hostname: www. prefix'i temizlenmiş, küçük harf.
  const getHost = (url) => {
    try {
      let h = new URL(url).hostname.toLowerCase();
      if (h.startsWith('www.')) h = h.slice(4);
      return h;
    } catch { return ''; }
  };

  // Path'li başlık: URL farklı path'lere sahipse onlarla ayırt edilir.
  const pathTitle = (url) => {
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

  const tree = await api.getTree();
  const bar = tree[0].children.find(c => c.id === '1' || BAR_TITLES.includes(c.title));
  if (!bar) { console.error('[hostgroup] Yer imleri çubuğu bulunamadı'); return; }

  const plans = [];

  const walk = async (folderId, folderPath) => {
    const kids = await api.getChildren(folderId);
    const urls = kids.filter(k => k.url);
    const subfolders = kids.filter(k => !k.url);

    // Hostname bazlı grupla
    const byHost = new Map();
    for (const u of urls) {
      const h = getHost(u.url);
      if (!h) continue;
      if (!byHost.has(h)) byHost.set(h, []);
      byHost.get(h).push(u);
    }

    for (const [hostname, items] of byHost) {
      if (items.length < MIN_DUP) continue;
      const existingSub = subfolders.find(sf => sf.title === hostname);
      plans.push({
        folderId, folderPath, hostname, items,
        existingSubId: existingSub ? existingSub.id : null,
      });
    }

    for (const sf of subfolders) {
      await walk(sf.id, folderPath ? folderPath + '/' + sf.title : sf.title);
    }
  };
  await walk(bar.id, '');

  log(`======== ANALİZ (DRY_RUN=${DRY_RUN}) ========`);
  log(`Duplicate hostname grubu: ${plans.length}`);
  plans.sort((a, b) => b.items.length - a.items.length);
  for (const p of plans.slice(0, 30)) {
    log(`  ${p.folderPath || '(kök)'} / ${p.hostname}  (${p.items.length}x${p.existingSubId ? ', mevcut alt klasör' : ''})`);
  }
  if (plans.length > 30) log(`  ... ve ${plans.length - 30} daha`);

  if (DRY_RUN) {
    log('');
    log('DRY_RUN=true → değişiklik yok. Onayla: DRY_RUN=false');
    return { groups: plans.length };
  }

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
        const nt = pathTitle(item.url);
        if (nt && nt !== item.title) {
          await api.update(item.id, { title: nt });
          renamed++;
        }
      } catch (e) { warn('move/update fail:', item.url, e); errors++; }
    }
  }

  log('');
  log('======== ÖZET ========');
  log(`Oluşturulan alt klasör: ${createdFolders}`);
  log(`Taşınan URL: ${moved}`);
  log(`Yeniden adlandırılan: ${renamed}`);
  log(`Hata: ${errors}`);
  log('TAMAMLANDI. 01-sort.js ile sıralamayı yenileyin.');
  return { createdFolders, moved, renamed, errors };
})();
