# PDF Error Handling Testing Guide

## How to Test Each Error Catching Stage

### 1. File Loading Errors
**Test Method**: Upload a file that doesn't exist or is corrupted

**Expected Console Output**:
```
❌ FILE LOAD ERROR: PDF file is empty or corrupted
```

**User Sees**: Toast notification explaining the file issue

---

### 2. PDF Parsing Errors
**Test Method**: 
- Upload a non-PDF file with .pdf extension
- Upload an invalid PDF file

**Expected Console Output**:
```
⏳ Parsing PDF...
❌ PDF PARSE ERROR: [error details]
```

**User Sees**: Toast: "Failed to parse PDF: [specific error]"

---

### 3. Page Rendering Errors
**Test Method**: Upload a PDF with unusual formatting

**Expected Console Output**:
```
⏳ Rendering 10 pages with 4 concurrency...
❌ RENDER ERROR (Page 3): [error details]
⚠️ OCR hint failed for page 3: [error message]
✅ Rendering complete: 8/10 pages successfully rendered
⚠️ 2 pages failed to render
```

**User Sees**: Warning toast about pages needing review

---

### 4. API/Gemini Errors
**Test Method**: 
- Use invalid/expired API key
- Upload multiple PDFs rapidly (rate limit)
- Check internet connection loss during processing

**Expected Console Output**:
```
❌ Gemini API error for page 5: 401 Unauthorized
❌ Gemini API error for page 6: 429 Too Many Requests
```

**User Sees**: Toast: "API error on page 5. Check API key or rate limit."

---

### 5. Environment Detection
**Location**: Browser Console after upload starts

**Electron Desktop**:
```
🖥️ Electron detected - using worker fetch
```

**Vercel Web**:
```
🌐 Web detected - disabling worker fetch
```

---

## How to View Console Errors

### Vercel Web (voterdetails.vercel.app)
1. Press `F12` or `Ctrl+Shift+I` to open Developer Tools
2. Go to **Console** tab
3. Look for messages with 🌐 Web, ❌, ⚠️, or ✅ emojis
4. Messages are color-coded:
   - 🔴 Red = errors
   - 🟡 Yellow = warnings
   - 🔵 Blue = info

### Electron Desktop App
1. Open DevTools: `Ctrl+Shift+I`
2. Go to **Console** tab
3. Same emoji-prefixed messages will appear

---

## Quick Troubleshooting Matrix

| Symptom | Likely Cause | Check For |
|---------|-------------|-----------|
| PDF won't upload | File is too large or corrupted | "FILE LOAD ERROR" in console |
| "0 pages" error | Invalid/blank PDF | "PDF has 0 pages" message |
| Rendering hangs | Worker fetch issue on web | "🌐 Web detected" log |
| Partial results | Some pages failed to render | "RENDER ERROR (Page X)" logs |
| No records extracted | Gemini API issue | "Gemini API error" message |
| Slow processing | Concurrency too high | Check "Speed: X pages/min" |

---

## Success Indicators

✅ **You'll know error catching is working when**:
1. PDF loads → See "📄 PDF loaded: filename.pdf"
2. PDF parses → See "✅ PDF parsed successfully. Pages: X"
3. Pages render → See "✅ Rendering complete: X/Y pages"
4. Records extract → See "👥 Voters Extracted: X"
5. Processing completes → See full "🚀 EXTRACTION COMPLETE" summary

---

## Error Logs Format Reference

```
[Phase] [Status Emoji] [Message]: [Details]

Phases: FILE LOAD, PDF OPTIONS, PDF PARSE, RENDER, OCR, GEMINI API, UNEXPECTED
Status: ❌ (error), ⚠️ (warning), ✅ (success), ⏳ (processing)
```

### Example Real-World Log
```
📄 PDF loaded: data hhh.pdf Size: 2048.50KB
🌐 Web detected - disabling worker fetch
⏳ Parsing PDF...
✅ PDF parsed successfully. Pages: 15
⏳ Rendering 15 pages with 4 concurrency...
✅ Rendering complete: 15/15 pages successfully rendered
🚀 SPEED PROFILE: BALANCED | 15 pages | Concurrency: 4 | Scale: 2.5x | Batch: ON
```

---

## Known Issues & Workarounds

### Issue: "Worker fetch failed on Vercel"
**Workaround**: Already fixed - uses `useWorkerFetch: false` on web

### Issue: "CORS error for CDN"
**Workaround**: Already using cdn.jsdelivr.net which has better CORS support

### Issue: "Gemini rate limit"
**Workaround**: Use BALANCED or CONSERVATIVE speed profile to slow down concurrent requests

### Issue: "Some pages render as black"
**Workaround**: Check PDF quality - use desktop app to pre-process PDF first

---

## Getting Help

When reporting an issue, include:
1. **Console logs** (F12 → Console → right-click → Save As)
2. **Error toast message** (screenshot)
3. **PDF filename** and approximate size
4. **Environment** (Vercel web / Desktop app)
5. **API Key status** (just confirm it's set, don't share it)

Example good report:
```
"data hhh.pdf" fails on Vercel with "rendering failed" error.
Console shows: "❌ RENDER ERROR (Page 5): Context is null"
Only 4/15 pages render successfully.
```

---

## Version Info

- **Error Handling Commit**: `8ba9f77`
- **Documentation**: `ERROR_HANDLING_SUMMARY.md`
- **Last Updated**: After Vercel deployment fixes
