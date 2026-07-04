import os
import io
import csv
import json
import tableauserverclient as TSC
import firebase_admin
from firebase_admin import credentials, firestore

def main():
    print("Starting Tableau to Firebase sync...")
    
    # 1. Firebase Auth
    firebase_cred_json = os.environ.get("FIREBASE_CREDENTIALS")
    if not firebase_cred_json:
        raise ValueError("Missing FIREBASE_CREDENTIALS env var.")
    
    print("Authenticating with Firebase...")
    cred_dict = json.loads(firebase_cred_json)
    cred = credentials.Certificate(cred_dict)
    firebase_admin.initialize_app(cred)
    db = firestore.client()
    
    # 2. Tableau Auth
    token_name = os.environ.get("TABLEAU_TOKEN_NAME", "Sunny-FNP_1")
    token_value = os.environ.get("TABLEAU_TOKEN_VALUE")
    if not token_value:
        raise ValueError("Missing TABLEAU_TOKEN_VALUE env var.")
        
    site_name = "httpswwwfnpcom"
    server_url = "https://eu-west-1a.online.tableau.com"
    
    print("Authenticating with Tableau...")
    tableau_auth = TSC.PersonalAccessTokenAuth(token_name, token_value, site_name)
    server = TSC.Server(server_url, use_server_version=True)
    
    with server.auth.sign_in(tableau_auth):
        print("Finding custom view 'AutoReport-Slot'...")
        target_view = None
        for cv in TSC.Pager(server.custom_views):
            if "AutoReport-Slot" in cv.name:
                target_view = cv
                break
                
        if not target_view:
            raise ValueError("Could not find custom view 'AutoReport-Slot'. Did you save it?")
            
        print("Downloading CSV data...")
        server.custom_views.populate_csv(target_view)
        csv_data = b"".join(target_view.csv).decode("utf-8-sig")
    
    # 3. Parse CSV and update Firestore
    print("Parsing data and pushing to Firestore...")
    reader = csv.DictReader(io.StringIO(csv_data))
    
    batch = db.batch()
    operations = 0
    total_processed = 0
    
    # Calculate the days of the month for today, tomorrow, and day after
    from datetime import datetime, timedelta
    import time
    now = datetime.now()
    valid_days = [now.day, (now + timedelta(days=1)).day, (now + timedelta(days=2)).day]
    
    for row in reader:
        sub_id = row.get("SUB_ORDER_ID", "").strip()
        if not sub_id or sub_id == "Null":
            continue
            
        # Only process orders for today, tomorrow, and day after tomorrow
        delivery_day_str = str(row.get("Day of DELIVERY DATE", "")).strip()
        if not delivery_day_str:
            continue
            
        try:
            delivery_day_int = int(delivery_day_str)
        except ValueError:
            continue
            
        if delivery_day_int not in valid_days:
            continue
            
        product_code = row.get("PRODUCT CODE", "").strip()
        doc_id = f"{sub_id}_{product_code}" if product_code else sub_id
        doc_ref = db.collection("suborders").document(doc_id)
        
        # Build document data dynamically based on available columns
        data = {
            "id": doc_id,
            "suborder_id": sub_id,
            "product_code": product_code,
            "product_name": row.get("PRODUCT NAME", ""),
            "category": row.get("Final Prod-Category", ""),
            "image_url": row.get("Image URL", ""),
            "qty": int(float(str(row.get("Metric", "1") or "1").replace(',', ''))),
            "special_instructions": row.get("ATTR_VALUE", "") if row.get("ATTR_VALUE", "") != "Null" else "",
            "last_updated": firestore.SERVER_TIMESTAMP
        }
        
        if "Day of DELIVERY DATE" in row:
            data["delivery_date"] = row["Day of DELIVERY DATE"]
            
        # Try a few common variations of the delivery slot column just in case
        for key in row.keys():
            if "DELIVERY SL" in str(key).upper():
                data["delivery_slot"] = row[key]
                break
        
        # We use merge=True so we don't overwrite is_prepared if someone already clicked it!
        batch.set(doc_ref, data, merge=True)
        operations += 1
        total_processed += 1
        
        # Firestore batch limit is 500
        if operations >= 450:
            batch.commit()
            time.sleep(2) # Prevent rate limits
            batch = db.batch()
            operations = 0
            print(f"Committed {total_processed} records...")
            
    if operations > 0:
        batch.commit()
        
    print(f"Successfully synced {total_processed} suborders to Firebase!")

if __name__ == "__main__":
    main()
