# Fizikon Misafirhane Paneli

Bu proje artik statik sayfa degil, kalici veri tutan bir web uygulamasidir.

## Su Anda Hazir Olanlar

- Kullanici girisi
- Admin kullanici yonetimi
- Rezervasyon ekleme, duzenleme ve silme
- Ayni tarihe dolu daire icin cakisma engelleme
- Excel disa aktarma
- Sunucu tarafinda kalici veri saklama

## Kalici Veri

Veriler tarayicida degil, sunucudaki dosyada tutulur:

```text
data/app-data.json
```

Bu dosyada sunlar saklanir:

- kullanicilar
- rezervasyonlar
- log kayitlari
- bildirimler
- mail ayarlari ve gonderilen hatirlatma kayitlari

## Yerelde Calistirma

```bash
npm start
```

Uygulama su adreste acilir:

```text
http://127.0.0.1:4184/
```

Saglik kontrolu:

```text
http://127.0.0.1:4184/api/health
```

## Varsayilan Giris

- Kullanici adi: `admin`
- Sifre: `admin`

## Mail Bildirimi

`bilgiislem@fizikon.com` adresi icin alan adinin MX kaydi `Yandex` gorundugu icin varsayilan SMTP ayari `smtp.yandex.com` olarak hazirlandi.

Eksik kalan tek alan genelde:

- `MAIL_SMTP_PASSWORD`

Bu alana Yandex app password yazildiginda test maili ve yaklasan rezervasyon maili calisir.

Bu uygulamadaki SMTP istemcisi icin varsayilan cikis portu `587` olarak ayarlandi.

Admin panelinde:

- `Mail Alicilarini Kaydet`
- `Deneme Mail Gonder`

butonlari hazirdir.

## Kalici Web Yayin

Bu proje Render uzerinde kalici disk ile yayinlanacak sekilde hazirlandi.

- Ayar dosyasi: `render.yaml`
- Kurulum notu: `RENDER_KURULUM.md`

Render uzerinde yayinlandiginda:

- Node.js sunucusu calisir
- `data/` klasoru kalici diskten beslenir
- rezervasyonlar ve kullanicilar sunucu yeniden baslasa bile silinmez

## Not

Eski statik Netlify yapisi kaldirildi. Bu surum sadece veri tutan web uygulamasi olarak devam eder.
