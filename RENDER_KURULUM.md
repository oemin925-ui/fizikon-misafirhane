# Render Ile Kalici Yayin

Bu proje kalici veri saklama ile birlikte Render uzerinde yayinlanacak sekilde hazirlandi.

## Neden Render

- Node.js web servisi olarak calisir
- Sunucu tarafinda veri dosyasi tutar
- `render.yaml` ile kurulum hazirdir
- `data/` klasoru icin kalici disk kullanir

## Gerekli Bilgiler

- Render hesabi
- GitHub veya benzeri bir git deposu

## Kurulum Adimlari

1. Projeyi bir git reposuna gonderin.
2. Render panelinde `New +` > `Blueprint` secin.
3. Bu projedeki depoyu baglayin.
4. `render.yaml` dosyasini secin.
5. Kurulumu onaylayin.
6. Servis acildiginda Render size kalici bir `onrender.com` adresi verir.

## Veri Saklama

- Uygulama verileri `DATA_DIR/app-data.json` dosyasinda tutulur.
- Render tarafinda bu klasor kalici disk uzerine baglanir.
- Sunucu yeniden baslasa bile rezervasyonlar ve kullanicilar korunur.

## Yerel Kontrol

Sunucuyu yerelde calistirmak icin:

```bash
npm start
```

Veri dosyasi burada olusur:

```text
data/app-data.json
```
