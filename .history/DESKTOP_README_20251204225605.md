# VoterAlign Pro - Desktop Application

## 🖥️ Electron Desktop App for Election Data Management

This is a desktop application for extracting and managing voter data from PDF documents using AI-powered OCR.

---

## 📋 Setup for Development

### Prerequisites
- Node.js 18+ installed
- Your Paid Gemini API Key

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure API Key
Edit `index.tsx` and update the embedded API key:
```javascript
const DESKTOP_CONFIG = {
  EMBEDDED_API_KEY: 'YOUR_PAID_API_KEY_HERE',
  // ...
};
```

Or set it in `.env.local`:
```
VITE_API_KEY=your_api_key_here
```

### 3. Run in Development Mode
```bash
npm run electron:dev
```

This will start both Vite dev server and Electron app.

---

## 🏗️ Building Desktop App

### Build for Windows (Installer + Portable)
```bash
npm run electron:build:win
```

Output files will be in `release/` folder:
- `VoterAlign Pro-1.0.0-x64.exe` - Windows Installer
- `VoterAlign Pro-Portable-1.0.0.exe` - Portable version (no install needed)

### Build Portable Only
```bash
npm run electron:build:portable
```

---

## 🚀 Deploying to 10 Computers

### Option 1: Portable Version (Recommended)
1. Build the portable `.exe`
2. Copy `VoterAlign Pro-Portable-1.0.0.exe` to a USB drive
3. Copy to each computer's Desktop
4. Double-click to run - no installation needed!

### Option 2: Windows Installer
1. Build the installer `.exe`
2. Run installer on each computer
3. App will be in Start Menu

---

## 👥 User Management

### Default Admin Account
- **Username:** `admin`
- **Password:** `admin` (Change this immediately!)

### Adding Employees
1. Login as admin
2. Click "Users" button in header
3. Add new employees with username/password
4. Employees have limited permissions

### Employee Permissions
| Feature | Admin | Employee |
|---------|-------|----------|
| Import PDF | ✅ | ✅ |
| Export Data | ✅ | ✅ |
| Delete Records | ✅ | ❌ |
| Clear Database | ✅ | ❌ |
| Change API Key | ✅ | ❌ |
| Manage Users | ✅ | ❌ |

---

## 🔑 API Key Management for 10 Computers

### Shared API Key Setup
The API key is embedded in the app. All 10 computers will use the same key.

**Paid Tier Limits (Gemini 2.5 Flash):**
- 2,000 requests/minute total
- 200 requests/minute per computer (safe margin)

### Rate Limiting
The app automatically limits to 15 concurrent requests per machine to prevent hitting API limits.

### Cost Estimation
- ~36 pages = ~₹5-10
- ~300,000 voters = ~₹500-850 total

---

## 📁 Project Structure

```
voter-details/
├── electron/
│   ├── main.js          # Electron main process
│   ├── preload.js       # Bridge between Node and browser
│   ├── splash.html      # Loading screen
│   ├── config.js        # App configuration
│   └── assets/
│       └── icon.svg     # App icon
├── dist/                # Built web app (after npm run build)
├── release/             # Built desktop apps
├── index.tsx            # Main React app
├── index.html           # HTML entry point
├── package.json         # Dependencies & scripts
├── vite.config.ts       # Vite configuration
└── electron-builder.json # Electron builder config
```

---

## 🔧 Troubleshooting

### "API Key not working"
1. Check if key is set in `DESKTOP_CONFIG.EMBEDDED_API_KEY`
2. Make sure it's a PAID tier key for high rate limits
3. Check internet connection

### "Rate limit exceeded (429 error)"
1. Reduce `CONCURRENCY` in config (try 10)
2. Wait a minute and retry
3. Upgrade to higher paid tier

### "App won't start"
1. Make sure Node.js 18+ is installed
2. Run `npm install` again
3. Check if port 3000 is available

### "Build fails"
1. Run `npm run build` first to check for errors
2. Make sure all dependencies are installed
3. Check `electron-builder.json` configuration

---

## 📞 Support

For issues, contact your system administrator.

---

**Version:** 1.0.0  
**Last Updated:** December 2025
