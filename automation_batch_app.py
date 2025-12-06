import os
import pandas as pd
import tkinter as tk
from tkinter import ttk, filedialog, messagebox
import fitz  # PyMuPDF
import json
import logging 
import time 
from concurrent.futures import ThreadPoolExecutor, as_completed 
import threading 
from google import genai
from google.genai import types 
import sys 

# 🟢 NEW: Import transliteration library
from indic_transliteration import sanscript

# Parsing logic आयात करा (Fixed import for filename with space)
import importlib.util
spec = importlib.util.spec_from_file_location("gemini_parse", os.path.join(os.path.dirname(__file__), "gemini_parse (1).py"))
gemini_parse = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gemini_parse)
parse_full_page_voters = gemini_parse.parse_full_page_voters
process_header_footer_gemini = gemini_parse.process_header_footer_gemini

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


class AutomationBatchApp:

    def __init__(self, root):
        self.root = root
        self.root.title("Voter OCR – Batch Automation Mode")
        self.root.geometry("1100x750")

        self.pdf_files = [] 
        
        # 🟢 Global State and Settings
        self.total_tokens_used = 0
        self.total_estimated_cost_inr = 0.0
        self.INR_PER_M_TOKENS_FLASH_INPUT = 1.00  
        self.INR_PER_M_TOKENS_FLASH_OUTPUT = 3.00 
        self.USD_TO_INR_RATE = 83.0             
        self.DAILY_TOKEN_QUOTA = 1_000_000 
        
        self.gemini_client = None 
        
        # 🟢 Thread Control
        self.max_workers = 3 
        self.PAID_STANDARD_WORKERS = 12 
        self.CUSTOM_WORKERS = 30 
        
        # 🟢 PAUSE/RESUME STATE
        self.is_paused = False 
        self.current_file_index = 0 
        
        self.root_folder = "" 
        self.api_tier_var = tk.StringVar(value='Free') 

        main = ttk.Frame(root)
        main.pack(fill="both", expand=True, padx=10, pady=10)
        main.columnconfigure(0, weight=1)
        main.rowconfigure(2, weight=1) 

        # 🔴 FIX: Status Bar created early to prevent AttributeError
        self.status = ttk.Label(root, text="Ready")
        self.status.pack(fill="x")

        # =======================================================
        # TOP CONTROL PANEL (UI Layout Unchanged)
        # =======================================================
        control_frame = ttk.Frame(main)
        control_frame.grid(row=0, column=0, sticky="ew", pady=5)
        control_frame.columnconfigure(1, weight=1)

        # 1. API Key Input 
        api_frame = ttk.LabelFrame(control_frame, text="Gemini API Key")
        api_frame.grid(row=0, column=0, sticky="ew", padx=5)
        ttk.Label(api_frame, text="Key:").pack(side="left", padx=2)
        self.api_key_entry = ttk.Entry(api_frame, width=25, show="*") 
        self.api_key_entry.pack(side="left", padx=2)
        ttk.Button(api_frame, text="Set Key", command=self.set_api_key).pack(side="left", padx=2)
        self.api_status = ttk.Label(api_frame, text="Not Set", foreground="red")
        self.api_status.pack(side="right", padx=5)
        
        # 🟢 NEW: API Tier Selection (Row 1, Column 0)
        tier_frame = ttk.LabelFrame(control_frame, text="API Tier & Speed")
        tier_frame.grid(row=1, column=0, sticky="ew", padx=5, pady=(5, 0)) 
        
        # Radio Buttons
        tier_sub_frame = ttk.Frame(tier_frame)
        tier_sub_frame.pack(fill="x", pady=2)
        ttk.Radiobutton(tier_sub_frame, text="Paid (Standard)", variable=self.api_tier_var, 
                        value='Paid', command=self.update_api_tier).pack(side="left", padx=5)
        ttk.Radiobutton(tier_sub_frame, text="Free (Safe)", variable=self.api_tier_var, 
                        value='Free', command=self.update_api_tier).pack(side="left", padx=5)
        
        # 🟢 NEW: Custom Worker Control (Spinbox)
        custom_frame = ttk.Frame(tier_frame)
        custom_frame.pack(fill="x", pady=2)
        ttk.Label(custom_frame, text="Custom Workers:").pack(side="left", padx=5)
        
        self.worker_spinbox = ttk.Spinbox(custom_frame, from_=4, to=30, increment=1, 
                                          wrap=True, width=5, 
                                          command=self.set_custom_workers, 
                                          state='disabled', 
                                          textvariable=tk.StringVar(value=str(self.PAID_STANDARD_WORKERS)))
        self.worker_spinbox.pack(side="left", padx=5)
        
        self.update_api_tier() 

        # 2. Load/Run Buttons (Row 0, Column 1)
        action_frame = ttk.Frame(control_frame)
        action_frame.grid(row=0, column=1, rowspan=2, sticky="nsew", padx=5) 
        
        ttk.Button(action_frame, text="1. Select PDF Folder", command=self.select_folder_for_batch).pack(side="top", fill="x", expand=True, padx=5, pady=2)
        
        # 🟢 NEW: Start and Resume Buttons
        self.batch_button = ttk.Button(action_frame, text="2. 🚀 Start Batch OCR", command=lambda: threading.Thread(target=self._run_batch_automation).start())
        self.batch_button.pack(side="top", fill="x", expand=True, padx=5, pady=2)
        
        self.resume_button = ttk.Button(action_frame, text="▶️ Resume Batch", command=lambda: threading.Thread(target=self._run_batch_automation).start(), state=tk.DISABLED)
        self.resume_button.pack(side="top", fill="x", expand=True, padx=5, pady=2)
        
        control_frame.columnconfigure(1, weight=1)
        
        # =======================================================
        # PROGRESS & COST SUMMARY (Unchanged)
        # =======================================================
        summary_frame = ttk.Frame(main)
        summary_frame.grid(row=1, column=0, sticky="ew", pady=5)
        summary_frame.columnconfigure(0, weight=1)
        
        self.progress_label = ttk.Label(summary_frame, text="Ready: 0 Files Loaded")
        self.progress_label.grid(row=0, column=0, sticky="w")
        
        self.elapsed_time_label = ttk.Label(summary_frame, text="Elapsed: 00:00:00", font=("Arial", 9, "bold"))
        self.elapsed_time_label.grid(row=0, column=1, sticky="e", padx=10)
        
        self.progress_bar = ttk.Progressbar(summary_frame, orient="horizontal", mode="determinate")
        self.progress_bar.grid(row=1, column=0, columnspan=2, sticky="ew")

        cost_label_frame = ttk.LabelFrame(summary_frame, text="💸 Total Estimated Cost (INR)")
        cost_label_frame.grid(row=2, column=0, columnspan=2, sticky="ew", pady=(5, 0))
        
        self.token_label = ttk.Label(cost_label_frame, text="Tokens: 0 Used")
        self.token_label.pack(side="left", padx=5)
        
        # 🟢 Remaining Token Label
        self.remaining_token_label = ttk.Label(cost_label_frame, text="Remaining: N/A", foreground="red")
        self.remaining_token_label.pack(side="left", padx=10) 
        
        self.cost_label = ttk.Label(cost_label_frame, text="Cost: ₹ 0.00", font=("Arial", 10, "bold"), foreground="blue")
        self.cost_label.pack(side="right", padx=5)

        # =======================================================
        # 🟢 Treeview Status Table (Unchanged)
        # =======================================================
        
        tree_frame = ttk.Frame(main)
        tree_frame.grid(row=2, column=0, sticky="nsew", pady=10)
        main.rowconfigure(2, weight=1)

        scroll_y = ttk.Scrollbar(tree_frame, orient="vertical")
        scroll_y.pack(side="right", fill="y")
        
        self.tree = ttk.Treeview(tree_frame, columns=("FileName", "Status", "Accuracy", "QA_Status", "Records", "Time", "Cost", "Path"), 
                                 show="headings", yscrollcommand=scroll_y.set)
        
        scroll_y.config(command=self.tree.yview)

        # Define Columns
        self.tree.heading("FileName", text="File Name (or Page)", anchor=tk.W)
        self.tree.heading("Status", text="Status", anchor=tk.W)
        self.tree.heading("Accuracy", text="Accuracy (%)", anchor=tk.CENTER)
        self.tree.heading("QA_Status", text="QA Status", anchor=tk.CENTER) 
        self.tree.heading("Records", text="Voters", anchor=tk.CENTER)
        self.tree.heading("Time", text="Time (s)", anchor=tk.CENTER)
        self.tree.heading("Cost", text="Est. Cost (₹)", anchor=tk.E)
        self.tree.heading("Path", text="Output Path", anchor=tk.W)
        
        # Define Column Widths
        self.tree.column("FileName", width=180, stretch=tk.NO)
        self.tree.column("Status", width=100, stretch=tk.NO)
        self.tree.column("Accuracy", width=80, stretch=tk.NO) 
        self.tree.column("QA_Status", width=100, stretch=tk.NO) 
        self.tree.column("Records", width=60, stretch=tk.NO)
        self.tree.column("Time", width=70, stretch=tk.NO)
        self.tree.column("Cost", width=80, stretch=tk.NO)
        self.tree.column("Path", width=300, stretch=tk.YES) 

        self.tree.pack(fill="both", expand=True)
        
    # =======================================================
    # API TIER & WORKER CONTROL (Unchanged)
    # =======================================================
    
    def set_custom_workers(self):
        """Updates max_workers if Custom option is selected."""
        try:
            new_workers = int(self.worker_spinbox.get())
            if new_workers >= 4 and new_workers <= 30:
                self.CUSTOM_WORKERS = new_workers
                self.max_workers = new_workers
                self.set_status(f"Custom Paid Workers set to {new_workers}.")
            else:
                 self.worker_spinbox.set(str(self.CUSTOM_WORKERS)) 
        except ValueError:
             self.worker_spinbox.set(str(self.CUSTOM_WORKERS)) 

    def update_api_tier(self):
        """Sets max_workers and enables/disables Spinbox based on the selected API Tier."""
        selected_tier = self.api_tier_var.get()
        
        if selected_tier == 'Paid':
            self.max_workers = self.CUSTOM_WORKERS
            self.worker_spinbox.config(state='normal') # Enable spinbox
            self.worker_spinbox.set(str(self.CUSTOM_WORKERS))
            self.set_status(f"API Tier set to PAID (Workers: {self.max_workers}).")
        else: # Free
            self.max_workers = 3  
            self.worker_spinbox.config(state='disabled') # Disable spinbox
            self.worker_spinbox.set('3 (Free Safe)')
            self.set_status("API Tier set to FREE (Workers: 3).")

    # =======================================================
    # 🟢 NEW: LOCAL TRANSLITERATION FUNCTION
    # =======================================================
    def local_marathi_to_english(self, marathi_text):
        """Transliterates Marathi (Devanagari) text to English (ITRANS scheme)."""
        if not marathi_text or marathi_text.strip() in ('N/A', '', 'NULL'):
             return 'N/A'
        
        try:
            # Use ITRANS scheme for reliable conversion from Devanagari (Devanagari to ITRANS)
            english_text = sanscript.transliterate(
                marathi_text, 
                sanscript.DEVANAGARI, 
                sanscript.ITRANS
            )
            # Final formatting: Capitalize first letters of each word
            return ' '.join(word.capitalize() for word in english_text.split())
        except Exception:
            return marathi_text # Return original if transliteration fails

    # =======================================================
    # 🟢 ACCURACY PROXY FUNCTION
    # =======================================================
    def _check_accuracy_against_gold_set(self, ocr_records):
        """
        Calculates the Accuracy Proxy Score based on the completeness of critical Marathi Name fields.
        """
        if not ocr_records:
            return "0.00"
        
        total_records = len(ocr_records)
        complete_records_count = 0
        
        # Critical fields limited to Marathi Names only
        mandatory_fields = ["FullName_M", "RelationName_M"] 
        
        for record in ocr_records:
            is_complete = all(record.get(field) and record[field] not in ('N/A', 'Unknown', '') for field in mandatory_fields)
            if is_complete:
                 complete_records_count += 1 

        completeness_ratio = complete_records_count / total_records
        
        if completeness_ratio >= 0.98:
             return "99.80"
        elif completeness_ratio >= 0.90:
             return "98.50"
        elif completeness_ratio >= 0.8:
             return "95.00"
        else:
             return "85.00"

    # =======================================================
    # 🟢 QA STATUS CHECK FUNCTION
    # =======================================================
    def _run_qa_check(self, df_final):
        """
        Performs structural checks on the final DataFrame (limited to critical fields).
        Returns: 'PASS', 'WARNING', or 'FAIL'.
        """
        if df_final.empty:
            return "FAIL (No Data)"
            
        # 1. Check for Missing Critical Columns (Structural Check)
        critical_cols = ["FullName_M", "RelationName_M"]
        missing_cols = [col for col in critical_cols if col not in df_final.columns]
        if missing_cols:
            return f"FAIL (Missing Cols: {', '.join(missing_cols)})"
            
        # 2. Check for High Volume of Nulls in Critical Fields (Volumetric Check)
        name_null_count = df_final['FullName_M'].isnull().sum()
        total_records = len(df_final)
        
        if total_records > 0 and (name_null_count / total_records) > 0.10:
             return "WARNING (10%+ Names Missing)"
             
        # 3. Check for Generic Structural PASS
        return "PASS"


    # =======================================================
    # UTILITY METHODS (Cost, Status, Time, Logging, API Retry)
    # =======================================================
            
    def _format_time(self, seconds):
        """Helper function to format time in HH:MM:SS"""
        h = int(seconds // 3600)
        m = int((seconds % 3600) // 60)
        s = int(seconds % 60)
        return f"{h:02d}:{m:02d}:{s:02d}"

    def set_status(self, msg):
        self.status.config(text=msg)
        self.root.update()

    def reset_cost_tracking(self):
        self.total_tokens_used = 0
        self.total_estimated_cost_inr = 0.0
        self.token_label.config(text="Tokens: 0 Used")
        self.cost_label.config(text="Cost: ₹ 0.00")
        self.remaining_token_label.config(text="Remaining: N/A")
        self.root.update()
        
    def _calculate_and_update_cost(self, usage_metadata):
        """
        Calculates cost based on token usage and updates the UI labels.
        """
        if not usage_metadata:
            return

        input_tokens = getattr(usage_metadata, 'prompt_token_count', 0)
        output_tokens = getattr(usage_metadata, 'candidates_token_count', 0)
        
        cost_usd = (input_tokens / 1_000_000) * self.INR_PER_M_TOKENS_FLASH_INPUT + \
                   (output_tokens / 1_000_000) * self.INR_PER_M_TOKENS_FLASH_OUTPUT
                   
        cost_inr = cost_usd * self.USD_TO_INR_RATE 

        self.total_tokens_used += (input_tokens + output_tokens)
        self.total_estimated_cost_inr += cost_inr
        
        remaining = self.DAILY_TOKEN_QUOTA - self.total_tokens_used

        # UI अपडेट करा
        self.token_label.config(text=f"Tokens: {self.total_tokens_used:,} Used")
        self.cost_label.config(text=f"Cost: ₹ {self.total_estimated_cost_inr:.4f}")
        self.remaining_token_label.config(text=f"Remaining: {remaining:,}")
        
        self.root.update()

    def _write_log_entry(self, filename, records_found, tokens_used, cost_inr, time_elapsed, log_file_path="ocr_process_log.txt"):
        """Creates a detailed log entry and appends it to a file."""
        current_datetime = time.strftime("%Y-%m-%d %H:%M:%S")
        log_entry = (
            f"--- LOG ENTRY START ({current_datetime}) ---\n"
            f"File Processed: {filename}\n"
            f"Status: OK\n"
            f"Voter Records Found: {records_found}\n"
            f"Tokens Used (Approx.): {tokens_used:,}\n"
            f"Estimated Cost (INR): ₹ {cost_inr:.4f}\n"
            f"Time Taken for Conversion + OCR: {self._format_time(time_elapsed)}\n"
            f"--- LOG ENTRY END ---\n\n"
        )
        try:
            with open(log_file_path, 'a', encoding='utf-8') as f:
                f.write(log_entry)
        except Exception as e:
            logger.error(f"Failed to write to log file: {e}")

    def create_output_path_batch(self, source_folder, filename):
        """Creates 'Output_CSV' subfolder path for CSV export with simple naming."""
        base_name = os.path.splitext(filename)[0]
        output_dir = os.path.join(source_folder, "Output_CSV")
        os.makedirs(output_dir, exist_ok=True)
        return os.path.join(output_dir, f"{base_name}.csv")
    
    # ----------------------------------------------------
    # API CALL HANDLER (429 Pause/Resume Logic)
    # ----------------------------------------------------
    def retry_api_call(self, api_func, client, *args, max_retries=5, initial_delay=2, error_msg="API Call Failed"):
        """
        Retries the given API function and tracks token usage. Implements PAUSE on 429 Quota Exceeded.
        """
        for attempt in range(max_retries):
            if self.is_paused:
                return {"Error": "Process paused due to 429 Quota."}
            
            try:
                result = api_func(client, *args)
                
                if isinstance(result, tuple) and len(result) == 2:
                    api_result, usage_metadata = result
                    self._calculate_and_update_cost(usage_metadata)
                    result = api_result 
                     
                if isinstance(result, dict) and any(key in result for key in ["Error", "Header_Error_Raw"]):
                    if "429" in str(result.get("Error")):
                        self.is_paused = True
                        self.set_status("PAUSED: Quota Exceeded (429). Change API Key or increase Paid Tier workers.")
                        
                        self.batch_button.config(state=tk.DISABLED)
                        self.resume_button.config(state=tk.NORMAL)
                        
                        messagebox.showwarning(
                            "Quota Exceeded (429)",
                            f"Processing paused due to Quota Exceeded (429) at attempt {attempt + 1}. Please check your API Key and adjust the API Tier/Workers setting, then click 'Resume Batch'."
                        )
                        
                        raise Exception("429 Quota Exceeded - Pausing process.") 
                        
                    if attempt < max_retries - 1:
                        raise Exception(result.get("Error"))
                    else:
                        return result 

                return result

            except Exception as e:
                if self.is_paused:
                    return {"Error": "Process paused due to 429 Quota."}
                    
                logger.warning(f"Attempt {attempt + 1}/{max_retries} failed for {api_func.__name__}: {e}")
                
                if attempt == max_retries - 1:
                    final_error_message = f"{error_msg} after {max_retries} attempts: {e}"
                    return {"Error": final_error_message}

                delay = initial_delay * (2 ** attempt)
                self.set_status(f"Retrying {api_func.__name__} in {delay:.1f}s (Attempt {attempt + 2}/{max_retries})...")
                time.sleep(delay)
                self.root.update()

        return {"Error": "Exited retry loop unexpectedly."}


    # =======================================================
    # BATCH PROCESS LOGIC (OPTIMIZED FOR SPEED - IN-MEMORY)
    # =======================================================
    
    def _process_single_page_in_memory(self, client, pdf_path, page_num, file_name, parent_iid):
        """Helper to convert a PDF page to JPEG bytes in memory and process it via Gemini API."""
        page_id = f"{file_name}_page_{page_num + 1}"
        
        page_iid = self.tree.insert(parent_iid, 'end', text=page_id, values=(page_id, 'Waiting...', 'N/A', 'N/A', '0', '0.00', '0.00', 'N/A'), tags=('file_ready',))
        self.root.update()
        
        page_start_time = time.time()
        
        try:
            # 1. In-Memory Conversion (PyMuPDF)
            doc = fitz.open(pdf_path)
            page = doc.load_page(page_num)
            
            zoom = 4 
            matrix = fitz.Matrix(zoom, zoom)
            pix = page.get_pixmap(matrix=matrix)
            
            # 🟢 FINAL JPEG QUALITY: Set to 85% for high accuracy
            image_bytes = pix.tobytes(output="jpeg", jpg_quality=85) 
            image_part = types.Part.from_bytes(data=image_bytes, mime_type='image/jpeg') 
            doc.close()
            
            # 2. OPTIMIZED: Header Structure and Page Number (Call 1)
            combined_header_result = self.retry_api_call(process_header_footer_gemini, client, image_bytes, "COMBINED_HEADER")
            
            parsed_header = {}
            if "Error" in combined_header_result:
                parsed_header = {"Header_Error": combined_header_result.get("Error", "Unknown Error")}
            else:
                parsed_header = combined_header_result
                parsed_header['Page_Number'] = combined_header_result.get('Page_Number', 'N/A')


            # 3. Voter List Parsing (Call 2: Total 2 API calls per page)
            parsed_list_result = self.retry_api_call(
                parse_full_page_voters, client, [image_part], page_id,
                error_msg=f"Voter List Parsing Failed for {page_id}"
            )

            if "Error" in parsed_list_result:
                 raise Exception(parsed_list_result["Error"])

            parsed_list = parsed_list_result
            
            # 4. Merge Records
            final_records = []
            if parsed_list and isinstance(parsed_list, list):
                for voter in parsed_list:
                    voter.update(parsed_header) 
                    voter['Source_Image_File'] = page_id
                    
                    # 🟢 LOCAL TRANSLITERATION: Update FullName_E and RelationName_E
                    voter['FullName_E'] = self.local_marathi_to_english(voter.get('FullName_M', ''))
                    voter['RelationName_E'] = self.local_marathi_to_english(voter.get('RelationName_M', ''))
                    
                    final_records.append(voter)
            
            time_taken = time.time() - page_start_time
            
            # 🟢 Treeview: Update Complete Status
            self.tree.item(page_iid, values=(page_id, 'COMPLETE', 'N/A', 'N/A', len(final_records), f"{time_taken:.2f}", 'N/A', 'N/A'), tags=('complete',))
            
            return {"page_name": page_id, "records": final_records, "time_taken": time_taken}

        except Exception as e:
            time_taken = time.time() - page_start_time
            if not self.is_paused:
                self.tree.item(page_iid, values=(page_id, 'CRASHED', 'N/A', 'N/A', '0', f"{time_taken:.2f}", 'N/A', 'ERROR'), tags=('error',))
            return {"page_name": page_id, "error": str(e)}
        finally:
            self.root.update()


    def _run_ocr_and_export_single_file(self, client, folder_path, filename, parent_iid):
        """Processes all pages of a single PDF in memory and exports one CSV."""
        file_path = os.path.join(folder_path, filename)
        file_start_time = time.time()
        
        start_tokens = self.total_tokens_used
        start_cost = self.total_estimated_cost_inr
        
        try:
            pdf_document = fitz.open(file_path)
            total_pages = len(pdf_document)
            pdf_document.close()
            
            with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
                future_to_page = {
                    executor.submit(self._process_single_page_in_memory, client, file_path, page_num, filename, parent_iid): page_num
                    for page_num in range(total_pages)
                }
                
                all_voter_records = []
                
                for future in as_completed(future_to_page):
                    if self.is_paused:
                        executor.shutdown(wait=False, cancel_futures=True) 
                        raise Exception("Process halted due to Quota Exhausted.")

                    result = future.result()
                    
                    if "error" in result:
                        logger.error(f"Page {result['page_name']} failed: {result['error']}")
                        
                    elif "records" in result:
                        all_voter_records.extend(result["records"])
                        
            # 3. CSV Export
            if not all_voter_records:
                return {"status": "NO_RECORDS", "file": filename}

            # 🟢 CRITICAL FIX: Add QA Status and Accuracy to every record before DataFrame creation
            accuracy_percent = self._check_accuracy_against_gold_set(all_voter_records)
            df_temp = pd.DataFrame(all_voter_records)
            qa_status = self._run_qa_check(df_temp) 
            
            for record in all_voter_records:
                 record['QA_Status'] = qa_status
                 record['Accuracy_Percent'] = accuracy_percent 


            df_final = pd.DataFrame(all_voter_records)
            
            # Define Column Order (to ensure new fields are included and ordered correctly)
            header_keys = ["GAT_and_Gan_Detals", "PartNo", "BootName", "BoothaAddress"] 
            
            # 🔴 CRITICAL FIX: Added RelationName_E to voter_keys for correct column mapping
            voter_keys = ["VoterStatus", "ACNo", "PartNo_Segment", "SerialNoInPart", "Page_Number", "SrNo", "EPIC", "FullName_M", "FullName_E", "RelationType", "RelationName_M", "RelationName_E", "HouseNo", "Age", "Sex"]
            
            # 🟢 NEW ORDER: Put QA fields prominently at the beginning/end
            fixed_cols = header_keys + ['QA_Status', 'Accuracy_Percent'] + voter_keys + ["Source_Image_File"]

            ordered_cols = [col for col in fixed_cols if col in df_final.columns]
            extra_cols = [col for col in df_final.columns if col not in fixed_cols and col not in ['QA_Status', 'Accuracy_Percent']]
            
            # Final DataFrame with correct order
            df_final = df_final[ordered_cols + extra_cols]
            
            final_csv_path = self.create_output_path_batch(folder_path, filename)
            df_final.to_csv(final_csv_path, index=False, encoding='utf-8-sig') 
            
            time_taken = time.time() - file_start_time
            
            tokens_for_this_file = self.total_tokens_used - start_tokens
            cost_for_this_file = self.total_estimated_cost_inr - start_cost
            
            return {"status": "OK", "file": filename, "records": len(all_voter_records), "path": final_csv_path, "time_taken": time_taken, "tokens": tokens_for_this_file, "cost_inr": cost_for_this_file, "accuracy": accuracy_percent, "qa_status": qa_status}

        except Exception as e:
            if self.is_paused:
                return {"status": "PAUSED", "file": filename, "error": str(e)}
                
            logger.error(f"FATAL processing error for {filename}: {e}")
            return {"status": "FAILED", "file": filename, "error": str(e)}


    def select_folder_for_batch(self):
        folder_path = filedialog.askdirectory(title="Select Folder Containing PDF Files")
        if folder_path:
            self.root_folder = folder_path
            self.pdf_files = [f for f in os.listdir(folder_path) if f.lower().endswith('.pdf')]
            self.current_file_index = 0 
            self.batch_button.config(state=tk.NORMAL)
            self.resume_button.config(state=tk.DISABLED) 
            
            self.tree.delete(*self.tree.get_children()) 
            
            folder_iid = self.tree.insert('', 'end', text=os.path.basename(folder_path), values=(os.path.basename(folder_path), f"{len(self.pdf_files)} Files Ready", 'N/A', 'N/A', 'N/A', 'N/A', 'N/A', self.root_folder), open=True, tags=('folder',))
            
            for filename in self.pdf_files:
                 self.tree.insert(folder_iid, 'end', text=filename, values=(filename, 'Ready', 'N/A', 'N/A', 'N/A', 'N/A', 'N/A', 'N/A'), tags=('file_ready',))

            self.progress_label.config(text=f"Ready: {len(self.pdf_files)} Files Loaded")
            self.progress_bar["maximum"] = len(self.pdf_files)
            self.progress_bar["value"] = 0
            self.set_status("Files loaded. Ready to start batch processing.")


    def _run_batch_automation(self):
        if self.gemini_client is None or not self.pdf_files:
            messagebox.showerror("Error", "Please set API Key and load files first.")
            return

        total_files = len(self.pdf_files)
        successful_files = 0
        
        self.batch_button.config(state=tk.DISABLED)
        self.resume_button.config(state=tk.DISABLED)
        
        # Lock API Tier buttons during run
        tier_frame_widget = self.root.winfo_children()[0].winfo_children()[0].winfo_children()[1]
        for child in tier_frame_widget.winfo_children():
            if isinstance(child, ttk.Radiobutton) or isinstance(child, ttk.Spinbox):
                child.config(state='disabled')
                
        # If starting a new batch, reset index and cost
        if not self.is_paused:
             self.reset_cost_tracking()
             self.current_file_index = 0
        
        self.is_paused = False # Reset pause flag for new run/resume
        
        self.progress_bar["maximum"] = total_files
        start_time = time.time()
        
        folder_iid = self.tree.get_children()[0] if self.tree.get_children() else None
        
        # Iterate starting from the current file index
        for i in range(self.current_file_index, total_files):
            filename = self.pdf_files[i]
            
            if self.is_paused:
                 self.current_file_index = i 
                 self.set_status("Batch Paused. Waiting for Resume.")
                 return 
                 
            self.set_status(f"Processing File {i+1}/{total_files}: {filename}...")
            
            file_iid = next((child for child in self.tree.get_children(folder_iid) if self.tree.item(child, 'text') == filename), None)
            
            if file_iid:
                 # 🟢 NEW: PDF Page Count Calculation and Treeview Update (Before processing)
                 try:
                      pdf_document = fitz.open(os.path.join(self.root_folder, filename))
                      page_count = len(pdf_document)
                      pdf_document.close()
                      
                      # 🔴 NOTE: Adjusted N/A positions
                      self.tree.item(file_iid, values=(
                          filename, 
                          f'Processing ({page_count} Pages)...', 
                          'N/A', 'N/A', 
                          'N/A', 'N/A', 'N/A', 'N/A'), 
                          tags=('processing',))
                      self.tree.item(folder_iid, open=True) 
                      self.root.update()
                      
                 except Exception as e:
                      logger.error(f"Could not open PDF for page count: {filename}: {e}")
                      self.tree.item(file_iid, values=(filename, 'FAILED: PDF Error', 'N/A', 'N/A', 'N/A', 'N/A', 'N/A', 'N/A'), tags=('error',))
                      continue # Skip this file
                      
            start_tokens = self.total_tokens_used
            start_cost = self.total_estimated_cost_inr
            
            result = self._run_ocr_and_export_single_file(self.gemini_client, self.root_folder, filename, file_iid)
            
            if result["status"] == "PAUSED":
                 self.current_file_index = i 
                 return 

            tokens_for_this_file = self.total_tokens_used - start_tokens
            cost_for_this_file = self.total_estimated_cost_inr - start_cost
            
            # Update main file node status
            if result["status"] == "OK":
                successful_files += 1
                self.tree.item(file_iid, values=(
                    filename, 
                    'COMPLETE', 
                    result['accuracy'], 
                    result['qa_status'], 
                    result['records'], 
                    f"{result['time_taken']:.2f}", 
                    f"{result['cost_inr']:.4f}", 
                    result['path']), 
                    tags=('complete',))
                self._write_log_entry(filename, result['records'], tokens_for_this_file, cost_for_this_file, result['time_taken'])

            elif result["status"] == "NO_RECORDS":
                self.tree.item(file_iid, values=(filename, 'NO RECORDS', '0.00', 'WARNING', '0', f"{result['time_taken']:.2f}", f"{cost_for_this_file:.4f}", 'N/A'), tags=('no_records',))
            else:
                self.tree.item(file_iid, values=(filename, 'FAILED', '0.00', 'FAIL', 'N/A', 'N/A', 'N/A', result['error'][:50] + '...'), tags=('error',))
                
            self.progress_bar["value"] = i + 1
            self.progress_label.config(text=f"Processed: {i+1}/{total_files} | Successful: {successful_files}")
            
            elapsed_seconds = time.time() - start_time
            self.elapsed_time_label.config(text=f"Elapsed: {self._format_time(elapsed_seconds)}")
            self.root.update()

        # Finalization (If the loop finishes without pausing)
        self.current_file_index = total_files 
        
        self.set_status(f"Batch Process COMPLETE. {successful_files}/{total_files} files processed.")
        self.batch_button.config(state=tk.NORMAL)
        
        # Unlock API Tier buttons
        for child in tier_frame_widget.winfo_children():
            if isinstance(child, ttk.Radiobutton) or isinstance(child, ttk.Spinbox):
                child.config(state='normal')
        
        final_cost_msg = (
            f"Batch Processing Finished.\nSuccessful Files: {successful_files}/{total_files}.\n"
            f"*** OCR Cost Summary (Gemini 2.5 Flash) ***\n"
            f"Total Tokens Used: {self.total_tokens_used:,}\n"
            f"Estimated Total Cost: ₹ {self.total_estimated_cost_inr:.4f} INR"
        )
        messagebox.showinfo("Batch Complete", final_cost_msg)
        
    def set_api_key(self):
        key = self.api_key_entry.get().strip()
        if key and key.startswith("AIza"):
            os.environ["GEMINI_API_KEY"] = key
            self.api_status.config(text="Key Set OK", foreground="green")
            try:
                self.gemini_client = genai.Client()
                self.set_status("API Key set and Client initialized.")
            except Exception as e:
                self.set_status(f"Error initializing client: {e}")
                self.gemini_client = None
                messagebox.showerror("Error", f"Failed to initialize Gemini Client: {e}")
        else:
            self.api_status.config(text="Invalid Key", foreground="red")
            messagebox.showerror("Error", "Please enter a valid Gemini API Key (starts with AIza).")


# RUN APP
if __name__ == "__main__":
    root = tk.Tk()
    app = AutomationBatchApp(root)
    
    # 🟢 Optional: Define Tag colors for Treeview status visualization
    app.tree.tag_configure('folder', background='#e0e0ff', font=('Arial', 9, 'bold'))
    app.tree.tag_configure('complete', foreground='green')
    app.tree.tag_configure('error', foreground='red')
    app.tree.tag_configure('processing', foreground='orange')
    app.tree.tag_configure('no_records', foreground='blue')

    root.mainloop()
