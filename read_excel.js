const xlsx = require('xlsx');
const path = require('path');

try {
  const filePath = path.join('..', 'Horário Escolar 2026.xlsx');
  const workbook = xlsx.readFile(filePath);
  
  console.log("=== SHEETS ===");
  console.log(workbook.SheetNames);
  
  workbook.SheetNames.forEach(sheetName => {
    console.log(`\n--- Sheet: ${sheetName} ---`);
    const sheet = workbook.Sheets[sheetName];
    // Convert to JSON, getting the first 10 rows
    const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });
    console.log(JSON.stringify(data.slice(0, 10), null, 2));
  });
} catch (error) {
  console.error("Error reading excel:", error);
}
