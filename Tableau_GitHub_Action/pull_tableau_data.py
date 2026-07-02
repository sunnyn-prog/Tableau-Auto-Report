import tableauserverclient as TSC
import datetime
import os
import sys
import csv
import gspread
import io
import json
import pytz
from google.oauth2.service_account import Credentials

def main():
    # ----- Configuration -----
    # Tableau Config
    TOKEN_NAME = 'Sunny-FNP_2'
    TOKEN_VALUE = os.environ.get('TABLEAU_TOKEN_SECRET')
    if not TOKEN_VALUE:
        print("Error: TABLEAU_TOKEN_SECRET environment variable not set.")
        sys.exit(1)
        
    SITE_NAME = 'httpswwwfnpcom'
    SERVER_URL = 'https://eu-west-1a.online.tableau.com'
    
    # Google Sheets Config
    SHEET_ID = '1yjNFGZMMFFy0800totWkq15_qSs2npYI1hUcNT1E0BY'
    
    # Setup timezone (Singapore Time)
    sg_tz = pytz.timezone('Asia/Singapore')
    now = datetime.datetime.now(sg_tz)
    
    print(f"Connecting to Tableau Cloud at {SERVER_URL}...")
    
    try:
        # Authenticate with Tableau
        tableau_auth = TSC.PersonalAccessTokenAuth(TOKEN_NAME, TOKEN_VALUE, SITE_NAME)
        server = TSC.Server(SERVER_URL, use_server_version=True)
        
        with server.auth.sign_in(tableau_auth):
            print("Successfully authenticated with Tableau.")
            
            target_view = None
            for cv in TSC.Pager(server.custom_views):
                if 'AutoReport' in cv.name:
                    target_view = cv
                    break
            
            if not target_view:
                print(f"Error: Custom View 'AutoReport' not found.")
                sys.exit(1)
            
            print("Downloading data from Tableau...")
            server.custom_views.populate_csv(target_view)
            csv_data_bytes = b''.join(target_view.csv)
            
            # Authenticate with Google Sheets
            scopes = ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive']
            gcp_creds_json = os.environ.get('GCP_CREDENTIALS_JSON')
            if not gcp_creds_json:
                print("Error: GCP_CREDENTIALS_JSON environment variable not set.")
                sys.exit(1)
                
            try:
                creds_info = json.loads(gcp_creds_json)
                creds = Credentials.from_service_account_info(creds_info, scopes=scopes)
            except json.JSONDecodeError as e:
                print(f"Error parsing GCP_CREDENTIALS_JSON: {e}")
                sys.exit(1)
                
            client = gspread.authorize(creds)
            sheet = client.open_by_key(SHEET_ID)
            
            # Parse CSV data
            csv_data_str = csv_data_bytes.decode('utf-8-sig', errors='replace')
            csv_reader = csv.reader(io.StringIO(csv_data_str))
            all_rows = list(csv_reader)
            
            if not all_rows:
                print("No data found in the Tableau extract to upload.")
                sys.exit(0)
                
            headers = all_rows[0]
            data = all_rows[1:]
            
            # Find column indices for new data
            try:
                day_col_idx = headers.index('Day of DELIVERY DATE')
                cat_col_idx = headers.index('Final Prod-Category')
                metric_col_idx = headers.index('Metric')
                img_url_idx = headers.index('Image URL')
                prod_code_idx = headers.index('PRODUCT CODE')
            except ValueError as e:
                print(f"Error finding columns in Tableau data: {e}")
                sys.exit(1)
                
            # Filter new data
            tomorrow = now + datetime.timedelta(days=1)
            target_day_str = str(tomorrow.day)
            
            def get_suffix(d):
                if 11 <= d <= 13: return 'th'
                return {1: 'st', 2: 'nd', 3: 'rd'}.get(d % 10, 'th')
            
            tab_name = f"{tomorrow.day}{get_suffix(tomorrow.day)} {tomorrow.strftime('%B')}"
            
            allowed_categories = {"flowers", "combos", "customized", "not found"}
            
            new_data_filtered = []
            for row in data:
                if len(row) > max(day_col_idx, cat_col_idx, metric_col_idx, img_url_idx, prod_code_idx):
                    is_tomorrow = row[day_col_idx] == target_day_str
                    cat_val = row[cat_col_idx].strip().lower()
                    if is_tomorrow and cat_val in allowed_categories:
                        new_data_filtered.append(row)
                        
            # Get existing sheet data
            tab_exists = False
            try:
                worksheet = sheet.worksheet(tab_name)
                existing_data_raw = worksheet.get_all_values(value_render_option='FORMULA')
                tab_exists = True
            except gspread.exceptions.WorksheetNotFound:
                worksheet = sheet.add_worksheet(title=tab_name, rows="100", cols="20")
                existing_data_raw = []
                
            current_time_str = now.strftime('%I:%M %p')
            inc_col_name = f"Increment ({current_time_str})"
            
            def safe_float(val):
                try:
                    return float(str(val).replace(',', ''))
                except (ValueError, TypeError):
                    return 0.0
                    
            merged_rows = []
            output_headers = []
            
            if tab_exists and existing_data_raw and len(existing_data_raw) > 0:
                # Merge scenario
                output_headers = list(existing_data_raw[0])
                if 'Metric' in output_headers:
                    output_headers[output_headers.index('Metric')] = 'Total Qty'
                if 'Total Qty' not in output_headers:
                    print("Error: Total Qty or Metric not found in existing headers.")
                    sys.exit(1)
                    
                output_headers.append(inc_col_name)
                
                total_qty_idx = output_headers.index('Total Qty')
                ex_prod_code_idx = output_headers.index('PRODUCT CODE')
                
                # Parse existing rows into dicts
                existing_dict = {}
                for r in existing_data_raw[1:]:
                    if len(r) > ex_prod_code_idx:
                        pcode = r[ex_prod_code_idx]
                        existing_dict[pcode] = {output_headers[i]: (r[i] if i < len(r) else "") for i in range(len(output_headers)-1)}
                        
                # Match new data
                processed_pcodes = set()
                for r in new_data_filtered:
                    pcode = r[prod_code_idx]
                    new_total = safe_float(r[metric_col_idx])
                    
                    if pcode in existing_dict:
                        old_row = existing_dict[pcode]
                        old_total = safe_float(old_row.get('Total Qty', 0))
                        increment = new_total - old_total
                        
                        out_row = list(old_row.values()) + [str(increment)]
                        out_row[total_qty_idx] = str(new_total)
                        
                        # Fix Image formula
                        if 'Image' in output_headers:
                            img_out_idx = output_headers.index('Image')
                            out_row[img_out_idx] = f'=IMAGE("{r[img_url_idx]}")' if r[img_url_idx] else ''
                            
                        merged_rows.append(out_row)
                    else:
                        # Completely new product
                        new_row_dict = {}
                        for h in output_headers:
                            new_row_dict[h] = ""
                        # Map base columns
                        for idx, h in enumerate(headers):
                            if h in new_row_dict:
                                new_row_dict[h] = r[idx]
                        
                        new_row_dict['Total Qty'] = str(new_total)
                        new_row_dict[inc_col_name] = str(new_total)
                        new_row_dict['Image'] = f'=IMAGE("{r[img_url_idx]}")'
                        
                        out_row = [new_row_dict[h] for h in output_headers]
                        merged_rows.append(out_row)
                        
                    processed_pcodes.add(pcode)
                    
                # Handle disappeared products
                for pcode, old_row in existing_dict.items():
                    if pcode not in processed_pcodes:
                        old_total = safe_float(old_row.get('Total Qty', 0))
                        increment = -old_total
                        out_row = list(old_row.values()) + [str(increment)]
                        out_row[total_qty_idx] = "0"
                        merged_rows.append(out_row)
                        
            else:
                # First run scenario
                output_headers = list(headers)
                output_headers.insert(img_url_idx + 1, 'Image')
                # rename metric to Total Qty
                metric_out_idx = output_headers.index('Metric')
                output_headers[metric_out_idx] = 'Total Qty'
                output_headers.append(inc_col_name)
                
                for r in new_data_filtered:
                    out_row = list(r)
                    url = out_row[img_url_idx]
                    out_row.insert(img_url_idx + 1, f'=IMAGE("{url}")' if url else '')
                    
                    # increment is total
                    total_val = out_row[metric_out_idx]
                    out_row.append(total_val)
                    merged_rows.append(out_row)
                    
            # Sort merged_rows by Total Qty desc
            total_qty_out_idx = output_headers.index('Total Qty')
            merged_rows.sort(key=lambda r: safe_float(r[total_qty_out_idx]), reverse=True)
            
            upload_data = [output_headers] + merged_rows
            
            print(f"Updating Google Sheet tab '{tab_name}' with {len(upload_data)} rows and {len(output_headers)} columns...")
            worksheet.clear()
            worksheet.update(upload_data, value_input_option='USER_ENTERED')
            
            # Formatting
            print("Formatting columns and rows...")
            requests = []
            
            out_img_url_idx = output_headers.index('Image URL')
            out_img_idx = output_headers.index('Image')
            
            requests.append({
                "updateDimensionProperties": {
                    "range": {"sheetId": worksheet.id, "dimension": "COLUMNS", "startIndex": out_img_url_idx, "endIndex": out_img_url_idx + 1},
                    "properties": {"hiddenByUser": True},
                    "fields": "hiddenByUser"
                }
            })
            requests.append({
                "updateDimensionProperties": {
                    "range": {"sheetId": worksheet.id, "dimension": "COLUMNS", "startIndex": out_img_idx, "endIndex": out_img_idx + 1},
                    "properties": {"pixelSize": 150},
                    "fields": "pixelSize"
                }
            })
            requests.append({
                "updateDimensionProperties": {
                    "range": {"sheetId": worksheet.id, "dimension": "ROWS", "startIndex": 1, "endIndex": len(upload_data)},
                    "properties": {"pixelSize": 150},
                    "fields": "pixelSize"
                }
            })
            
            sheet.batch_update({"requests": requests})
            
            # Freeze 1st row and up to Image column
            print("Freezing headers and columns...")
            worksheet.freeze(rows=1, cols=out_img_idx + 1)
            
            print("Google Sheet successfully updated and formatted!")
                
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"An error occurred: {e}")
        sys.exit(1)

if __name__ == '__main__':
    main()
