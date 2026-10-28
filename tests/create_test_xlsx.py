from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

out = Path("tests/fixtures")
out.mkdir(parents=True, exist_ok=True)
with ZipFile(out / "sample.xlsx", "w", ZIP_DEFLATED) as z:
    z.writestr("xl/workbook.xml", '''<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>''')
    z.writestr("xl/_rels/workbook.xml.rels", '''<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>''')
    z.writestr("xl/worksheets/sheet1.xml", '''<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
<row r="1"><c r="A1" t="inlineStr"><is><t>BV</t></is></c><c r="B1" t="inlineStr"><is><t>PFAS</t></is></c></row>
<row r="2"><c r="A2"><v>0</v></c><c r="B2"><v>10</v></c></row>
<row r="3"><c r="A3"><v>100</v></c><c r="B3"><v>5</v></c></row>
</sheetData></worksheet>''')
with ZipFile(out / "bomb.xlsx", "w", ZIP_DEFLATED) as z:
    z.writestr("xl/workbook.xml", "X" * (81 * 1024 * 1024))
print("Test XLSX files prepared")
