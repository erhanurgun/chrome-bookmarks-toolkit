# Chrome Bookmarks Cleanup Toolkit

Chrome ve diğer Chromium tabanlı tarayıcıların (Edge, Brave, Opera, Vivaldi, Arc) yer imi ağacını DevTools Console üzerinden organize etmek için yazılmış bağımsız scriptler kümesi. Hiçbir kurulum, eklenti, servis hesabı, harici araç gerektirmez. `chrome://bookmarks` sayfasını açar, F12 ile Console'u açar, scripti yapıştırır, Enter'a basarsınız.

Her script tek bir sorunu çözer: sıralama, tekrar temizleme, klasör düzleştirme, hostname bazlı alt gruplama, başlık yeniden adlandırma, geçici URL temizleme, marka konsolidasyonu. Ayrıca analiz ve yedek için ağacı JSON olarak indiren bir yardımcı script de mevcuttur. Değişiklik yapan scriptlerin hepsi `DRY_RUN` ile önizlemeye izin verir, istediğinizde uygular.

## İçindekiler

- [Ne İşe Yarar](#ne-ise-yarar)
- [Hızlı Başlangıç](#hizli-baslangic)
- [Scriptler](#scriptler)
- [Önerilen Kullanım Sırası](#onerilen-kullanim-sirasi)
- [Örnek Senaryolar](#ornek-senaryolar)
- [Özelleştirme](#ozellestirme)
- [Güvenlik](#guvenlik)
- [Uyumluluk](#uyumluluk)
- [Sıkça Sorulan Sorular](#sikca-sorulan-sorular)
- [Bilinen Kısıtlar](#bilinen-kisitlar)
- [Katkı](#katki)
- [Lisans](#lisans)

## Ne İşe Yarar

Uzun süre kullanılan bir tarayıcının yer imleri genelde organik büyür, tekrarlı olur, eski kalır. Zamanla karşılaşılan tipik sorunlar şunlardır.

- Aynı URL farklı klasörlerde bulunmaktadır, bazen birkaç varyantı (www'lu, www'suz, takip parametreli) bile vardır.
- Onlarca klasör tek bir ögeden ibaret olur veya boş kalır, bu kategori yapısını bulanıklaştırır.
- Arama ile kolayca erişilebilen içerikler (YouTube videoları, e-ticaret ürün sayfaları, LinkedIn postları, arama sonuç sayfaları) yer imleri arasında birikir.
- Aynı markanın (örneğin Google'ın) farklı servisleri birçok farklı klasöre dağılmıştır.
- Başlıklar sayfa başlığı olarak kaydedilmiştir ve zamanla anlamsız veya uzun kalmıştır; hostname daha okunaklı olabilir.

Bu toolkit her bir soruna yönelik küçük bir scripti ayrı dosya olarak sunar. Hepsi şu ortak yaklaşımı benimser.

- Tek dosya, bağımsız. Başka script içermez, network istegi yapmaz.
- Chrome Bookmarks API üzerinden doğrudan çalışır. Dolayısıyla Chrome sync açıksa değişiklikler bulutta diğer cihazlara yayılır.
- `DRY_RUN = true` varsayılanıyla başlar. Önce plan ve rapor gösterir, gerçek değişiklik yapmaz. Onaylayınca `false` yapıp yeniden çalıştırırsınız.
- Türkçe locale farkındadır (`tr` varsayılan). Karakter bozulması olmadan sıralama ve karşılaştırma yapar.

## Hızlı Başlangıç

Aşağıdaki adımları her script için tekrarlarsınız.

### 1. Yedek Alın

Büyük bir operasyondan önce `chrome://bookmarks` sayfasına girin, sağ üstteki üç nokta menüsünden **Dışa Aktar** seçeneğini seçin, HTML dosyasını kaydedin. Beklenmedik bir sonuçta bu dosyayı aynı menüden **İçe Aktar** ile geri yükleyebilirsiniz. Bu, toolkit'in sağladığı en güçlü geri alma yöntemidir.

### 2. Scripti Panoya Alın

Linux için:

```bash
xclip -selection clipboard < 01-sort.js
```

macOS için:

```bash
pbcopy < 01-sort.js
```

Windows (PowerShell) için:

```powershell
Get-Content 01-sort.js | Set-Clipboard
```

Alternatif olarak dosyayı editörde açıp `Ctrl+A` `Ctrl+C` yapabilirsiniz.

### 3. Console'a Yapıştırın

`chrome://bookmarks` sekmesine geçin. `F12` ile DevTools'u açın, üstteki **Console** sekmesine tıklayın. İlk yapıştırmada Chrome genellikle bir uyarı gösterir: "Paste is blocked because it might be a scam". Tek seferlik `allow pasting` yazıp Enter'a basın, sonra kodu yapıştırıp Enter.

### 4. Raporu Okuyun

Script `DRY_RUN` modda başlar. Konsol çıktısında ne yapmayı planladığını gösterir. Örneğin `02-dedupe-folders-and-urls.js` kaç duplicate klasör birleştireceğini ve kaç URL sileceğini, `06-cleanup-ephemeral-urls.js` hangi kategorilerde kaç eşleşme bulduğunu listeler.

### 5. Uygulayın

Rapor memnun edicilse scriptin başındaki `const DRY_RUN = true;` satırını `const DRY_RUN = false;` olarak değiştirip yeniden yapıştırın. Aynı Console oturumunda üst ok tuşuyla önceki komutu getirip düzenleyebilirsiniz. Alternatif olarak panoya sed ile değiştirerek alın:

```bash
sed 's/const DRY_RUN = true/const DRY_RUN = false/' 01-sort.js | xclip -selection clipboard
```

## Scriptler

### 00-dump-tree-as-json.js: Ağacı JSON Olarak İndirme

Tüm yer imi ağacını JSON dosyası olarak indirir. Hiçbir değişiklik yapmaz, sadece okur. Chrome'un kendi HTML export özelliğine alternatif değildir (HTML geri yüklenebilir, JSON değil) ama ham yapıyı programatik işlemeye uygun şekilde dışa aktarır.

Tipik kullanım alanları şunlardır.

- Harici script (Python, Node, jq) ile kategori analizi yapmak: klasör sayımı, domain dağılımı, duplicate tespiti, özel sorgular
- Büyük değişikliklerden önce hızlı ham yedek almak (HTML export ile birlikte kullanın)
- İki farklı zamanın ağacını `diff` ile karşılaştırmak, değişiklikleri görmek
- Debug amaçlı: bookmark ID'leri, eklenme tarihleri, guid'leri incelemek

Yapılandırma:

- `FILENAME`: indirilecek dosya adı (varsayılan `chrome-bookmarks-tree.json`)
- `PRETTY_PRINT`: dosyanın okunabilir olması için indentli format (varsayılan açık, kapatırsanız boyut küçülür)

### 01-sort.js: Alfabetik Sıralama

Her klasörde alt klasörler önce, URL'ler sonra olacak şekilde alfabetik sıralar. "Other" veya "Diğer" (veya listedeki başka eşdeğer isimlerle başlayan) klasörler ve URL'ler kendi grubunun sonuna alınır.

Sıralama Türkçe locale duyarlıdır, bu nedenle Ç Ğ İ Ö Ş Ü harfleri doğru sırada yer alır. Sayı içeren başlıklar numeric aware karşılaştırılır (örneğin `"Araç 2"` `"Araç 10"`'dan önce gelir).

Yapılandırma:

- `LAST_NAMES`: sona alınacak klasör adı kalıpları (büyük/küçük harf duyarsız)
- `LOCALE`: varsayılan `tr`
- `BAR_TITLES`: tarayıcı dilinize göre yer imleri çubuğunun başlığı

### 02-dedupe-folders-and-urls.js: Tekrar Temizleme

İki farklı tekrarı ele alır.

1. Aynı parent altında aynı isimde birden fazla klasör varsa (örneğin yanlışlıkla oluşmuş üç `github.com` alt klasörü) birleştirir. İlk klasör korunur, diğerlerinin içeriği oraya taşınır, sonra boş kalan klasörler silinir.
2. Aynı klasör içinde aynı URL'ye sahip yer imleri varsa ilki tutulur, diğerleri silinir. URL karşılaştırması normalize edilmiş haliyle yapılır.

Normalize kuralları:

- Scheme ve hostname küçük harfe çevrilir
- `www.` prefix'i atılır
- Varsayılan portlar (80, 443) atılır
- Trailing slash çıkarılır (`/` kök hariç)
- Tracking parametreleri temizlenir: `utm_*`, `fbclid`, `gclid`, `mc_cid`, `mc_eid`, `ref`, `ref_src`, `igshid`, `yclid`, `dclid`, `msclkid`
- Kalan query paramları alfabetik sıralanır
- Boş anchor fragment'ları (`#section` gibi, `/` içermeyen) atılır, SPA route fragment'ları korunur

İşlem rekursiftir, ağacın her seviyesinde uygulanır.

### 03-flatten-small-folders.js: Küçük Klasörleri Düzleştirme

Kök seviyedeki (yer imleri çubuğunun doğrudan altındaki) ana kategorilere dokunmaz, bunlar sizin üst yapınızdır. Alt seviyelerdeki boş, tek ögeli ve isteğe bağlı olarak iki ögeli klasörleri düzleştirir. Düzleştirme: klasörün içeriği parent'a taşınır, klasör silinir.

Yapılandırma:

- `DELETE_EMPTY`: boş klasörleri sil (varsayılan açık)
- `FLATTEN_SINGLE_ITEM`: tek ögeli klasörleri düzleştir (varsayılan açık)
- `FLATTEN_TWO_ITEM`: iki ögeli klasörleri de düzleştir (varsayılan kapalı, agresif)
- `MIN_DEPTH`: hangi derinlikten itibaren düzleştirme uygulansın (varsayılan 2, yani kök seviyeye dokunmaz)

Uygulama sırası iki ögeli, tek ögeli, boş şeklindedir, çünkü iki ögeli klasör düzleştirmesi parent'ta yeni tek ögeli klasör yaratabilir.

### 04-subfolder-by-hostname.js: Hostname Bazlı Alt Gruplama

Aynı klasör içinde aynı hostname'e sahip en az iki URL varsa (örneğin altı farklı Gmail hesabına link, üç farklı `feeds.feedburner.com` RSS), bu hostname adıyla bir alt klasör oluşturur, URL'leri oraya taşır. Her URL'nin başlığını `hostname + path` biçimine getirerek karışıklığı önler.

Kullanım senaryosu: `05-rename-to-hostname.js` çalıştırıldıktan sonra birçok URL aynı başlığa (hostname'e) sahip olur. Bu script o durumu ayrıştırmak için özel olarak tasarlanmıştır.

Yapılandırma:

- `MIN_DUP`: alt klasör açmak için minimum kaç aynı hostname (varsayılan 2)

### 05-rename-to-hostname.js: Başlıkları Hostname'e Çevirme

Tüm yer imi başlıklarını URL'deki hostname'e dönüştürür. `www.` atılır, path ve query eklenmez. Klasör yapınız zaten kategorize ediyorsa uzun orijinal sayfa başlıkları yerine temiz hostname daha okunaklı olur.

YouTube istisnası: path içeren YouTube URL'leri (video, kanal, shorts, playlist) silinir. Sadece ana sayfa `youtube.com` olarak kalır. Bu opsiyonel: `CLEANUP_YOUTUBE_PATHS = false` ile kapatılır. Mantık: YouTube içeriği aramayla kolayca yeniden bulunabilir, saklamaya genelde gerek yoktur.

Bu işlem sonrası aynı hostname'e sahip birden fazla URL olabilir. Bunu gidermek için `04-subfolder-by-hostname.js` veya `02-dedupe-folders-and-urls.js` çalıştırın.

### 06-cleanup-ephemeral-urls.js: Geçici URL Temizleme

"Aramayla yeniden bulunabilir" karakterdeki URL'leri siler. Kategoriler regex pattern'leri olarak tanımlıdır, istemediğiniz kategoriyi yorum satırı yaparak devre dışı bırakırsınız.

Tanınan kategoriler:

- Sosyal medya dinamik içerik: LinkedIn post/feed/pulse/jobs, Facebook post/watch/photo, Instagram post/reel/tv, TikTok video, Pinterest pin
- E-ticaret ürün sayfaları: Amazon dp/gp, Trendyol `-p-<id>`, Hepsiburada, Ebay itm, Aliexpress item, N11
- Arama sonuç sayfaları: Google, Bing, DuckDuckGo, Yandex, YouTube watch/shorts
- Forum thread: Reddit r/x/comments
- Spesifik makale: Medium article, Dev.to article, Hashnode post

Korunanlar:

- LinkedIn profilleri (`linkedin.com/in/<user>`)
- Şirket sayfaları (`linkedin.com/company/<company>`)
- Amazon ana sayfaları
- Instagram profilleri (post değil)
- DuckDuckGo bangs sayfası
- Ana sayfa URL'leri (path'siz veya kök path)

### 07-consolidate-brand.js: Marka Konsolidasyonu

Aynı markaya ait ama farklı klasörlere dağılmış yer imlerini tek kanonik klasöre toplar. Marka iki farklı yolla tespit edilir.

1. Başlık prefix'i: "Google | X", "Microsoft - Y", "Apple — Z" gibi ayraçlı başlıklar
2. Aynı registrable domain (eTLD+1): `drive.google.com`, `mail.google.com`, `keep.google.com` hepsi `google.com` altındadır

Kanonik konum seçim mantığı:

- Önce `USER_PRIORITY_MAP` kontrol edilir, kullanıcı manuel atama yapmışsa ona uyulur
- Sonra marka adıyla başlayan bir kök klasör aranır (örneğin "Google" prefix'i için "Google Services" kök klasörü varsa oraya toplanır)
- Yoksa ilgili markanın URL'lerinin en çok bulunduğu ana kategori altında marka adıyla bir alt klasör oluşturulur

Eşikler:

- `MIN_GROUP`: minimum URL sayısı (varsayılan 3)
- `MIN_FOLDERS`: minimum farklı klasör sayısı (varsayılan 2). Tek klasörde olan markalar zaten toplu olduğu için dokunulmaz.

Konsolidasyon sonrası boş kalan klasörler temizlenir (kök klasörler korunur).

## Önerilen Kullanım Sırası

Dağınık bir ağacı sıfırdan organize ediyorsanız aşağıdaki sıra tipik olarak en temiz sonucu verir. Her adım öncesinde DRY_RUN ile önizlemenizi öneririm.

1. `02-dedupe-folders-and-urls.js`: en temelde aynı URL ve klasör tekrarlarını ortadan kaldırır
2. `06-cleanup-ephemeral-urls.js`: geçici içeriği temizler, sonraki adımlar daha az URL üzerinde çalışır
3. `05-rename-to-hostname.js`: başlıkları normalize eder, aynı kaynakları ayırt etmek kolaylaşır
4. `04-subfolder-by-hostname.js`: aynı hostname'li duplikatları alt klasöre gruplar
5. `07-consolidate-brand.js`: dağılmış markaları toplar
6. `03-flatten-small-folders.js`: boş ve minik klasörleri düzleştirir
7. `01-sort.js`: son rötuş olarak alfabetik sıralama

Belli bir sorunla karşılaştıysanız sadece ilgili scripti çalıştırabilirsiniz, sıralı akış zorunlu değildir.

## Örnek Senaryolar

### Senaryo 1: Çok sayıda duplicate URL

Belirti: Aynı bağlantı iki üç klasörde birden, bazıları `www` bazıları değil.

Uygulanacak: `02-dedupe-folders-and-urls.js`

Sonuç: Normalize edilmiş dedup, duplicate URL'lerin sadece ilk örneği kalır.

### Senaryo 2: YouTube videolarıyla dolu bir "İleride İzlenecekler" klasörü

Belirti: Yüzlerce `youtube.com/watch?v=...` URL'si, zamanla kaybolan video listesi.

Uygulanacak: `06-cleanup-ephemeral-urls.js` (önce DRY_RUN ile listeyi gözden geçirin), veya `05-rename-to-hostname.js` içindeki `CLEANUP_YOUTUBE_PATHS` ile path'li YouTube'ları silip sadece `youtube.com` ana sayfasını tutun.

### Senaryo 3: Google servisleri yedi sekiz klasöra dağılmış

Belirti: `Gmail` "İş" klasöründe, `Drive` "Dokümantasyon"da, `Google Calendar` "Takvim" altında, hepsi aynı Google hesabına ait.

Uygulanacak: `07-consolidate-brand.js`. Script `google.com` eTLD+1'ini tespit eder, en sık bulunduğu ana kategori altında `*.google.com` (veya manuel olarak `USER_PRIORITY_MAP['google.com'] = 'Google Services'` tanımlayarak belirlediğiniz klasör) altında toplar.

### Senaryo 4: Onlarca boş ve tek ögeli klasör

Belirti: Yıllar içinde oluşturulan "Kitap Öneri", "Sonra Okunacak", "Linux Araçları" gibi klasörler, içinde bir veya sıfır ögeyle karışıklık yaratıyor.

Uygulanacak: `03-flatten-small-folders.js`. Varsayılan ayarlarla boş ve tek ögeli klasörler düzleştirilir, içerik parent'a taşınır.

## Özelleştirme

Her script yapılandırma bloğu ile başlar (`USER SETTINGS` etiketli). En sık dokunulacak alanlar şunlardır.

`BAR_TITLES`: Chrome yer imleri çubuğunun başlığı dil ayarınıza göre değişir. Varsayılan liste İngilizce, Türkçe, Fransızca, Almanca varyantlarını içerir. Başka bir dil kullanıyorsanız buraya ekleyin.

`LOCALE`: Sıralama ve karşılaştırma locale kodu. `01-sort.js` için varsayılan `tr`. Farklı dillere `en`, `de`, `es` gibi kodlar kullanın.

`LAST_NAMES` (sadece 01-sort.js): Sıralamada sona alınacak klasör adı kalıpları. Varsayılanda `other`, `diğer`, `misc`, `sonstiges` vardır. Kendi dilinize göre ekleme yapabilirsiniz.

`PATTERNS` (sadece 06-cleanup-ephemeral-urls.js): Silinecek URL kategorileri regex listesi. Silmek istemediğiniz kategoriyi yorum satırı yaparsanız o pattern devre dışı kalır.

`USER_PRIORITY_MAP` (sadece 07-consolidate-brand.js): Belirli domain'leri belirli klasöre zorunlu yönlendirmek için kullanılır. Örnek:

```js
const USER_PRIORITY_MAP = {
  'google.com': 'Google Services',
  'microsoft.com': 'Microsoft',
  'apple.com': 'Apple',
};
```

## Güvenlik

Bu toolkit Chrome Bookmarks API üzerinden doğrudan değişiklik yapar. Sync açıksa değişiklikler buluta yüklenir ve diğer cihazlarınızda da uygulanır. Aşağıdaki önlemleri alın.

**Önce DRY_RUN.** Her scripti ilk kez çalıştırırken `DRY_RUN = true` ile çalıştırın. Rapor çıktısını gözden geçirin, ne yapacağını anlayın, sonra uygulayın.

**HTML yedek alın.** Chrome'un kendi "Yer İmlerini Dışa Aktar" özelliği tüm yapıyı tek bir HTML dosyası olarak kaydeder. Büyük operasyonlardan önce alın. Sorun olursa "İçe Aktar" ile geri yüklenir.

**Sync etkisini düşünün.** Yalnızca bir cihazda test etmek istiyorsanız `chrome://settings/syncSetup` üzerinden yer imleri sync'ini geçici olarak kapatın, değişiklikleri yapın, ardından sonuçtan memnunsanız sync'i tekrar açın.

**Paste prompt.** Chrome son sürümlerde Console'a uzun kod yapıştırırken uyarı verir ve `allow pasting` yazmanızı ister. Bu tek seferlik bir güvenlik mekanizmasıdır.

**Geri alınamaz işlemler.** Silme ve klasör birleştirme işlemleri DevTools üzerinden geri alınamaz. HTML yedek bu nedenle kritiktir.

## Uyumluluk

Chromium tabanlı tarayıcılarda çalışır. Firefox farklı bir bookmarks API kullanır ve bu toolkit oradan çalışmaz.

| Tarayıcı | Destek |
|---|---|
| Google Chrome | Tam destek |
| Microsoft Edge | Tam destek |
| Brave | Tam destek |
| Opera | Tam destek |
| Vivaldi | Tam destek |
| Arc | Tam destek |
| Firefox | Desteklenmez |
| Safari | Desteklenmez |

## Sıkça Sorulan Sorular

<details>
<summary>Yanlışlıkla yanlış DRY_RUN değerini yapıştırdım ve istemediğim işlem yapıldı. Ne yapabilirim?</summary>

Önceden HTML yedek aldıysanız `chrome://bookmarks` üzerinden o yedeği içe aktarabilirsiniz. Yedek yoksa ve sync açıksa diğer cihazlarınızın henüz sync olmamış hali kurtarma için şans olabilir, ancak bu genellikle güvenilmez. Bu nedenle her zaman HTML yedek önerilir.

</details>

<details>
<summary>Script hiçbir şey yazmıyor, sessiz kalıyor. Ne oldu?</summary>

Console filtresinin "Info" seviyesi kapalı olabilir. Console üstündeki Default levels dropdown'ını açıp Info'nun işaretli olduğundan emin olun. Bir diğer sebep: `chrome://bookmarks` değil başka bir sekmede çalıştırıyor olabilirsiniz, Chrome Bookmarks API sadece o sayfada erişilebilir.

</details>

<details>
<summary>"copy is not defined" hatası alıyorum.</summary>

`copy()` DevTools'un built-in fonksiyonudur ama sadece top-level Console REPL'de tanımlıdır, async callback içinde değil. Bu toolkit'teki scriptler `copy()` kullanmaz. Kendi eklemelerinizde kullanıyorsanız değişkeni önce `window.__data = ...` ile kaydedip ayrı bir komutla `copy(JSON.stringify(window.__data))` çağırın.

</details>

<details>
<summary>2000+ yer imim var, script ne kadar sürer?</summary>

API çağrıları sıralı async olduğu için büyük ağaçlar birkaç dakika sürebilir. Her script Console'da ilerleme bilgisi yazar. `02-dedupe-folders-and-urls.js` ve `07-consolidate-brand.js` en yoğun çalışan scriptlerdir.

</details>

<details>
<summary>Scripti çalıştırdım ama sıralama hala bozuk görünüyor.</summary>

Chrome yer imleri yöneticisi arayüzü bazen güncellenmiş sırayı yenilemeden gösterir. Sayfayı yenileyin (`F5`) veya yer imleri yöneticisi sekmesini kapatıp yeniden açın.

</details>

<details>
<summary>Gmail hesaplarımdan sadece birini tutmak istiyorum, 04-subfolder-by-hostname nasıl yardımcı olur?</summary>

Bu script silme yapmaz, sadece tekrarlı URL'leri alt klasöre gruplar. Silme için `02-dedupe-folders-and-urls.js` URL'leri normalize ederek dedup eder, ancak farklı Gmail hesapları farklı path'lere sahip olduğu için (örneğin `/mail/u/0`, `/mail/u/1`) dedup edilmezler. Her biri geçerli ayrı bir yer imidir.

</details>

<details>
<summary>Kurumsal Chrome politikası altındayım, script çalışır mı?</summary>

Chrome Enterprise bazı organizasyonlarda DevTools'u veya yer imi düzenlemeyi kısıtlayabilir. Bu toolkit Chrome Bookmarks API üzerinden çalıştığı için organizasyon tarafında API engeli varsa script çalışmaz. Önce kendi kullanıcı profilinizde test edin.

</details>

## Bilinen Kısıtlar

**Başlıksız yer imleri.** Yalnız favicon olarak görünen başlıksız yer imlerini bazı scriptler (özellikle sıralama ve duplicate title tespiti) doğru karşılaştıramaz. Önce başlık verin, sonra çalıştırın.

**Özel URL şemaları.** `chrome://`, `javascript:`, `file://`, `about:` ile başlayan yer imleri `05-rename-to-hostname.js` tarafından atlanır çünkü hostname kavramı yoktur.

**Çok uzun URL'ler.** 2000 karakterden uzun URL'ler bazı scriptlerce atlanabilir (muhtemelen data URL veya kaybolmuş token'dır).

**Shortener URL'leri.** `bit.ly`, `tinyurl` gibi shortener'ların hedef URL'sini takip etmez. Bu URL'ler oldukları gibi kalır, dedup normalize onları farklı sayar.

**API rate limit.** Çok büyük ağaçlarda (10000+ yer imi) Chrome bazı API çağrılarını throttle edebilir. Scriptler batch uygulamaz, tüm işlemi tek seferde yapar. Sorun yaşarsanız işlemi bölerek yapın.

## Katkı

Pull request'ler hoş karşılanır. Aşağıdaki konularda özellikle katkı beklenir.

- Yeni `06-cleanup-ephemeral-urls.js` pattern'leri (yeni sosyal medya siteleri, yeni e-ticaret pazar yerleri)
- Farklı dil locale'ları için `BAR_TITLES` eklemeleri
- Yeni senaryolar için scriptler (örneğin "aynı domain'den sayfa sayısı gereksiz ölçüde fazla olan klasörleri tespit")
- Dokümantasyon iyileştirmeleri

Yeni betik yazarken standart bölüm sırası korunmalıdır: `USER SETTINGS → CONSTANTS → HELPERS → MAIN → SUMMARY`. Ortak helper'lar (`makeApi`, `makeLogger`, `findBar`) mevcut dosyalardan birebir kopyalanır; derleme adımı olmadığı için DRY kasıtlı olarak her dosyada çoğaltılır. Detay için `CLAUDE.md` dosyasındaki **Ortak Betik Mimarisi** bölümüne bakın.

Issue açarken mümkünse tarayıcı sürümünüzü, yer imi sayınızı ve Console çıktısını paylaşın.

## Lisans

MIT. Detay için `LICENSE` dosyasına bakın.
