import json
from pathlib import Path

from docx import Document


BASE = Path(r"C:\Users\ASUS\Documents\Codex\2026-04-22-files-mentioned-by-the-user-2")
MONTHS = [
    "Nisan 2026",
    "Mayis 2026",
    "Haziran 2026",
    "Temmuz 2026",
    "Agustos 2026",
    "Eylul 2026",
    "Ekim 2026",
    "Kasim 2026",
    "Aralik 2026",
]

APARTMENT_FILES = {
    "2 Nolu Daire": "2 Nolu Daire 2026.docx",
    "5 Nolu Daire": "5 Nolu Daire 2026 - .docx",
    "8 Nolu Daire": "8 Nolu Daire 2026.docx",
}


def normalize(text: str) -> str:
    return " ".join(text.replace("\t", " ").replace("\n", " ").split())


result = {"apartments": []}

for apartment_name, filename in APARTMENT_FILES.items():
    path = BASE / filename
    document = Document(str(path))
    apartment = {
        "name": apartment_name,
        "sourceFile": filename,
        "months": [],
    }

    for index, table in enumerate(document.tables):
        rows = []
        for row in table.rows:
            rows.append([normalize(cell.text) for cell in row.cells])
        apartment["months"].append(
            {
                "monthLabel": MONTHS[index],
                "tableIndex": index + 1,
                "rows": rows,
            }
        )

    result["apartments"].append(apartment)

output = BASE / "reservation_seed.json"
output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
print(output)
