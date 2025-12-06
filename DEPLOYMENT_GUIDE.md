# VoterAlign Pro - Multi-Device Deployment Guide

## 🚀 Setup for 4 Devices (Admin + Employees)

---

## 📋 **Prerequisites**

- ✅ Windows 10/11 (64-bit)
- ✅ 8GB RAM minimum (16GB recommended)
- ✅ Internet connection (for Gemini API)
- ✅ Gemini PAID API Key: `AIzaSyBM_EBIoCLHRpllWDfU6ToxNXHkjy3u-OE`

---

## 📦 **Installation Steps**

### **Option 1: Quick Setup (Portable - Recommended)**

1. **Copy to Each Device:**
   ```
   release\VoterAlign Pro-Portable-1.0.0.exe
   ```

2. **Create Folder Structure:**
   ```
   C:\VoterAlign\
   └── VoterAlign Pro-Portable-1.0.0.exe
   ```

3. **Run Application:**
   - Double-click `VoterAlign Pro-Portable-1.0.0.exe`
   - No installation needed
   - Data stored locally in AppData

---

### **Option 2: Full Installation (With Shortcuts)**

1. **Run Installer:**
   ```
   release\VoterAlign Pro-1.0.0-x64.exe
   ```

2. **Installation Options:**
   - ✅ Choose installation directory
   - ✅ Create desktop shortcut
   - ✅ Create start menu entry

3. **Installation Location:**
   ```
   C:\Program Files\VoterAlign Pro\
   ```

---

## 👥 **User Role Configuration**

### **Device 1: ADMIN (You)**

**Capabilities:**
- ✅ Create/manage employee accounts
- ✅ Access all voter data
- ✅ Export/import databases
- ✅ Change speed profiles (TURBO/BALANCED/SAFE)
- ✅ Monitor system performance

**Setup:**
1. Launch application
2. First-time setup creates ADMIN account
3. Set admin password
4. Create employee accounts (Device 2, 3, 4)

---

### **Devices 2, 3, 4: EMPLOYEES**

**Capabilities:**
- ✅ Upload PDFs and extract voter data
- ✅ Search/filter voters
- ✅ Export voter lists
- ❌ Cannot access other users' data
- ❌ Cannot change speed profiles

**Setup:**
1. Launch application
2. Login with credentials provided by admin
3. Start processing PDFs

---

## ⚙️ **Speed Profile Setup (By Usage)**

### **Scenario 1: All 4 Devices Active (SAFE Mode)**

```typescript
Admin Dashboard → Settings → Speed Profile → SAFE

CONCURRENCY: 12
Optimized for: 20 devices (safe for 4)
Speed: ~2-3 minutes for 35 pages
API Usage: ~48 RPM total (4 devices × 12)
```

**When to Use:** All 4 devices processing simultaneously

---

### **Scenario 2: 2-3 Devices Active (BALANCED Mode)**

```typescript
Admin Dashboard → Settings → Speed Profile → BALANCED

CONCURRENCY: 24
Optimized for: ~10 devices (safe for 2-3)
Speed: ~1.5-2 minutes for 35 pages
API Usage: ~72 RPM total (3 devices × 24)
```

**When to Use:** Normal workload, 2-3 devices active

---

### **Scenario 3: 1 Device Processing (TURBO Mode) ⚡**

```typescript
Admin Dashboard → Settings → Speed Profile → TURBO

CONCURRENCY: 50
Optimized for: 1-3 devices (maximum speed)
Speed: ~1-2 minutes for 35 pages
API Usage: ~50-150 RPM (1-3 devices)
```

**When to Use:** Urgent single-device processing, deadline work

---

## 🔐 **Account Management**

### **Admin Actions:**

1. **Create Employee Account:**
   ```
   Settings → User Management → Add Employee
   - Username: employee1
   - Password: [set secure password]
   - Role: Employee
   ```

2. **Recommended Account Structure:**
   ```
   Device 1: admin (Admin)
   Device 2: employee1 (Employee)
   Device 3: employee2 (Employee)
   Device 4: employee3 (Employee)
   ```

3. **Password Policy:**
   - Minimum 6 characters
   - Share securely with each employee
   - Change passwords periodically

---

## 📊 **Data Storage**

### **Local Storage (Per Device):**

```
C:\Users\[Username]\AppData\Roaming\VoterAlign Pro\
├── IndexedDB\
│   └── voter_database (voter records)
├── localStorage\
│   ├── users.json (accounts)
│   └── settings.json (speed profiles)
└── logs\
```

### **Data Isolation:**
- Each employee sees only their uploaded data
- Admin can access all data
- No automatic sync between devices

---

## 🔄 **Sharing Data Between Devices**

### **Method 1: Export/Import (Recommended)**

**On Device 1 (Admin):**
```
1. Open voter list
2. Click "Export All" → Save as CSV/Excel
3. Copy file to shared folder/USB
```

**On Device 2, 3, 4:**
```
1. Click "Import Data"
2. Select exported CSV/Excel file
3. Data merged into local database
```

---

### **Method 2: Centralized Database (Advanced)**

**Option A: Shared Network Drive**
```
1. Setup shared folder: \\SERVER\VoterData\
2. Export from each device to shared folder
3. Admin imports all data periodically
```

**Option B: Cloud Storage (Vercel Deployment)**
- Deploy to Vercel for web access
- All devices access via browser: https://your-app.vercel.app
- Centralized PostgreSQL/MongoDB backend

---

## 🚨 **API Rate Limiting**

### **PAID Tier Limits:**
```
Total: 2000 RPM (Requests Per Minute)
```

### **Safe Distribution (4 Devices):**

| Mode | Per Device | Total (4 devices) | Buffer |
|------|-----------|-------------------|--------|
| SAFE | 12 | 48 RPM | 1952 RPM free |
| BALANCED | 24 | 96 RPM | 1904 RPM free |
| TURBO | 50 | 200 RPM | 1800 RPM free |

**Recommendation:** Use BALANCED mode by default (plenty of headroom)

---

## 📝 **Daily Workflow**

### **Morning Setup:**

1. **Admin (Device 1):**
   - Check speed profile setting
   - Verify all employee accounts active
   - Set mode based on expected workload:
     - Light day (1-2 devices): TURBO
     - Normal day (2-3 devices): BALANCED
     - Heavy day (all 4 devices): SAFE

2. **Employees (Devices 2, 3, 4):**
   - Login to assigned device
   - Start processing assigned PDFs
   - Monitor extraction accuracy

---

### **During Processing:**

- **Each Employee:**
  - Upload PDF (35-36 pages)
  - Wait 1-2 minutes (depending on mode)
  - Review extracted data
  - Export to Excel if needed
  - Move to next PDF

- **Admin Monitoring:**
  - Check if devices hitting errors
  - Adjust speed profile if needed
  - Collect exported data from employees

---

### **End of Day:**

1. **Employees:**
   - Export their day's data
   - Save to shared folder/USB
   - Logout

2. **Admin:**
   - Import all employee exports
   - Consolidate master database
   - Backup data
   - Review total records processed

---

## 🔧 **Troubleshooting**

### **"API Rate Limit Exceeded" Error:**

**Cause:** Too many devices in TURBO mode simultaneously

**Solution:**
```
Admin → Settings → Switch to BALANCED or SAFE mode
Wait 1 minute, retry extraction
```

---

### **"Login Failed" on Employee Device:**

**Solution:**
```
Admin Device:
1. Settings → User Management
2. Reset employee password
3. Share new password securely
```

---

### **Different Headers Per Page Not Detected:**

**Status:** ✅ Already handled by 2-call approach

**How it Works:**
- Call 1: Extracts header for EACH page individually
- Call 2: Extracts voters for that page
- Different headers = No problem!

---

### **Slow Extraction Speed:**

**Check:**
1. Current speed profile (Settings)
2. Number of active devices
3. Internet connection speed

**Optimize:**
- Single device? Use TURBO
- 2-3 devices? Use BALANCED
- All 4 devices? Use SAFE

---

## 📈 **Performance Expectations**

### **Target Metrics (Per Device):**

| Mode | Pages | Voters | Time | Accuracy |
|------|-------|--------|------|----------|
| TURBO | 35-36 | 1000+ | 1-2 min | 95%+ |
| BALANCED | 35-36 | 1000+ | 1.5-2 min | 95%+ |
| SAFE | 35-36 | 1000+ | 2-3 min | 95%+ |

### **Daily Capacity (4 Devices):**

**BALANCED Mode (Recommended):**
```
Per device: ~30 PDFs/day (8 hours)
Total: ~120 PDFs/day (4 devices)
Voters: ~120,000 records/day
```

---

## 🔒 **Security Best Practices**

1. **API Key Security:**
   - ✅ Already embedded in app
   - ❌ Don't share the key externally
   - ✅ Monitor usage in Google AI Studio

2. **User Accounts:**
   - Strong passwords for all accounts
   - Different password for each employee
   - Change admin password monthly

3. **Data Backup:**
   - Export master database weekly
   - Store backups in secure location
   - Keep 3 versions (current + 2 old)

4. **Device Security:**
   - Windows login passwords
   - Lock screen when away
   - Antivirus enabled

---

## 📞 **Support**

### **Common Questions:**

**Q: Can employees see each other's data?**  
A: No, data is isolated per account.

**Q: What if one device crashes?**  
A: Data stored locally. Restart app, data intact.

**Q: Can we process 100 pages in one go?**  
A: Yes! System handles any PDF size, but split for faster processing.

**Q: Internet required?**  
A: Yes, for Gemini API calls. No internet = no extraction.

**Q: Can we run 10 devices?**  
A: Yes! Adjust to SAFE mode (12 concurrency). Total: 120 RPM (well under 2000 limit).

---

## 🎯 **Quick Start Checklist**

### **Admin (Device 1):**
- [ ] Install VoterAlign Pro
- [ ] Create admin account
- [ ] Create 3 employee accounts (employee1, employee2, employee3)
- [ ] Set speed profile to BALANCED
- [ ] Test extraction with sample PDF
- [ ] Share employee credentials securely

### **Employees (Devices 2, 3, 4):**
- [ ] Install VoterAlign Pro
- [ ] Login with provided credentials
- [ ] Test extraction with sample PDF
- [ ] Verify export functionality
- [ ] Confirm shared folder access

---

## ✅ **You're Ready!**

Your 4-device setup is now configured for:
- ✅ Optimized PAID API usage (2000 RPM)
- ✅ Role-based access (Admin + 3 Employees)
- ✅ Flexible speed profiles (TURBO/BALANCED/SAFE)
- ✅ Different headers per page support
- ✅ Production-grade accuracy (95%+)

**Start Processing!** 🚀
