# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Proje Tipi

Chrome/Chromium tabanlı tarayıcıların yer imi ağacını düzenlemek için DevTools Console'dan çalıştırılan 7 bağımsız JavaScript betiğinden oluşan bir toolkit.

**Derleme, paket yöneticisi, linter, test çatısı veya dış bağımlılık yoktur.** `package.json` bulunmaz. Her betik tek dosya, tek sorun prensibine göre yazılmıştır.

## Çalıştırma

Betikler `chrome://bookmarks` sayfasında F12 → Console üzerinden çalıştırılır. İlk yapıştırmada Chrome `allow pasting` yazılmasını ister. Hiçbir betik CLI'dan çalıştırılamaz, Node.js ile test edilemez (`chrome.bookmarks` API sadece tarayıcıda erişilebilir).

Betiği panoya almak için:

```bash
# Linux
xclip -selection clipboard < 02-dedupe-folders-and-urls.js

# DRY_RUN kapatılmış haliyle panoya alma
sed 's/const DRY_RUN = true/const DRY_RUN = false/' 02-dedupe-folders-and-urls.js | xclip -selection clipboard
```

## Ortak Betik Mimarisi

Her betik (`NN-description.js`) aynı yapıyı paylaşır ve yeni betik eklerken bu desen korunmalıdır:

1. **IIFE async sarmalayıcı**: `(async () => { 'use strict'; ... })()` ile global kirlenme engellenir ve `await` kullanımı mümkün olur.
2. **Sabit bölüm sırası**: Her dosya aşağıdaki sırayla beş bölüm içerir (aynı başlık ifadeleriyle):
   - `// ======== USER SETTINGS ========` sık değiştirilen konfig (`DRY_RUN`, `BAR_TITLES`, eşikler, regex'ler, locale).
   - `// ======== CONSTANTS ========` nadiren değişen sabit tablolar (örn. `MERGE_LOG_HEAD`, `SAMPLE_HEAD`, `PROGRESS_EVERY`, `DEFAULT_PORTS`, `DUP_WARN_HEAD`). Kullanıcı tarafından değiştirilmesi beklenen değerler USER SETTINGS'te kalır.
   - `// ======== HELPERS ========` factory'ler ve saf yardımcı fonksiyonlar (`makeApi`, `makeLogger`, `findBar`, ihtiyaca göre `normalizeUrl`, `getHost`, `getRegistrable`, `extractPrefix`, `collectBookmarks`/`collectFolders`).
   - `// ======== MAIN ========` iş akışı, birden fazla SRP fonksiyonuna bölünmüş koordinatör.
   - `// ======== SUMMARY ========` sonda `======== ÖZET ========` başlığı, istatistikler, DRY_RUN durumunda onay mesajı (`DRY_RUN=false yap, yeniden yapıştır`).
3. **`DRY_RUN` sabiti** (00 ve 01 hariç zorunlu): `true` iken yalnız rapor üretir, `false` iken uygular. Varsayılan `true` olmalıdır.
4. **`makeApi` factory**: `chrome.bookmarks` callback API'sini Promise'a saran mini adaptör döner. Her dosya sadece kullandığı metotları içerir (`getTree`, `getChildren`, `move`, `remove`, `removeTree`, `create`, `update`, `get`). Yazma operasyonları (`move`/`create`/`remove`/`removeTree`) için `chrome.runtime.lastError` kontrolü sarmalayıcıda yapılır.
5. **`makeLogger` factory**: `[kisa-isim]` prefix'li `{ log, warn, error }` üçlüsünü döner. Mevcut prefix'ler: `[dump]`, `[sort]`, `[dedupe]`, `[flatten]`, `[hostgroup]`, `[rename]`, `[ephemeral]`, `[brand]`.
6. **`findBar` helper**: `tree[0].children` içinden `id === '1'` ya da `BAR_TITLES` eşleşmesiyle "Yer imleri çubuğu"nu bulur. `BAR_TITLES` tarayıcı dil ayarına göre varsayılan başlık varyasyonlarını içerir (EN/TR/FR/DE). Bulamazsa `null` döner, çağıran `console.error` + erken dönüş yapar.
7. **Kasıtlı DRY ihlali**: Helper'lar (`makeApi`, `makeLogger`, `findBar`, `normalizeUrl`, `getHost` vb.) her dosyada birebir çoğaltılır çünkü derleme adımı yoktur ve her betik tek dosya olarak Console'a yapıştırılır. Bir helper'a dokunmak gerektiğinde ilgili tüm dosyalarda aynı değişiklik tekrarlanmalıdır; bu, no-build felsefesi ile DRY arasındaki bilinçli bir dengedir.

## Kritik İnvariantlar

Bu invariantlar tüm betiklerde geçerlidir ve ihlal edilmemelidir:

- **Kök klasörler dokunulmazdır.** Yer imleri çubuğunun doğrudan çocuğu olan klasörler kullanıcının üst yapısıdır; silinmez, taşınmaz, düzleştirilmez. `07-flatten-small-folders.js` bunu `MIN_DEPTH = 2` ile, `06-consolidate-brand.js` `cleanEmpty` içindeki `rootIds` set'i ile korur.
- **Türkçe locale (`tr`) varsayılandır.** `localeCompare(..., LOCALE, { sensitivity: 'base', numeric: true })` ve `toLocaleLowerCase(LOCALE)` I/İ farkını doğru işler. Ç Ğ İ Ö Ş Ü harflerinin doğru sıralanması için locale parametresi atlanmamalıdır.
- **Özel URL şemaları atlanır.** `chrome://`, `javascript:`, `file://`, `about:` ile başlayan URL'ler hostname içermediği için normalize/rename işlemlerinde ya olduğu gibi bırakılır ya da işlem dışında tutulur.
- **Chrome sync etkisi vardır.** Tüm değişiklikler `chrome.bookmarks` API üzerinden yapıldığı için sync açıksa diğer cihazlara yayılır. Betikler bunu geri alamaz; HTML yedek tek güvenli geri dönüş yoludur.

## URL Normalize Mantığı (Tek Kaynak)

`02-dedupe-folders-and-urls.js` içindeki `normalizeUrl` fonksiyonu dedup ve URL karşılaştırması için referans implementasyondur. Yeni bir dedup-ilişkili betik yazılırken aynı kurallar uygulanmalıdır:

- Protokol HTTP/HTTPS değilse URL dokunulmaz döner
- Hostname küçük harfe çevrilir, `www.` prefix'i atılır
- Varsayılan portlar atılır (http:80, https:443)
- Trailing slash çıkarılır (kök `/` hariç)
- Tracking paramları silinir: `utm_*`, `fbclid`, `gclid`, `mc_cid`, `mc_eid`, `ref`, `ref_src`, `ref_url`, `igshid`, `yclid`, `dclid`, `msclkid`
- Kalan query paramları alfabetik sıralanır
- Anchor fragment'ı SPA route değilse (`/`, `?`, `=` içermiyorsa) atılır

## Domain ve Marka Mantığı

`06-consolidate-brand.js` içindeki `getRegistrable`, eTLD+1 hesabı yapar ve `COMMON_SLDS` set'i iki seviyeli TLD'leri (`com.tr`, `co.uk`, `com.au`, `co.jp` vs.) bilir. Yeni bir iki seviyeli TLD karşılaşırsa bu set'e eklenir.

Marka tespiti iki yoldan yapılır:
- **Başlık prefix'i**: `PREFIX_SEPARATORS` (` | `, ` - `, ` — `, ` – `) ile ayrılan başlıklardan ilk parça
- **Registrable domain**: eTLD+1'in ilk parçası (örn. `drive.google.com` → `google`)

Her ikisi de `brandMap`'te birleştirilir, `viaPrefix` ve `viaDomain` sayaçları korunur.

## Önerilen Betik Sırası

Betikler bağımsız çalışır ama anlamsal akış vardır. Yeni bir betik eklenirken bu sıralamadaki yeri düşünülmelidir:

1. `02-dedupe-folders-and-urls.js` — temel tekrar temizliği
2. `03-cleanup-ephemeral-urls.js` — geçici URL'leri siler (sonraki adımlar daha az URL üzerinde çalışır)
3. `04-rename-to-hostname.js` — başlıkları hostname'e normalize
4. `05-subfolder-by-hostname.js` — `04`'ün yarattığı aynı başlıklı URL'leri alt klasörlere böler
5. `06-consolidate-brand.js` — parçalanmış markaları toplar
6. `07-flatten-small-folders.js` — boş/tek/iki ögeli klasörleri düzleştirir
7. `08-sort.js` — son rötuş olarak alfabetik sıralama

`04` ve `05` semantik olarak bağlıdır: `04` çalıştırıldıktan sonra aynı hostname'li URL'ler çoğalır, `05` bunu ayrıştırmak için tasarlanmıştır.

## Yeni Betik Eklerken

- Dosya adı `NN-description.js` formatında, `NN` akıştaki mantıklı pozisyon
- Dosya başında JSDoc bloğu: "Ne yapar" ve "Nasıl kullanılır" Türkçe
- Bölüm sırası: USER SETTINGS → CONSTANTS (opsiyonel) → HELPERS → MAIN → SUMMARY
- `BAR_TITLES` bar-odaklı betiklerde mutlaka vardır (tüm ağaçta gezen 00 ve 05 kullanmaz)
- `DRY_RUN` varsayılanı `true` (değişiklik yapan betikler için)
- Helper factory'leri (`makeApi`, `makeLogger`, `findBar`) mevcut dosyalardan (örn. 02-dedupe veya 07-consolidate-brand) birebir kopyalanır; imza ve davranış tüm dosyalarda aynıdır
- Yazma operasyonlarının Promise sarmalayıcısında `chrome.runtime.lastError` kontrolü zorunludur
- MAIN bölümündeki uzun iş akışları SRP fonksiyonlarına bölünür (ör. `plan*`, `apply*`, `print*`, `collect*`, `build*`)
- README.md'deki **Scriptler** ve **Önerilen Kullanım Sırası** bölümleri güncellenmeli

## İletişim ve Dokümantasyon Dili

README.md ve kod yorumları Türkçedir, UTF-8 encoding'lidir. Türkçe özel karakterler (ğ, ü, ş, ı, ö, ç, İ, Ğ, Ü, Ş, Ö, Ç) ASCII karşılığına düşürülmez. Console çıktılarındaki kullanıcıya yönelik mesajlar da Türkçedir.

## Uyumluluk

Chromium tabanlı (Chrome, Edge, Brave, Opera, Vivaldi, Arc) tarayıcılarda çalışır. Firefox ve Safari farklı bookmarks API kullandığı için desteklenmez.
