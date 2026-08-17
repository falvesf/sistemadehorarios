import pandas as pd
import sys

try:
    file_path = 'Horário Escolar 2026.xlsx'
    xl = pd.ExcelFile(file_path)
    print("Sheets:", xl.sheet_names)
    for sheet_name in xl.sheet_names:
        print(f"\n--- Sheet: {sheet_name} ---")
        df = pd.read_excel(file_path, sheet_name=sheet_name, nrows=5)
        print(df.head())
except Exception as e:
    print(f"Error: {e}")
    sys.exit(1)
