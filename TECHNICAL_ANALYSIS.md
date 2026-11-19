# Teknik Analiz Raporu: WhatsApp Otomatik Medya Aktarımı Sınırları

Bu rapor, **Private Media Vault (Özel Medya Kasası)** projesinin geliştirme öncesi Android ve WhatsApp güvenlik mimarisi üzerinde yapılan teknik değerlendirmesini içerir.

## 1. Belirli Bir Gönderen ile Gelen Medya Dosyasını Eşleştirmek Mümkün mü?
**Hayır (Standart Android API’leriyle %100 güvenilir şekilde mümkün değildir).**
- WhatsApp, gelen fotoğraf ve videoları `IMG-YYYYMMDD-WAXXXX.jpg` / `VID-YYYYMMDD-WAXXXX.mp4` formatında kaydeder; dosya adında gönderen kimliği veya telefon numarası yer almaz.
- WhatsApp, gizlilik nedeniyle görsellerin EXIF metaverisini temizler.
- WhatsApp’ın kendi sohbet veritabanı (`msgstore.db`) uygulamanın özel `/data/data/com.whatsapp/` dizininde şifreli/izole tutulur; root veya güvenlik aşımı olmadan üçüncü parti uygulamalar bu veriye erişemez.

## 2. Özel Veritabanına Erişmeden Hangi Bölümler Gerçekleştirilebilir?
- **Tam Çalışanlar:** Uygulama içi özel kasa depolaması (`documentDirectory` + `.nomedia`), PIN/biyometrik kilit, SHA-256 tekrar/bütünlük kontrolü, Android Paylaşım Menüsü (`ACTION_SEND` / `ACTION_SEND_MULTIPLE`) ile doğrudan aktarım, Storage Access Framework (SAF) ile kullanıcı onaylı klasör tarama ve isteğe bağlı orijinal dosya silme.
- **Kısmi/Güvenilir Olmayanlar:** `NotificationListenerService` ile bildirimden gönderen adını okuyup aynı saniyelerde klasöre düşen dosyayı tahmin etmek teorik olarak denenebilir; ancak sessize alınmış sohbetler, gruplanmış bildirimler, aynı anda birden fazla kişiden medya gelmesi veya WhatsApp Web’in açık olması durumunda eşleştirme bozulur. Bu nedenle uygulama tahmin yürütmek yerine kesin kullanıcı seçimine dayanır.

## 3. İzin Mekanizmalarının Sınırları
- **Paylaşım Menüsü (`ACTION_SEND`):** En güvenilir yöntemdir. Ancak gelen `content://` URI’si salt okunurdur; uygulama bu URI üzerinden WhatsApp’ın kendi dosyasını doğrudan silemez.
- **Klasör İzleme / SAF (`ACTION_OPEN_DOCUMENT_TREE`):** Android 11+ (Scoped Storage) ile WhatsApp medyaları `Android/media/com.whatsapp/WhatsApp/Media/` altında tutulur. Kullanıcı SAF üzerinden açıkça klasör izni verdiğinde uygulama bu klasörü okuyabilir ve kullanıcı onayıyla orijinali silebilir.

## 4. WhatsApp "Medya Görünürlüğü" Kapalıyken Durum
- WhatsApp’ta bir sohbet için *Medya görünürlüğü: Hayır* seçildiğinde dosyalar `WhatsApp Images/Private/` (veya `WhatsApp Video/Private/`) alt klasörüne `.nomedia` ile kaydedilir.
- Bu dosyalar Android `MediaStore` / Galeri taramasına kapalıdır; uygulama da genel galeri API’leriyle bunları göremez. Yalnızca kullanıcı SAF ile doğrudan ilgili `Private` klasörüne izin verirse erişilebilir.

## 5. Xiaomi 12 Pro (MIUI / HyperOS) Pil ve Arka Plan Kısıtlamaları
- Xiaomi cihazlarda agresif pil optimizasyonu ve arka plan süreç kapatma mekanizması varsayılan olarak aktiftir.
- Sürekli arka plan dinleyicileri veya periyodik `WorkManager` görevleri; kullanıcı **Pil Tasarrufu → Kısıtlama Yok** ve **Otomatik Başlatma** izinlerini manuel vermedikçe işletim sistemi tarafından durdurulur.

## 6. En Az İşlem Yaptıran Uygulanabilir Akış
1. **Doğrudan Paylaşım:** WhatsApp sohbetinde 1 veya çoklu medya seç → **Paylaş → Özel Medya Kasası** → Son seçilen kişi hazır gelir → Tek dokunuşla kasaya aktar.
2. **SAF Klasör Tarama:** Uygulama içinden **WhatsApp Klasörünü Tara** ile yeni medyaları listele, kişiye aktar ve istenirse orijinalleri sil.
