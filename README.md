# Özel Medya Kasası (Private Media Vault)

WhatsApp üzerinden gelen veya seçilen özel fotoğraf ve videoları telefonun normal **Galeri** uygulamasından gizleyerek kişi bazlı klasörlerde, PIN ve parmak izi koruması altında saklayan çevrimdışı Android uygulamasıdır.

## Özellikler
- **Kişi Bazlı Arşivler:** Her kişi için ayrı klasör, fotoğraf/video sayacı, türe ve tarihe göre filtreleme/sıralama.
- **Galeri Dışı Özel Depolama:** Dosyalar uygulamanın özel dahili dizininde (`documentDirectory/vault/`) `.nomedia` korumasıyla saklanır; normal Galeri’de görünmez.
- **WhatsApp Paylaşım Menüsü Entegrasyonu:** WhatsApp’tan tekli veya toplu fotoğraf/videoyu **Paylaş → Özel Medya Kasası** ile doğrudan içe aktarma.
- **SAF Klasör Tarama & Orijinali Silme:** Kullanıcı onayıyla WhatsApp medya klasörünü tarama, SHA-256 bütünlük/tekrar kontrolü ve aktarım sonrası orijinal dosyayı silme seçeneği.
- **Güvenlik:** 4–6 haneli PIN, parmak izi/biyometrik kilit, arka planda otomatik kilitleme, isteğe bağlı dosya şifreleme ve `android:allowBackup="false"`.

## Kurulum ve EAS ile APK Üretme
Bu proje **Expo + EAS Build** (`preview` profilinde `buildType: "apk"`) ile yerelde Android Studio gerektirmeden APK üretmek üzere yapılandırılmıştır:

```bash
cd PrivateMediaVault
npm install
npx eas login
npx eas build -p android --profile preview
```

> Not: Özel Android Config Plugin (`plugins/withWhatsAppShare.js`) içerdiği için uygulama **Expo Go** yerine **EAS Build APK** olarak derlenip telefona kurulmalıdır.

## İzinler ve Xiaomi 12 Pro (MIUI / HyperOS) Ayarları
1. **WhatsApp Klasör İzni (SAF):** Uygulama içinde *WhatsApp Klasörünü Tara* butonuna basın ve `Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Images` (veya `Video`) klasörünü seçip **Bu klasörü kullan** deyin.
2. **Pil Kısıtlaması (Xiaomi):** *Ayarlar → Uygulamalar → Uygulamaları Yönet → Özel Medya Kasası → Pil Tasarrufu* yolundan **Kısıtlama yok** seçeneğini işaretleyin.
3. **Veri Uyarısı:** Uygulamayı telefondan kaldırdığınızda kasadaki tüm yerel medya dosyaları ve şifreleme anahtarları kalıcı olarak silinir.

## Testler
```bash
npm run typecheck
npm test
```
