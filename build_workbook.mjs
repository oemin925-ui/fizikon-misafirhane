import fs from "node:fs/promises";
import path from "node:path";
import { Workbook, SpreadsheetFile } from "@oai/artifact-tool";

const baseDir = "C:\\Users\\ASUS\\Documents\\Codex\\2026-04-22-files-mentioned-by-the-user-2";
const outputDir = path.join(baseDir, "outputs");
const data = JSON.parse(await fs.readFile(path.join(baseDir, "reservation_seed.json"), "utf8"));

const workbook = Workbook.create();

const dashboard = workbook.worksheets.add("Genel Bakis");
dashboard.getRange("A1:F7").values = [
  ["Fizikon Tip Merkezi Misafirhane Takibi", null, null, null, null, null],
  ["Kapsam", "3 daire / Nisan-Aralik 2026", null, null, null, null],
  ["Temel Alanlar", "Ad Soyad, Gelis Tarihi, Cikis Tarihi, Gelis Saati, Cikis Saati", null, null, null, null],
  ["Yetki", "Kullanici girisi ve admin bildirimi", null, null, null, null],
  ["Log", "Giris yapan kullanici ile olusturma / duzenleme / silme kaydi", null, null, null, null],
  ["Excel", "Tek tikla aylik tablo disa aktarma", null, null, null, null],
  ["Not", "Asagidaki sayfalarda Word tablolari birebir aktarilmistir.", null, null, null, null],
];

for (const apartment of data.apartments) {
  const sheet = workbook.worksheets.add(apartment.name);
  let rowCursor = 1;

  for (const month of apartment.months) {
    const rowCount = month.rows.length;
    const colCount = month.rows[0]?.length ?? 7;
    const lastCol = String.fromCharCode(64 + colCount);
    sheet.getRange(`A${rowCursor}:${lastCol}${rowCursor}`).values = [[month.monthLabel, null, null, null, null, null, null]];
    rowCursor += 1;
    sheet.getRange(`A${rowCursor}:${lastCol}${rowCursor + rowCount - 1}`).values = month.rows;
    rowCursor += rowCount + 2;
  }
}

const users = workbook.worksheets.add("Kullanicilar");
users.getRange("A1:E5").values = [
  ["Kullanici Adi", "Rol", "Gorebilecegi Daire", "Bildirim Alir", "Durum"],
  ["admin.fizikon", "Admin", "Tum Daireler", "Evet", "Aktif"],
  ["resepsiyon.1", "Personel", "2 Nolu Daire", "Hayir", "Aktif"],
  ["resepsiyon.5", "Personel", "5 Nolu Daire", "Hayir", "Aktif"],
  ["resepsiyon.8", "Personel", "8 Nolu Daire", "Hayir", "Aktif"],
];

const reservations = workbook.worksheets.add("Rezervasyonlar");
reservations.getRange("A1:H5").values = [
  ["Daire", "Ad Soyad", "Gelis Tarihi", "Cikis Tarihi", "Gelis Saati", "Cikis Saati", "Durum", "Aciklama"],
  ["2 Nolu Daire", "Emin", "2026-04-22", "2026-04-25", "14:30", "11:00", "Planlandi", "Ornek kayit"],
  ["5 Nolu Daire", "Veronika Shostakevich", "2026-07-01", "2026-07-10", "11:00", "10:00", "Aktif", "Word aktarimi sonrasi duzenlenebilir"],
  ["8 Nolu Daire", "Alparslan Cekic", "2026-05-05", "2026-05-09", "09:00", "12:00", "Aktif", "Word aktarimi sonrasi duzenlenebilir"],
  ["2 Nolu Daire", "Demid Novikov", "2026-04-06", "2026-04-11", "10:00", "11:00", "Aktif", "Word aktarimindan uretilen referans"],
];

const logs = workbook.worksheets.add("Log Kayitlari");
logs.getRange("A1:G5").values = [
  ["Tarih Saat", "Islem", "Daire", "Kayit", "Yapan Kullanici", "Aciklama", "IP / Cihaz"],
  ["2026-04-22 08:45", "Olusturuldu", "2 Nolu Daire", "Emin", "admin.fizikon", "Yeni rezervasyon acildi", "Web Panel"],
  ["2026-04-22 08:50", "Duzenlendi", "2 Nolu Daire", "Emin", "admin.fizikon", "Gelis saati guncellendi", "Web Panel"],
  ["2026-04-22 09:00", "Bildirildi", "2 Nolu Daire", "Emin", "system", "Admin kullanicilara bildirim gonderildi", "Otomasyon"],
  ["2026-04-22 09:05", "Yaklasan Randevu", "2 Nolu Daire", "Emin", "system", "Bugun giris yapacak misafir uyarisi", "Otomasyon"],
];

await fs.mkdir(outputDir, { recursive: true });
const output = await SpreadsheetFile.exportXlsx(workbook);
const outputPath = path.join(outputDir, "fizikon-misafirhane-takip.xlsx");
await output.save(outputPath);
console.log(outputPath);
