# Fizikon Misafirhane Rezervasyon Sistemi

Bu ilk paket, verdiginiz talepleri yazilim gereksinimine cevirmek ve baslangic surumunu netlestirmek icin hazirlandi.

## Temel istekler

- Uc misafirhane ayni panelden yonetilecek: 2, 5 ve 8 Nolu Daire.
- Kullanicilar kullanici adi ve sifre ile giris yapacak.
- Rezervasyon olustururken su alanlar zorunlu olacak:
  - Ad soyad
  - Gelis tarihi
  - Cikis tarihi
  - Gelis saati
  - Cikis saati
- Sistem su islemler icin log tutacak:
  - Giris yapan kullanici hangi rezervasyonu verdi
  - Giris yapan kullanici hangi rezervasyonu duzenledi
  - Giris yapan kullanici hangi rezervasyonu sildi
- Log kaydi panelde zorunlu olarak gorunmek zorunda degil; tek tikla Excel'e dokulebilecek.
- Admin olarak belirlenen kullanicilar uygulama ici bildirim alacak:
  - Rezervasyon olusturuldu
  - Yaklasan rezervasyon var
  - Bugun giris yapacak misafir var
- Sistem yalnizca web uzerinden takip edilecek.
- Word dosyalarindaki aylik tablo yapisi bozulmadan aynen aktarilacak.

## Onerilen veri yapisi

### Kullanici

- id
- ad soyad
- kullanici adi
- sifre hash
- rol
- bildirim alir mi
- aktif mi

### Daire

- id
- ad
- durum

### Rezervasyon

- id
- daire id
- misafir ad soyad
- gelis tarihi
- cikis tarihi
- gelis saati
- cikis saati
- durum
- not

### Log

- id
- rezervasyon id
- islem tipi
- yapan kullanici
- islem zamani
- onceki veri
- yeni veri

### Bildirim

- id
- hedef kullanici
- baslik
- mesaj
- okundu mu
- olusturma zamani

## Ekranlar

- Giris ekrani
- Ana panel
- Daire bazli aylik takvim
- Rezervasyon ekle / duzenle / sil
- Log disa aktarma
- Bildirim merkezi

## Bu klasorde hazirlanan dosyalar

- `fizikon-misafirhane-takip.xlsx`: Word tablolarindan uretilen ilk Excel dosyasi
- `index.html`: panelin ilk web prototipi
- `app.js`: rezervasyon, bildirim ve log akislarini gosteren demo davranis
- `styles.css`: mobil ve web uyumlu arayuz tasarimi

## Sonraki asama

- Bu prototipi gercek kullanici girisi olan bir web servisle baglamak
- Mobil taraf icin ayni API'yi kullanan uygulama cikarmak
- Excel disa aktarimini canli veritabanindan otomatik uretmek
- Word tablosu bicimlerini renk, satir yuksekligi ve birlesik hucre seviyesinde daha da yaklastirmak
