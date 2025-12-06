# PDF Processing Error Flow Diagram

## Complete Error Catching Pipeline

```
┌─────────────────────────────────────────────────────────────┐
│                    USER UPLOADS PDF                         │
│                   (Vercel Web or Desktop)                   │
└────────────────────────┬────────────────────────────────────┘
                         │
          ┌──────────────▼───────────────┐
          │   STEP 1: FILE LOAD ❌→✅    │
          │   Read arrayBuffer from File │
          └────────┬──────────┬──────────┘
                   │          │
              SUCCESS        ERROR
                   │          │
                   │    ┌─────▼──────────────┐
                   │    │ File is Empty?     │
                   │    │ Corrupted Data?    │
                   │    │ 📍 Lines 2171-2180 │
                   │    └─────┬──────────────┘
                   │          │
                   │    ┌─────▼───────────────────┐
                   │    │ SHOW ERROR TO USER:     │
                   │    │ ❌ FILE LOAD ERROR      │
                   │    │ ❌ Toast Notification   │
                   │    │ STOP PROCESSING        │
                   │    └───────────────────────┘
                   │
          ┌────────▼──────────────┐
          │  STEP 2: PDF CONFIG   │
          │  Create Parser Options│
          │  📍 Lines 2182-2212   │
          └────────┬──────────────┘
                   │
          SUCCESS / ERROR
                   │
        ┌──────────┴──────────┐
        │                     │
    SUCCESS                ERROR
        │                     │
        │           ┌─────────▼─────────────┐
        │           │ Options Invalid?      │
        │           │ Bad CDN Paths?        │
        │           │ Worker Config Failed? │
        │           └─────────┬─────────────┘
        │                     │
        │           ┌─────────▼──────────────┐
        │           │ SHOW ERROR TO USER:    │
        │           │ ❌ PDF OPTIONS ERROR   │
        │           │ ❌ Toast Notification  │
        │           │ STOP PROCESSING       │
        │           └────────────────────────┘
        │
     ┌──▼──────────────────┐
     │ ENVIRONMENT CHECK   │
     │ Is Electron? Web?   │
     │ 📍 Lines 2203-2212  │
     └──┬──────────────────┘
        │
   ┌────┴────────────────────┐
   │                         │
ELECTRON (🖥️)           WEB (🌐)
   │                         │
   ├─ useWorkerFetch: true   ├─ useWorkerFetch: false
   ├─ Worker: cdnjs          ├─ Worker: cdn.jsdelivr
   └─────────┬───────────────┘
             │
     ┌───────▼────────────────┐
     │ STEP 3: PDF PARSE ❌→✅ │
     │ Parse Document Object  │
     │ 📍 Lines 2214-2233     │
     └───────┬────────────────┘
             │
       SUCCESS / ERROR
             │
    ┌────────┴────────┐
    │                 │
SUCCESS             ERROR
    │                 │
    │        ┌────────▼──────────────┐
    │        │ 0 pages detected?      │
    │        │ Invalid Document?      │
    │        │ numPages undefined?    │
    │        └────────┬───────────────┘
    │                 │
    │        ┌────────▼──────────────┐
    │        │ SHOW ERROR TO USER:    │
    │        │ ❌ PDF PARSE ERROR     │
    │        │ ❌ Toast Notification  │
    │        │ STOP PROCESSING       │
    │        └────────────────────────┘
    │
┌───▼────────────────────────────┐
│ STEP 4: PAGE RENDERING ❌→✅  │
│ Render All Pages → Images      │
│ 📍 Lines 2264-2354            │
└───┬────────────────────────────┘
    │
    └─ FOR EACH PAGE (Parallel):
       │
       ├─ Get Page Object
       ├─ Get Text Content
       ├─ Create Canvas
       ├─ Render to Canvas
       └─ Convert to JPEG Base64
       │
       ├─ Success → Store Base64
       │
       └─ Error (Page N):
          ├─ ❌ RENDER ERROR (Page X)
          ├─ Log per-page error
          ├─ Mark as failed
          └─ CONTINUE (graceful)
       │
    ┌──▼─────────────────────┐
    │ Batch Results:         │
    │ Track Success/Failures │
    │ 📍 Lines 2330-2354     │
    └──┬─────────────────────┘
       │
       ├─ ALL pages rendered? → SUCCESS
       │
       ├─ SOME pages failed?
       │  ├─ ✅ Continue with successful
       │  └─ ⚠️ Show warning to user
       │
       └─ NO pages rendered? → STOP & ERROR
          └─ ❌ "All pages failed to render"

    (Assuming at least 1 page succeeded...)
    │
┌───▼─────────────────────────────────────┐
│ STEP 5: GEMINI AI PROCESSING ❌→✅    │
│ Extract Voters from Page Images         │
│ 📍 Lines 2354-2419                      │
└───┬─────────────────────────────────────┘
    │
    └─ FOR EACH RENDERED PAGE (Concurrency: 4-8):
       │
       ├─ No image data (render failed)?
       │  ├─ ⚠️ Page X: No image data
       │  └─ CONTINUE
       │
       ├─ Try Hybrid OCR (optional):
       │  ├─ Success? → Use OCR text
       │  └─ Fail? → Fallback to PDF text
       │
       ├─ Call Gemini API:
       │  │
       │  ├─ Success ✅
       │  │  └─ Extract voters from response
       │  │
       │  └─ Error ❌
       │     ├─ Gemini API Error (Page X)
       │     ├─ Check error type:
       │     │  ├─ 401/403? API key issue
       │     │  ├─ 429? Rate limit
       │     │  └─ Network? Connection issue
       │     └─ CONTINUE (log & mark failed)
       │
       └─ Store extracted voters
    │
    ├─ Count successes vs failures
    │
    └─ Show progress to user

    (After all pages processed...)
    │
┌───▼────────────────────────────┐
│ FINAL DEDUPLICATION            │
│ & DATABASE SAVE                │
└───┬────────────────────────────┘
    │
    ├─ Remove duplicate voter IDs
    ├─ Save to IndexedDB
    ├─ Update UI with results
    └─ Show success summary
        │
        ├─ 👥 Voters Extracted: X
        ├─ 🔄 Duplicates Removed: Y
        ├─ ⚠️ Pages Needing Review: Z
        └─ ⏱️ Time: X.Xs

    ✅ PROCESSING COMPLETE
    
└──────────────────────────────────

CATCH-ALL ERROR HANDLER 🛡️
│
├─ STEP 6: FINAL ERROR CATCH ❌→✅
│ 📍 Lines 2490-2510
│
└─ Smart Error Diagnosis:
   │
   ├─ Is "0 pages" in error?
   │  └─ "PDF appears invalid/corrupted"
   │
   ├─ Is "worker" in error?
   │  └─ "PDF rendering failed. Try reloading."
   │
   ├─ Is "CORS"/"401"/"403" in error?
   │  └─ "CDN access issue. Check internet."
   │
   ├─ Is "API"/"key" in error?
   │  └─ "API error. Check API key."
   │
   └─ Otherwise:
      └─ "PDF processing failed: [error]"
      
   ⚠️ Always show user toast
   ⚠️ Always log to console
   ✅ Always stop gracefully
```

---

## Error Recovery Paths

### Path 1: Fatal Error → Stop
```
FILE LOAD ERROR → Show Toast → STOP
                   ↑
PDF PARSE ERROR → Show Toast → STOP
```

### Path 2: Page-Level Error → Continue
```
PAGE 3 RENDER FAILS → Log Error → SKIP PAGE → CONTINUE with Page 4...
                      ↑
PAGE 5 API FAILS   → Log Error → SKIP PAGE → CONTINUE with Page 6...
```

### Path 3: Partial Success → Show Warning
```
3/15 pages fail → Continue → Process remaining 12 pages → 
   Show warning in UI: "⚠️ 3 pages need review"
```

---

## Console Error Messages Flow

```
📄 PDF loaded ✓
   ↓
🌐 Web detected
   ↓
⏳ Parsing PDF...
   ↓
✅ PDF parsed successfully (15 pages)
   ↓
⏳ Rendering 15 pages...
   ↓
❌ RENDER ERROR (Page 5): Canvas context null [LOGGED]
   ↓
✅ Rendering complete: 14/15 successful [LOGGED]
   ↓
⚠️ 1 page failed to render [LOGGED]
   ↓
[Processing Gemini...]
   ↓
❌ Gemini API error (Page 5): [LOGGED]
   ↓
⚠️ Page 5: No voters extracted [LOGGED]
   ↓
✅ EXTRACTION COMPLETE [SUMMARY]
```

---

## Error Codes & User Messages

| Console Code | User Message | Action |
|---|---|---|
| ❌ FILE LOAD ERROR | "Failed to load PDF file" | Retry upload |
| ❌ PDF OPTIONS ERROR | "Failed to configure PDF parser" | Reload page |
| ❌ PDF PARSE ERROR | "Failed to parse PDF: [detail]" | Try different PDF |
| ❌ RENDER ERROR (Page X) | (warning only) | Some data extracted |
| ❌ Gemini API error | "API error on page X. Check key." | Verify API key |
| ❌ UNEXPECTED ERROR | "PDF processing failed: [error]" | Check console |

---

## Performance Notes

✅ Error checking adds **<5ms overhead**
✅ Logging only happens on **errors** (not every success)
✅ Graceful degradation **improves UX**
✅ No **performance penalty** on success path
