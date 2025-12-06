import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import './src/index.css';
import { 
  Search, Users, User, Home, FileText, BarChart3, PieChart, 
  Download, Upload, Filter, ChevronLeft, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown,
  X, Save, Edit3, Loader2, CheckCircle2, ScanLine, Camera, Wifi, WifiOff,
  MoreHorizontal, Trash2, UserCheck, AlertCircle, RotateCcw, RotateCw, 
  Settings, CheckSquare, Square, Trash, Check, AlertTriangle, File, Clock,
  Moon, Sun, Plus, Info, HardDrive, Database, ShieldCheck, ShieldAlert, FileSpreadsheet,
  Calculator, Languages, Table as TableIcon, Key, RefreshCw, LogOut, UserPlus, Lock,
  Monitor, Cpu
} from 'lucide-react';
import { GoogleGenAI } from "@google/genai";
import Tesseract from 'tesseract.js';
import * as pdfjsLib from 'pdfjs-dist';

// --- CONFIGURATION ---

// DESKTOP APP CONFIG - Embedded API Key for 20 computers
const DESKTOP_CONFIG = {
  // Your PAID Gemini API Key - shared across all employee computers
  EMBEDDED_API_KEY: 'AIzaSyBM_EBIoCLHRpllWDfU6ToxNXHkjy3u-OE', // Replace with your paid key
  
  // ============ SPEED PROFILES FOR 20 DEVICES ============
  // Choose based on how many computers are actively processing at once
  SPEED_PROFILES: {
    // SAFE MODE: When all 20 computers may be processing simultaneously
    safe: {
      CONCURRENCY: 12,        // PAID: 2000 RPM / 20 PCs = 100 RPM each (safe buffer)
      RENDER_CONCURRENCY: 6,
      BATCH_SIZE: 4,
      description: "Safe for 20 simultaneous users"
    },
    // BALANCED MODE: When ~10 computers are actively processing
    balanced: {
      CONCURRENCY: 24,        // PAID: Optimized for ~10 active users (240 RPM total)
      RENDER_CONCURRENCY: 8,
      BATCH_SIZE: 5,
      description: "Balanced speed for ~10 active users"
    },
    // TURBO MODE: When only 1-3 computers are processing (FASTEST)
    turbo: {
      CONCURRENCY: 50,        // PAID: Maximum speed - can handle up to 50 concurrent (3000 RPM)
      RENDER_CONCURRENCY: 12,
      BATCH_SIZE: 8,
      description: "Maximum speed for 1-3 active users"
    }
  },
  
  // Default profile (change this or let users toggle)
  DEFAULT_PROFILE: 'balanced' as 'safe' | 'balanced' | 'turbo',
  
  // Image processing settings for MAXIMUM ACCURACY
  IMAGE_SCALE: 2.5,      // INCREASED for better accuracy
  JPEG_QUALITY: 0.85,    // 85% quality for optimal OCR (matches Python reference)
  
  // AI Model settings
  USE_FLASH_MODEL: true, // gemini-2.5-flash (fastest)
  ENABLE_HYBRID_OCR: false, // Disabled for speed - Gemini 2.5 is accurate enough alone
  
  // Translation settings
  USE_FREE_TRANSLATION: true, // Use free MyMemory API instead of Gemini for translation
  FREE_TRANSLATION_API: 'mymemory', // 'mymemory' | 'libretranslate'
  
  // Employee permissions
  PERMISSIONS: {
    admin: {
      canImportPDF: true,
      canExportData: true,
      canDeleteRecords: true,
      canClearDatabase: true,
      canChangeAPIKey: true,
      canManageUsers: true
    },
    employee: {
      canImportPDF: true,
      canExportData: true,
      canDeleteRecords: false,
      canClearDatabase: false,
      canChangeAPIKey: false,
      canManageUsers: false
    }
  }
};

// Get current speed profile settings
const getSpeedProfile = () => {
  const savedProfile = localStorage.getItem('SPEED_PROFILE') as 'safe' | 'balanced' | 'turbo' | null;
  const profile = savedProfile || DESKTOP_CONFIG.DEFAULT_PROFILE;
  return DESKTOP_CONFIG.SPEED_PROFILES[profile];
};

// FREE Translation API Functions
const translateWithMyMemory = async (text: string, from: string = 'mr', to: string = 'en'): Promise<string> => {
  try {
    const response = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${from}|${to}`);
    const data = await response.json();
    if (data.responseStatus === 200 && data.responseData?.translatedText) {
      return data.responseData.translatedText;
    }
    return text; // Return original if translation fails
  } catch (error) {
    console.error('MyMemory translation error:', error);
    return text;
  }
};

// Batch translate with free API (processes names in chunks to avoid rate limits)
const batchTranslateFree = async (names: string[], onProgress?: (done: number, total: number) => void): Promise<Map<string, string>> => {
  const results = new Map<string, string>();
  const CHUNK_SIZE = 5; // MyMemory allows ~5 requests per second
  
  for (let i = 0; i < names.length; i += CHUNK_SIZE) {
    const chunk = names.slice(i, i + CHUNK_SIZE);
    
    // Process chunk in parallel
    const promises = chunk.map(async (name) => {
      const translated = await translateWithMyMemory(name);
      return { original: name, translated };
    });
    
    const chunkResults = await Promise.all(promises);
    chunkResults.forEach(r => results.set(r.original, r.translated));
    
    if (onProgress) {
      onProgress(Math.min(i + CHUNK_SIZE, names.length), names.length);
    }
    
    // Rate limit: wait 1 second between chunks
    if (i + CHUNK_SIZE < names.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  return results;
};

// Detect if running in Electron
const isElectron = () => {
  return typeof window !== 'undefined' && 
         (window as any).electronAPI !== undefined;
};

// 1. Robust API Key Retrieval (Updated for Desktop)
const getApiKey = () => {
  // Priority 1: Local Storage (Admin Override)
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem('GEMINI_API_KEY');
    if (stored && stored.trim() !== '') return stored.trim();
  }

  // Priority 2: Embedded Desktop Key (for distributed app)
  if (DESKTOP_CONFIG.EMBEDDED_API_KEY) {
    return DESKTOP_CONFIG.EMBEDDED_API_KEY;
  }

  // Priority 3: Vite Environment Variable
  // @ts-ignore
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_KEY) {
    // @ts-ignore
    return import.meta.env.VITE_API_KEY;
  }

  // Priority 4: Process Environment
  if (typeof process !== 'undefined' && process.env && process.env.API_KEY) {
    return process.env.API_KEY;
  }
  return '';
};

// Get user permissions based on role
const getPermissions = (role: 'admin' | 'employee') => {
  return DESKTOP_CONFIG.PERMISSIONS[role] || DESKTOP_CONFIG.PERMISSIONS.employee;
};

// 2. PDF Worker Configuration
const pdfjs: any = (pdfjsLib as any).default || pdfjsLib;
const isElectronEnv = typeof window !== 'undefined' && (window as any).electronAPI !== undefined;
const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.protocol === 'file:');

// Set worker source based on environment
if (isElectronEnv) {
    // Desktop: use CDN (has network)
    pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;
} else {
    // Web: use cdn.jsdelivr.net (more reliable on Vercel)
    pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js`;
}

// --- DATA SIMULATION ---
const CSV_DATA = `Serial No,ID,Name,Relative's Name,House No,Age,Gender,Status
1,WUB3500444,अनमोल विजय राजुरकर,विजय राजुरकर,--,33,पुरुष,
2,WUB8257032,सिद्धार्थ कृष्णाजी मेश्राम,कृष्णाजी मेश्राम,--,19,पुरुष,
3,WUB8290488,हिमांशु कृष्णाजी दाभणे,कृष्णाजी दाभणे,12,18,पुरुष,
4,WUB7919665,निर्मला एकनाथ मोठघरे,एकनाथ मोठघरे,वाडोणा,82,महिला,`;

// --- TYPES ---
interface Voter {
  // Header Data (from page header - same for all voters on page)
  GAT_and_Gan_Details?: string;    // Constituency/Ward: "विधानसभा मतदारसंघ: 175 - पुणे कॅन्टोन्मेंट"
  PartNo?: string;                  // Part Number: "भाग क्रमांक: 45 - कॅम्प, पुणे"
  BootName?: string;                // Polling Station: "जिजामाता प्राथमिक शाळा"
  BoothaAddress?: string;           // Booth Address: "कॅम्प रोड, पुणे - 411001"
  Page_Number?: string;             // Page number (converted from Devanagari)
  ACNo?: string;                    // Assembly Constituency Number
  PartNo_Segment?: string;          // Part/Segment Number
  SerialNoInPart?: string;          // Serial within part
  
  // Voter Data
  serialNo: string;                 // SrNo on page
  id: string;                       // EPIC - Voter ID (e.g., "MH12345678")
  name: string;                     // FullName_M - Marathi name
  nameEn?: string;                  // FullName_E - Transliterated English Name
  relativeName: string;             // RelationName_M - Marathi
  relativeNameEn?: string;          // RelationName_E - English
  relationType?: string;            // Father/Husband/Mother
  houseNo: string;
  age: number;
  gender: string;                   // M or F
  status: string;                   // VoterStatus: ALIVE/DELETED/DUPLICATE
  confidenceScore?: number;         // 0-100% Accuracy score
  sourceImageFile?: string;         // Source PDF page reference
  extractedBy?: string;             // Username of employee who extracted this record
  extractedAt?: string;             // Timestamp of extraction
}

interface UserAccount {
    username: string;
    password: string;
    role: 'admin' | 'employee';
}

type SortKey = keyof Voter;
type SortDirection = 'asc' | 'desc';

interface SortConfig {
  key: SortKey | null;
  direction: SortDirection;
}

interface ExportConfig {
  columns: { key: keyof Voter, label: string, selected: boolean }[];
  scope: 'filtered' | 'all';
  format: 'csv' | 'xls';
}

interface ToastMessage {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
}

interface ImportStats {
  count: number;
  avgConfidence: number;
}

// --- UTILS ---
const parseCSVChunk = (csvText: string, hasHeader: boolean): Voter[] => {
  const lines = csvText.split('\n');
  const voters: Voter[] = [];
  
  // Detect if Marathi Headers exist
  // e.g., "अनु. क्र., ओळखपत्र क्र., मतदार पूर्ण नाव"
  const firstLine = lines[0] || '';
  const isMarathiHeader = firstLine.includes('नाव') || firstLine.includes('वय');
  
  const startIndex = hasHeader ? 1 : 0;
  
  for(let i = startIndex; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const row = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
    // Relaxed length check for different CSV formats
    if(row.length < 4) continue;

    const clean = (str: string) => str ? str.replace(/^"|"$/g, '').trim() : '';

    // Mapping Logic based on header detection or standard index
    let serialNo, id, name, relativeName, houseNo, age, gender, status;

    if (isMarathiHeader && hasHeader) {
        // Assuming a specific order from common Marathi exports or the user's file
        // Common format: Serial, ID, Name, Relative, House, Age, Gender
        serialNo = clean(row[0]);
        id = clean(row[1]);
        name = clean(row[2]);
        relativeName = clean(row[3]);
        houseNo = clean(row[4]);
        age = parseInt(clean(row[5])) || 0;
        gender = clean(row[6]) || 'Unknown';
        status = clean(row[7]) || 'Active';
    } else {
        // Default / English Format
        serialNo = clean(row[0]);
        id = clean(row[1]);
        name = clean(row[2]);
        relativeName = clean(row[3]);
        houseNo = clean(row[4]);
        age = parseInt(clean(row[5])) || 0;
        gender = clean(row[6]) || 'Unknown';
        status = clean(row[7]) || 'Active';
    }
    
    // Auto-map Marathi Gender if needed
    if (gender === 'पुरुष') gender = 'Male';
    if (gender === 'महिला') gender = 'Female';
    if (gender === 'तृतीयपंथी') gender = 'Transgender';

    voters.push({
      serialNo: serialNo || '',
      id: id || '',
      name: name || '',
      nameEn: name || '', // Default to same for CSV import
      relativeName: relativeName || '',
      relativeNameEn: relativeName || '', // Default to same for CSV import
      houseNo: houseNo || '',
      age: age,
      gender: gender,
      status: status,
      confidenceScore: 100 // CSV import assumed accurate
    });
  }
  return voters;
};

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

const getInitials = (name: string) => {
  return (name || 'Unknown')
    .split(' ')
    .map(n => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
};

const getColorFromInitial = (initial: string) => {
  const colors = [
    'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300', 
    'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
    'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
    'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300',
    'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
    'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
    'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
    'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/30 dark:text-fuchsia-300',
    'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300',
    'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300'
  ];
  if (!initial) return colors[0];
  const charCode = initial.charCodeAt(0);
  return colors[charCode % colors.length];
};

const generateCompositeId = (voter: Voter) => `${voter.id}-${voter.serialNo}`;

// --- HELPER: OPTIMIZED CONCURRENCY POOL ---
async function pMap<T, R>(
  array: T[],
  mapper: (item: T, index: number) => Promise<R>,
  { concurrency }: { concurrency: number }
): Promise<R[]> {
  const results = new Array<R>(array.length);
  let index = 0;
  let activeCount = 0;
  
  return new Promise((resolve, reject) => {
    const next = async (): Promise<void> => {
      while (index < array.length && activeCount < concurrency) {
        const currentIndex = index++;
        activeCount++;
        const item = array[currentIndex];
        
        try {
          results[currentIndex] = await mapper(item, currentIndex);
        } catch (err) {
          console.error(`Error processing item ${currentIndex}`, err);
          // Continue despite errors - don't break the whole batch
        } finally {
          activeCount--;
          // Immediately start next item when one finishes
          if (index < array.length) {
            next();
          } else if (activeCount === 0) {
            resolve(results);
          }
        }
      }
    };

    // Start initial batch of workers
    const initialWorkers = Math.min(concurrency, array.length);
    for (let i = 0; i < initialWorkers; i++) {
      next();
    }
    
    // Handle empty array case
    if (array.length === 0) {
      resolve(results);
    }
  });
}

// --- INDEXED DB HELPER (Auto-Backup) ---
const DB_NAME = 'VoterAppDB';
const STORE_NAME = 'voters';
const DB_VERSION = 1;

const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'timestamp' });
      }
    };
  });
};

const saveBackupToDB = async (voters: Voter[]) => {
  try {
    const db = await initDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put({ timestamp: 'latest', data: voters, date: new Date().toISOString() });
    return true;
  } catch (error) {
    console.error("Backup failed", error);
    return false;
  }
};

const clearDB = async () => {
    try {
        const db = await initDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.clear();
        return true;
    } catch (e) {
        console.error("Clear DB failed", e);
        return false;
    }
}

const loadBackupFromDB = async (): Promise<Voter[] | null> => {
  try {
    const db = await initDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get('latest');
    
    return new Promise((resolve) => {
      request.onsuccess = () => {
        if (request.result && request.result.data) {
          resolve(request.result.data);
        } else {
          resolve(null);
        }
      };
      request.onerror = () => resolve(null);
    });
  } catch (e) {
    return null;
  }
};

// --- AUTH HELPERS ---
const getUsers = (): UserAccount[] => {
    if (typeof localStorage === 'undefined') return [];
    try {
        const usersJson = localStorage.getItem('VOTER_APP_USERS');
        if (usersJson) {
            const users = JSON.parse(usersJson);
            // Validate that we have a valid array with at least one admin
            if (Array.isArray(users) && users.length > 0) {
                const hasAdmin = users.some(u => u.role === 'admin');
                if (hasAdmin) {
                    return users;
                }
            }
        }
    } catch (e) {
        console.error('Error parsing users from localStorage:', e);
    }
    // Default Admin if no valid users exist or parsing failed
    const defaultAdmin: UserAccount = { username: 'khadilkar', password: 'Pass@1234', role: 'admin' };
    localStorage.setItem('VOTER_APP_USERS', JSON.stringify([defaultAdmin]));
    return [defaultAdmin];
};

const saveUsers = (users: UserAccount[]) => {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem('VOTER_APP_USERS', JSON.stringify(users));
};

// --- COMPONENTS ---

// 1. LOGIN SCREEN
const LoginScreen = ({ onLogin }: { onLogin: (user: UserAccount) => void }) => {
    const [loginMode, setLoginMode] = useState<'choose' | 'admin' | 'employee'>('choose');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');

    const handleAdminLogin = (e: React.FormEvent) => {
        e.preventDefault();
        const users = getUsers();
        const admins = users.filter(u => u.role === 'admin');
        const user = users.find(u => u.username === username && u.password === password && u.role === 'admin');
        
        if (user) {
            onLogin(user);
        } else if (admins.length === 0) {
            // No admins exist - this shouldn't happen but handle it
            setError('No admin accounts found. Try username: admin, password: admin');
        } else {
            setError('Invalid admin credentials');
        }
    };

    const handleEmployeeLogin = (e: React.FormEvent) => {
        e.preventDefault();
        const users = getUsers();
        const employees = users.filter(u => u.role === 'employee');
        const user = users.find(u => u.username === username && u.password === password && u.role === 'employee');
        
        if (user) {
            onLogin(user);
        } else if (employees.length === 0) {
            setError('No employee accounts exist yet. Admin must create employee accounts first via User Management.');
        } else {
            setError('Invalid employee credentials. Contact admin to get your login.');
        }
    };

    // Choose screen
    if (loginMode === 'choose') {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col justify-center items-center p-4">
                <div className="mb-8 text-center">
                    <div className="bg-gradient-to-br from-indigo-600 to-violet-600 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto shadow-xl shadow-indigo-200 dark:shadow-none mb-4">
                        <FileText className="text-white w-8 h-8" />
                    </div>
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">VoterAlign Pro</h1>
                    <p className="text-slate-500 dark:text-slate-400 mt-2">Election Data Management System</p>
                </div>

                <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-2xl shadow-xl border border-slate-100 dark:border-slate-800 p-8">
                    <h2 className="text-lg font-bold text-slate-800 dark:text-white text-center mb-6">Select Login Type</h2>
                    
                    <div className="space-y-4">
                        <button 
                            onClick={() => { setLoginMode('employee'); setUsername(''); setPassword(''); setError(''); }}
                            className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-lg transition-all flex items-center justify-center gap-3"
                        >
                            <User className="w-5 h-5" />
                            👤 Employee Login
                        </button>
                        
                        <button 
                            onClick={() => { setLoginMode('admin'); setUsername(''); setPassword(''); setError(''); }}
                            className="w-full py-4 bg-slate-600 hover:bg-slate-700 text-white font-bold rounded-xl shadow-lg transition-all flex items-center justify-center gap-3"
                        >
                            <Lock className="w-5 h-5" />
                            🔐 Admin Login
                        </button>
                    </div>
                </div>
                
                <p className="mt-8 text-xs text-slate-400">
                    v1.0.0 • Contact admin for employee credentials
                </p>
            </div>
        );
    }

    // Employee login (with credentials from admin)
    if (loginMode === 'employee') {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col justify-center items-center p-4">
                <div className="mb-8 text-center">
                    <div className="bg-gradient-to-br from-emerald-600 to-teal-600 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto shadow-xl shadow-emerald-200 dark:shadow-none mb-4">
                        <User className="text-white w-8 h-8" />
                    </div>
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">Employee Login</h1>
                    <p className="text-slate-500 dark:text-slate-400 mt-2">Enter credentials provided by admin</p>
                </div>

                <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-2xl shadow-xl border border-slate-100 dark:border-slate-800 p-8">
                    <form onSubmit={handleEmployeeLogin} className="space-y-6">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Username</label>
                            <input 
                                type="text" 
                                required
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none transition-all dark:text-white"
                                placeholder="Enter your username"
                                autoFocus
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Password</label>
                            <input 
                                type="password" 
                                required
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none transition-all dark:text-white"
                                placeholder="Enter your password"
                            />
                        </div>
                        
                        {error && (
                            <div className="p-3 bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 text-sm rounded-lg flex items-center gap-2">
                                <AlertCircle className="w-4 h-4" />
                                {error}
                            </div>
                        )}

                        <button type="submit" className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-lg transition-all">
                            ✅ Login
                        </button>
                    </form>
                    
                    <button 
                        onClick={() => { setLoginMode('choose'); setError(''); }}
                        className="w-full mt-4 py-2 text-slate-500 hover:text-slate-700 text-sm"
                    >
                        ← Back to Login Options
                    </button>
                </div>
                
                <p className="mt-8 text-xs text-slate-400">
                    Don't have credentials? Contact your admin.
                </p>
            </div>
        );
    }

    // Admin login (with password)
    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col justify-center items-center p-4">
            <div className="mb-8 text-center">
                <div className="bg-gradient-to-br from-indigo-600 to-violet-600 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto shadow-xl shadow-indigo-200 dark:shadow-none mb-4">
                    <Lock className="text-white w-8 h-8" />
                </div>
                <h1 className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">Admin Login</h1>
                <p className="text-slate-500 dark:text-slate-400 mt-2">Enter admin credentials</p>
            </div>

            <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-2xl shadow-xl border border-slate-100 dark:border-slate-800 p-8">
                <form onSubmit={handleAdminLogin} className="space-y-6">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Username</label>
                        <input 
                            type="text" 
                            required
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all dark:text-white"
                            placeholder="Enter username"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Password</label>
                        <input 
                            type="password" 
                            required
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all dark:text-white"
                            placeholder="Enter password"
                        />
                    </div>
                    
                    {error && (
                        <div className="p-3 bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 text-sm rounded-lg flex items-center gap-2">
                            <AlertCircle className="w-4 h-4" />
                            {error}
                        </div>
                    )}

                    <button type="submit" className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-lg transition-all">
                        🔐 Admin Sign In
                    </button>
                </form>
                
                <button 
                    onClick={() => { setLoginMode('choose'); setError(''); }}
                    className="w-full mt-4 py-2 text-slate-500 hover:text-slate-700 text-sm"
                >
                    ← Back to Login Options
                </button>
            </div>
            
            <p className="mt-8 text-xs text-slate-400">
                Contact admin for credentials
            </p>
        </div>
    );
};

// 2. USER MANAGEMENT MODAL (ADMIN ONLY) - Manage employees with credentials
const UserManagementModal = ({ onClose }: { onClose: () => void }) => {
    const [users, setUsers] = useState<UserAccount[]>(getUsers());
    const [newUsername, setNewUsername] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [error, setError] = useState('');
    const [changingPasswordFor, setChangingPasswordFor] = useState<string | null>(null);
    const [newAdminPassword, setNewAdminPassword] = useState('');
    const [passwordSuccess, setPasswordSuccess] = useState('');

    const handleAddUser = (e: React.FormEvent) => {
        e.preventDefault();
        if(!newUsername || !newPassword) {
            setError('Please enter both username and password');
            return;
        }
        
        if(newUsername.length < 2) {
            setError('Username must be at least 2 characters');
            return;
        }
        
        if(newPassword.length < 3) {
            setError('Password must be at least 3 characters');
            return;
        }
        
        if(users.some(u => u.username.toLowerCase() === newUsername.toLowerCase())) {
            setError("Username already exists");
            return;
        }

        const newUser: UserAccount = { username: newUsername, password: newPassword, role: 'employee' };
        const updatedUsers = [...users, newUser];
        setUsers(updatedUsers);
        saveUsers(updatedUsers);
        setNewUsername('');
        setNewPassword('');
        setError('');
        setPasswordSuccess(`Employee "${newUsername}" added successfully!`);
        setTimeout(() => setPasswordSuccess(''), 3000);
    };

    const handleDeleteUser = (username: string) => {
        if(username === 'admin') {
            alert("Cannot delete main admin");
            return;
        }
        if(confirm(`Remove user ${username}?`)) {
            const updatedUsers = users.filter(u => u.username !== username);
            setUsers(updatedUsers);
            saveUsers(updatedUsers);
        }
    };

    const handleChangePassword = (username: string) => {
        if (!newAdminPassword || newAdminPassword.length < 3) {
            setError('Password must be at least 3 characters');
            return;
        }
        const updatedUsers = users.map(u => 
            u.username === username ? { ...u, password: newAdminPassword } : u
        );
        setUsers(updatedUsers);
        saveUsers(updatedUsers);
        setChangingPasswordFor(null);
        setNewAdminPassword('');
        setError('');
        setPasswordSuccess(`Password changed for ${username}!`);
        setTimeout(() => setPasswordSuccess(''), 3000);
    };

    return (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg p-6 border border-slate-100 dark:border-slate-800 max-h-[90vh] overflow-y-auto">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
                        <Users className="w-5 h-5 text-indigo-600" />
                        User Management
                    </h2>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close"><X className="w-5 h-5" /></button>
                </div>

                {/* Success Message */}
                {passwordSuccess && (
                    <div className="mb-4 p-3 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 text-sm rounded-lg flex items-center gap-2">
                        ✅ {passwordSuccess}
                    </div>
                )}

                {/* Admin Users Section */}
                <div className="mb-6">
                    <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Admin Accounts</h3>
                    <div className="space-y-2">
                        {users.filter(u => u.role === 'admin').map((user, idx) => (
                            <div key={idx} className="p-3 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800 rounded-xl">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-indigo-200 dark:bg-indigo-800 flex items-center justify-center text-xs font-bold text-indigo-700 dark:text-indigo-300">
                                            {user.username.slice(0,2).toUpperCase()}
                                        </div>
                                        <div>
                                            <p className="text-sm font-medium text-slate-800 dark:text-white">{user.username}</p>
                                            <p className="text-xs text-indigo-600 dark:text-indigo-400">🔐 Admin</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button 
                                            onClick={() => {
                                                setChangingPasswordFor(changingPasswordFor === user.username ? null : user.username);
                                                setNewAdminPassword('');
                                                setError('');
                                            }}
                                            className="px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 rounded-lg transition-colors"
                                        >
                                            {changingPasswordFor === user.username ? '✕ Cancel' : '🔑 Change Password'}
                                        </button>
                                        {user.username !== 'admin' && (
                                            <button 
                                                onClick={() => handleDeleteUser(user.username)}
                                                className="p-1 text-rose-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded transition-colors"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        )}
                                    </div>
                                </div>
                                {changingPasswordFor === user.username && (
                                    <div className="mt-3 pt-3 border-t border-indigo-200 dark:border-indigo-700">
                                        <div className="flex gap-2">
                                            <input 
                                                type="text" 
                                                placeholder="Enter new password" 
                                                value={newAdminPassword}
                                                onChange={(e) => setNewAdminPassword(e.target.value)}
                                                className="flex-1 px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
                                                autoFocus
                                            />
                                            <button 
                                                onClick={() => handleChangePassword(user.username)}
                                                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
                                            >
                                                Save
                                            </button>
                                        </div>
                                        {error && <p className="text-xs text-rose-500 mt-2">{error}</p>}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Registered Employees Section */}
                <div className="mb-6">
                    <h3 className="text-xs font-bold text-emerald-600 uppercase tracking-widest mb-3 flex items-center gap-2">
                        👥 Registered Employees ({users.filter(u => u.role === 'employee').length})
                    </h3>
                    {users.filter(u => u.role === 'employee').length === 0 ? (
                        <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-xl text-center text-slate-500 dark:text-slate-400 text-sm">
                            No employees registered yet. Add employees below.
                        </div>
                    ) : (
                        <div className="space-y-2 max-h-40 overflow-y-auto">
                            {users.filter(u => u.role === 'employee').map((user, idx) => (
                                <div key={idx} className="flex items-center justify-between p-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800 rounded-xl">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-emerald-200 dark:bg-emerald-800 flex items-center justify-center text-xs font-bold text-emerald-700 dark:text-emerald-300">
                                            {user.username.slice(0,2).toUpperCase()}
                                        </div>
                                        <div>
                                            <p className="text-sm font-medium text-slate-800 dark:text-white">{user.username}</p>
                                            <p className="text-xs text-emerald-600 dark:text-emerald-400">👤 Employee</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button 
                                            onClick={() => {
                                                setChangingPasswordFor(changingPasswordFor === user.username ? null : user.username);
                                                setNewAdminPassword('');
                                                setError('');
                                            }}
                                            className="px-2 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 rounded-lg transition-colors"
                                        >
                                            {changingPasswordFor === user.username ? '✕ Cancel' : '🔑 Password'}
                                        </button>
                                        <button 
                                            onClick={() => handleDeleteUser(user.username)}
                                            className="p-1 text-rose-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded transition-colors"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Add New Employee Form */}
                <form onSubmit={handleAddUser} className="bg-emerald-50 dark:bg-emerald-900/20 p-4 rounded-xl border border-emerald-200 dark:border-emerald-800">
                    <h3 className="text-xs font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-widest mb-3">➕ Add New Employee</h3>
                    <div className="flex gap-3 mb-3">
                        <input 
                            type="text" 
                            placeholder="Username (e.g., ramesh)" 
                            value={newUsername}
                            onChange={(e) => setNewUsername(e.target.value)}
                            className="flex-1 px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 dark:text-white"
                        />
                        <input 
                            type="text" 
                            placeholder="Password" 
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            className="flex-1 px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 dark:text-white"
                        />
                    </div>
                    {error && <p className="text-xs text-rose-500 mb-2">{error}</p>}
                    <button type="submit" className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2">
                        <UserPlus className="w-4 h-4" /> Add Employee
                    </button>
                    <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-2 text-center">
                        Share these credentials with the employee
                    </p>
                </form>
            </div>
        </div>
    )
}

const ApiKeyModal = ({ onClose, onSave }: { onClose: () => void, onSave: (key: string) => void }) => {
  const [key, setKey] = useState(() => {
      if (typeof localStorage !== 'undefined') {
          return localStorage.getItem('GEMINI_API_KEY') || '';
      }
      return '';
  });

  const handleSave = () => {
    onSave(key);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-in fade-in duration-200" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md p-6 border border-slate-100 dark:border-slate-800">
        <div className="flex justify-between items-center mb-4">
            <h2 id="modal-title" className="text-xl font-bold text-slate-800 dark:text-slate-100">API Configuration</h2>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
          Enter your personal Google Gemini API Key to enable high-speed processing. This key is stored locally in your browser.
        </p>
        <div className="space-y-4">
            <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">API Key</label>
                <input
                  type="password"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="Paste your key here (starts with AIza...)"
                  className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all dark:text-white font-mono text-sm"
                />
            </div>
            <div className="bg-amber-50 dark:bg-amber-900/20 p-3 rounded-lg border border-amber-100 dark:border-amber-800">
                <p className="text-xs text-amber-700 dark:text-amber-400 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                    <span>Paid tier keys (Pay-as-you-go) are recommended for 10x speed (higher RPM limits).</span>
                </p>
            </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button onClick={() => { setKey(''); onSave(''); onClose(); }} className="px-4 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded-lg transition-colors mr-auto">Clear Key</button>
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors">Cancel</button>
          <button onClick={handleSave} className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-lg shadow-indigo-200 dark:shadow-none hover:shadow-indigo-300 transition-all">Save Configuration</button>
        </div>
      </div>
    </div>
  );
};

const Avatar = ({ name }: { name: string }) => {
  const initials = getInitials(name);
  const colorClass = getColorFromInitial(initials[0]);
  
  return (
    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${colorClass} ring-2 ring-white dark:ring-slate-700 shadow-sm flex-shrink-0`}>
      {initials}
    </div>
  );
};

const Badge = ({ children, variant }: { children: React.ReactNode, variant: 'success' | 'danger' | 'neutral' | 'blue' | 'purple' | 'amber' }) => {
  const styles = {
    success: 'bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-800',
    danger: 'bg-rose-50 text-rose-700 border-rose-100 dark:bg-rose-900/20 dark:text-rose-300 dark:border-rose-800',
    neutral: 'bg-slate-50 text-slate-600 border-slate-100 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
    blue: 'bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800',
    purple: 'bg-purple-50 text-purple-700 border-purple-100 dark:bg-purple-900/20 dark:text-purple-300 dark:border-purple-800',
    amber: 'bg-amber-50 text-amber-700 border-amber-100 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800'
  };
  
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${styles[variant]}`}>
      {children}
    </span>
  );
};

const StatCard = ({ title, value, icon, subLabel, trend }: { title: string, value: string | number, icon: React.ReactNode, subLabel?: string, trend?: 'up' | 'down' | 'neutral' }) => (
  <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] dark:shadow-none border border-slate-100 dark:border-slate-800 flex items-start justify-between hover:shadow-lg dark:hover:border-slate-700 transition-all duration-300 group">
    <div>
      <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1">{title}</p>
      <h3 className="text-3xl font-bold text-slate-800 dark:text-slate-100 tracking-tight flex items-end gap-2">
        {value}
        {trend && (
           <span className={`text-xs px-1.5 py-0.5 rounded mb-1.5 ${trend === 'up' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'}`}>
             {trend === 'up' ? 'High' : 'Low'}
           </span>
        )}
      </h3>
      {subLabel && <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{subLabel}</p>}
    </div>
    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 group-hover:bg-indigo-50 dark:group-hover:bg-indigo-900/30 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
      {icon}
    </div>
  </div>
);

const Toast = ({ message, type, onClose }: { message: string, type: 'success' | 'error' | 'info', onClose: () => void }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className={`fixed bottom-6 right-6 flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg border animate-in slide-in-from-right-10 fade-in duration-300 z-50 ${type === 'success' ? 'bg-white dark:bg-slate-800 border-emerald-100 dark:border-emerald-900 text-emerald-800 dark:text-emerald-400' : type === 'error' ? 'bg-white dark:bg-slate-800 border-rose-100 dark:border-rose-900 text-rose-800 dark:text-rose-400' : 'bg-white dark:bg-slate-800 border-blue-100 dark:border-blue-900 text-blue-800 dark:text-blue-400'}`}>
      <div className={`p-1 rounded-full ${type === 'success' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400' : type === 'error' ? 'bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400' : 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'}`}>
        {type === 'success' ? <Check className="w-4 h-4" /> : type === 'error' ? <AlertCircle className="w-4 h-4" /> : <Info className="w-4 h-4" />}
      </div>
      <p className="text-sm font-medium">{message}</p>
      <button onClick={onClose} className="ml-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" aria-label="Close notification">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

const UploadProgressModal = ({ 
    progress, 
    totalVoters, 
    isComplete, 
    onClose, 
    title = "Processing File", 
    fileName, 
    detail, 
    eta,
    batchAccuracy 
}: { 
    progress: number, 
    totalVoters: number, 
    isComplete: boolean, 
    onClose: () => void, 
    title?: string, 
    fileName?: string, 
    detail?: string, 
    eta?: string,
    batchAccuracy?: number
}) => {
  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-sm p-8 flex flex-col items-center text-center animate-in fade-in zoom-in duration-300 border border-white/20 dark:border-slate-700">
        {!isComplete ? (
          <>
            <div className="relative mb-6">
               <div className="w-20 h-20 border-4 border-slate-100 dark:border-slate-800 border-t-indigo-600 rounded-full animate-spin"></div>
               <div className="absolute inset-0 flex items-center justify-center text-sm font-bold text-indigo-600 dark:text-indigo-400">
                 {Math.round(progress)}%
               </div>
            </div>
            <h2 id="modal-title" className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-2">{title}</h2>
             {fileName && <p className="text-xs font-mono text-slate-400 mb-2 bg-slate-50 dark:bg-slate-800 px-2 py-1 rounded border border-slate-100 dark:border-slate-700 max-w-full truncate">{fileName}</p>}
            <p className="text-slate-500 dark:text-slate-400 text-sm mb-2 leading-relaxed h-10 flex items-center justify-center">
              {detail || "Initializing..."}
            </p>
            {eta && (
              <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-4 bg-slate-50 dark:bg-slate-800 px-2 py-1 rounded-full">
                <Clock className="w-3 h-3" />
                <span>Est. time: {eta}</span>
              </div>
            )}
            <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Processing progress" title={`${progress}% complete`}>
              <div 
                className="bg-indigo-600 h-full rounded-full transition-all duration-300 ease-out" 
                style={{ width: `${progress}%` }}
              ></div>
            </div>
          </>
        ) : (
          <>
            <div className="w-20 h-20 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-500 rounded-full flex items-center justify-center mb-6 ring-8 ring-emerald-50/50 dark:ring-emerald-900/10">
              <CheckCircle2 className="w-10 h-10" />
            </div>
            <h2 id="modal-title" className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-2">Extraction Complete!</h2>
            
            <div className="grid grid-cols-2 gap-4 w-full mb-6">
                <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700">
                   <p className="text-xs text-slate-400 uppercase tracking-wide font-bold mb-1">Records</p>
                   <p className="text-xl font-bold text-slate-800 dark:text-slate-200">{totalVoters.toLocaleString()}</p>
                </div>
                <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700">
                   <p className="text-xs text-slate-400 uppercase tracking-wide font-bold mb-1">Accuracy</p>
                   <p className={`text-xl font-bold ${batchAccuracy && batchAccuracy > 80 ? 'text-emerald-600' : 'text-amber-500'}`}>
                     {batchAccuracy ? `${batchAccuracy}%` : 'N/A'}
                   </p>
                </div>
            </div>

            <button 
              onClick={onClose}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium transition-all shadow-lg shadow-indigo-200 dark:shadow-none hover:shadow-indigo-300 active:scale-95 focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            >
              View Data
            </button>
          </>
        )}
      </div>
    </div>
  );
};

const VoterFormModal = ({ voter, mode = 'edit', onClose, onSave }: { voter?: Voter, mode?: 'create' | 'edit', onClose: () => void, onSave: (voter: Voter) => void }) => {
  const initialData: Voter = voter || {
    serialNo: '',
    id: '',
    name: '',
    nameEn: '',
    relativeName: '',
    relativeNameEn: '',
    houseNo: '',
    age: 18,
    gender: 'Male',
    status: 'Active',
    confidenceScore: 100
  };

  const [formData, setFormData] = useState<Voter>(initialData);
  const [errors, setErrors] = useState<Partial<Record<keyof Voter, string>>>({});
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);

  useEffect(() => {
    // Check for changes
    if (mode === 'edit' && voter) {
      const isChanged = JSON.stringify(formData) !== JSON.stringify(voter);
      setHasUnsavedChanges(isChanged);
    } else if (mode === 'create') {
      const isChanged = JSON.stringify(formData) !== JSON.stringify(initialData);
      setHasUnsavedChanges(isChanged);
    }
  }, [formData, voter, mode]);

  const validate = () => {
    const newErrors: Partial<Record<keyof Voter, string>> = {};
    if (!formData.name.trim()) newErrors.name = "Name is required";
    if (!formData.id.trim()) newErrors.id = "Voter ID is required";
    if (isNaN(formData.age) || formData.age < 18 || formData.age > 120) newErrors.age = "Age must be 18-120";
    if (!formData.houseNo.trim()) newErrors.houseNo = "House No required";
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: name === 'age' ? (parseInt(value) || 0) : value
    }));
    if (errors[name as keyof Voter]) {
      setErrors(prev => ({ ...prev, [name]: undefined }));
    }
  };

  const handleTranslate = async (field: 'name' | 'relativeName') => {
    const textToTranslate = field === 'name' ? formData.name : formData.relativeName;
    if (!textToTranslate) return;
    
    setIsTranslating(true);
    try {
        const apiKey = getApiKey();
        if(!apiKey) throw new Error("No API Key");
        
        const ai = new GoogleGenAI({ apiKey });
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: `Transliterate this Marathi name to English: "${textToTranslate}". Return ONLY the English name, nothing else.`
        });
        const translated = response.text?.trim() || "";
        setFormData(prev => ({
            ...prev,
            [field === 'name' ? 'nameEn' : 'relativeNameEn']: translated
        }));
    } catch (e) {
        console.error("Translation failed", e);
    } finally {
        setIsTranslating(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validate()) {
      onSave({ ...formData, confidenceScore: 100 }); // Manual edit assumes 100% confidence
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-in fade-in duration-200" role="dialog" aria-modal="true">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto flex flex-col border border-slate-100 dark:border-slate-800">
        <div className="px-8 py-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between sticky top-0 z-10 bg-white dark:bg-slate-900">
          <div>
            <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <div className="p-2 bg-indigo-50 dark:bg-indigo-900/30 rounded-lg text-indigo-600 dark:text-indigo-400">
                {mode === 'create' ? <Plus className="w-5 h-5" /> : <UserCheck className="w-5 h-5" />}
              </div>
              {mode === 'create' ? 'Register New Voter' : 'Edit Voter Record'}
            </h2>
            {mode === 'create' && <p className="text-sm text-slate-500 mt-1">Manually add a voter to the list.</p>}
          </div>
          <button onClick={onClose} aria-label="Close modal" className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <X className="w-6 h-6" />
          </button>
        </div>
        
        <div className="p-8">
          <form id="voterForm" onSubmit={handleSubmit} className="space-y-8">
            {/* Identity Section */}
            <section>
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                Identity Details
                <div className="h-px bg-slate-100 dark:bg-slate-800 flex-1"></div>
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                 <div className="group">
                  <label htmlFor="name" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Full Name (Original) <span className="text-red-500">*</span></label>
                  <input type="text" id="name" name="name" value={formData.name} onChange={handleChange} placeholder="e.g. अनमोल विजय राजुरकर" className={`w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all dark:text-white ${errors.name ? 'border-red-300 bg-red-50 dark:bg-red-900/10' : 'border-slate-200 dark:border-slate-700'}`} />
                  {errors.name && <p className="text-xs text-red-500 mt-1 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {errors.name}</p>}
                </div>
                 <div className="group">
                  <label htmlFor="nameEn" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5 flex justify-between">
                      Full Name (English)
                      <button type="button" onClick={() => handleTranslate('name')} disabled={isTranslating} className="text-xs text-indigo-600 hover:text-indigo-700 flex items-center gap-1 disabled:opacity-50">
                          {isTranslating ? <Loader2 className="w-3 h-3 animate-spin" /> : "Auto-Translate"}
                      </button>
                  </label>
                  <input type="text" id="nameEn" name="nameEn" value={formData.nameEn || ''} onChange={handleChange} placeholder="e.g. Anmol Vijay Rajurkar" className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all dark:text-white" />
                </div>
                <div className="group">
                  <label htmlFor="id" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Voter ID (EPIC) <span className="text-red-500">*</span></label>
                  <input type="text" id="id" name="id" value={formData.id} onChange={handleChange} placeholder="e.g. WUB3500444" className={`w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all font-mono text-sm dark:text-white ${errors.id ? 'border-red-300 bg-red-50 dark:bg-red-900/10' : 'border-slate-200 dark:border-slate-700'}`} />
                  {errors.id && <p className="text-xs text-red-500 mt-1 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {errors.id}</p>}
                </div>
              </div>
            </section>

            {/* Demographics Section */}
            <section>
               <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                Demographics
                <div className="h-px bg-slate-100 dark:bg-slate-800 flex-1"></div>
              </h3>
               <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="group">
                    <label htmlFor="age" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Age <span className="text-red-500">*</span></label>
                    <input type="number" id="age" name="age" value={formData.age} onChange={handleChange} className={`w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all dark:text-white ${errors.age ? 'border-red-300 bg-red-50 dark:bg-red-900/10' : 'border-slate-200 dark:border-slate-700'}`} />
                    {errors.age && <p className="text-xs text-red-500 mt-1 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {errors.age}</p>}
                  </div>
                  <div className="group">
                    <label htmlFor="gender" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Gender</label>
                    <div className="relative">
                      <select id="gender" name="gender" value={formData.gender} onChange={handleChange} className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all appearance-none dark:text-white">
                        <option value="Male">Male</option>
                        <option value="Female">Female</option>
                        <option value="पुरुष">पुरुष</option>
                        <option value="महिला">महिला</option>
                        <option value="Other">Other</option>
                      </select>
                      <ChevronDownIcon className="absolute right-4 top-3.5 w-4 h-4 text-slate-400 pointer-events-none" />
                    </div>
                  </div>
               </div>
            </section>

            {/* Address Section */}
            <section>
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                Address & Reference
                <div className="h-px bg-slate-100 dark:bg-slate-800 flex-1"></div>
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="group">
                  <label htmlFor="relativeName" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Relative's Name (Original)</label>
                  <input type="text" id="relativeName" name="relativeName" value={formData.relativeName} onChange={handleChange} className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all dark:text-white" />
                </div>
                 <div className="group">
                  <label htmlFor="relativeNameEn" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5 flex justify-between">
                      Relative's Name (English)
                      <button type="button" onClick={() => handleTranslate('relativeName')} disabled={isTranslating} className="text-xs text-indigo-600 hover:text-indigo-700 flex items-center gap-1 disabled:opacity-50">
                          {isTranslating ? <Loader2 className="w-3 h-3 animate-spin" /> : "Auto-Translate"}
                      </button>
                  </label>
                  <input type="text" id="relativeNameEn" name="relativeNameEn" value={formData.relativeNameEn || ''} onChange={handleChange} className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all dark:text-white" />
                </div>
                <div className="group">
                  <label htmlFor="houseNo" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">House Number <span className="text-red-500">*</span></label>
                  <input type="text" id="houseNo" name="houseNo" value={formData.houseNo} onChange={handleChange} className={`w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all dark:text-white ${errors.houseNo ? 'border-red-300 bg-red-50 dark:bg-red-900/10' : 'border-slate-200 dark:border-slate-700'}`} />
                  {errors.houseNo && <p className="text-xs text-red-500 mt-1 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {errors.houseNo}</p>}
                </div>
              </div>
            </section>

            {/* Admin Section */}
            <section>
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                Administrative
                <div className="h-px bg-slate-100 dark:bg-slate-800 flex-1"></div>
              </h3>
              <div className="grid grid-cols-2 gap-6">
                <div className="group">
                   <label htmlFor="serialNo" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Serial No</label>
                   <input type="text" id="serialNo" name="serialNo" value={formData.serialNo} onChange={handleChange} className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all dark:text-white" />
                </div>
                <div className="group">
                   <label htmlFor="status" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Status</label>
                   <div className="relative">
                      <select id="status" name="status" value={formData.status} onChange={handleChange} className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all appearance-none dark:text-white">
                        <option value="Active">Active</option>
                        <option value="DELETED">Deleted</option>
                      </select>
                      <ChevronDownIcon className="absolute right-4 top-3.5 w-4 h-4 text-slate-400 pointer-events-none" />
                   </div>
                </div>
              </div>
            </section>
          </form>
        </div>

        <div className="px-8 py-5 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex items-center justify-between gap-3 rounded-b-2xl backdrop-blur-sm">
          <div className="text-sm text-slate-500 dark:text-slate-400">
             {hasUnsavedChanges && <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400"><AlertCircle className="w-3 h-3"/> Unsaved changes</span>}
          </div>
          <div className="flex gap-3">
             <button type="button" onClick={onClose} className="px-6 py-2.5 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all focus:ring-2 focus:ring-slate-200">Cancel</button>
             <button type="submit" form="voterForm" className={`px-6 py-2.5 text-sm font-medium text-white rounded-xl shadow-lg transition-all flex items-center gap-2 focus:ring-2 focus:ring-offset-2 ${hasUnsavedChanges ? 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200 dark:shadow-none ring-indigo-500' : 'bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 dark:hover:bg-slate-600'}`}>
               <Save className="w-4 h-4" />
               {mode === 'create' ? 'Save New Voter' : 'Save Changes'}
             </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const ExportModal = ({ onClose, onExport, onClear, isAdmin = false, myRecordsCount = 0 }: { onClose: () => void, onExport: (config: ExportConfig) => void, onClear: () => void, isAdmin?: boolean, myRecordsCount?: number }) => {
  const [columns, setColumns] = useState<{ key: keyof Voter, label: string, selected: boolean }[]>([
    // Header columns (from page header)
    { key: 'GAT_and_Gan_Details', label: 'GAT_and_Gan_Details', selected: true },
    { key: 'PartNo', label: 'PartNo', selected: true },
    { key: 'BootName', label: 'BootName', selected: true },
    { key: 'BoothaAddress', label: 'BoothaAddress', selected: true },
    { key: 'confidenceScore', label: 'Accuracy_Percent', selected: true },
    { key: 'status', label: 'VoterStatus', selected: true },
    { key: 'ACNo', label: 'ACNo', selected: true },
    { key: 'PartNo_Segment', label: 'PartNo_Segment', selected: true },
    { key: 'SerialNoInPart', label: 'SerialNoInPart', selected: true },
    { key: 'Page_Number', label: 'Page_Number', selected: true },
    { key: 'serialNo', label: 'SrNo', selected: true },
    { key: 'id', label: 'EPIC', selected: true },
    { key: 'name', label: 'FullName_M', selected: true },
    { key: 'nameEn', label: 'FullName_E', selected: true },
    { key: 'relationType', label: 'RelationType', selected: true },
    { key: 'relativeName', label: 'RelationName_M', selected: true },
    { key: 'relativeNameEn', label: 'RelationName_E', selected: true },
    { key: 'houseNo', label: 'HouseNo', selected: true },
    { key: 'age', label: 'Age', selected: true },
    { key: 'gender', label: 'Sex', selected: true },
    { key: 'sourceImageFile', label: 'Source_Image_File', selected: true },
  ]);
  const [scope, setScope] = useState<'filtered' | 'all'>('filtered');
  const [format, setFormat] = useState<'csv' | 'xls'>('csv');

  const toggleColumn = (idx: number) => {
    const newCols = [...columns];
    newCols[idx].selected = !newCols[idx].selected;
    setColumns(newCols);
  };

  const handleClear = () => {
      const confirmMsg = isAdmin 
        ? "⚠️ DANGER: This will permanently delete ALL data from ALL users. Continue?"
        : `🗑️ Clear your ${myRecordsCount} extracted records to start a fresh batch?`;
      if(confirm(confirmMsg)) {
          onClear();
          onClose();
      }
  }

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-in fade-in duration-200" role="dialog" aria-modal="true" aria-labelledby="export-title">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md p-6 border border-slate-100 dark:border-slate-800">
        <div className="flex justify-between items-center mb-6">
          <h2 id="export-title" className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <Download className="w-5 h-5 text-indigo-600" />
            Export Data
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors text-slate-400 dark:text-slate-500" aria-label="Close modal"><X className="w-5 h-5"/></button>
        </div>

        <div className="space-y-6">
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3 block">Export Format</label>
            <div className="flex gap-4 p-1 bg-slate-50 dark:bg-slate-800 rounded-lg">
                <button 
                  onClick={() => setFormat('csv')} 
                  className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-all ${format === 'csv' ? 'bg-white dark:bg-slate-700 shadow text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700'}`}
                >
                  <FileSpreadsheet className="w-4 h-4" /> CSV
                </button>
                <button 
                  onClick={() => setFormat('xls')} 
                  className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-all ${format === 'xls' ? 'bg-white dark:bg-slate-700 shadow text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700'}`}
                >
                  <TableIcon className="w-4 h-4" /> Excel (.xls)
                </button>
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3 block">Export Scope</label>
            <div className="flex gap-4">
               <label className="flex items-center gap-2 cursor-pointer">
                 <input type="radio" name="scope" className="w-4 h-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 dark:bg-slate-800 dark:border-slate-700" checked={scope === 'filtered'} onChange={() => setScope('filtered')} />
                 <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Filtered View</span>
               </label>
               <label className="flex items-center gap-2 cursor-pointer">
                 <input type="radio" name="scope" className="w-4 h-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 dark:bg-slate-800 dark:border-slate-700" checked={scope === 'all'} onChange={() => setScope('all')} />
                 <span className="text-sm font-medium text-slate-700 dark:text-slate-300">All Records</span>
               </label>
            </div>
          </div>

          <div>
             <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3 block">Columns to Export</label>
             <div className="grid grid-cols-2 gap-3 max-h-48 overflow-y-auto pr-1">
               {columns.map((col, idx) => (
                 <label key={col.key} className="flex items-center gap-2 cursor-pointer group">
                   <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${col.selected ? 'bg-indigo-600 border-indigo-600' : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 group-hover:border-indigo-400'}`}>
                     {col.selected && <Check className="w-3.5 h-3.5 text-white" />}
                   </div>
                   <input type="checkbox" className="hidden" checked={col.selected} onChange={() => toggleColumn(idx)} />
                   <span className="text-sm text-slate-600 dark:text-slate-300">{col.label}</span>
                 </label>
               ))}
             </div>
          </div>
        </div>

        <div className="mt-8 pt-4 border-t border-slate-100 dark:border-slate-800 flex justify-between gap-3">
          {isAdmin ? (
            <button onClick={handleClear} className="px-4 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded-lg transition-colors flex items-center gap-2">
                <Trash2 className="w-4 h-4" /> Clear All Data
            </button>
          ) : myRecordsCount > 0 ? (
            <button onClick={handleClear} className="px-4 py-2 text-sm font-medium text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded-lg transition-colors flex items-center gap-2">
                <Trash2 className="w-4 h-4" /> Clear My Data ({myRecordsCount})
            </button>
          ) : (
            <div className="px-4 py-2 text-xs text-slate-400 flex items-center gap-2">
              <Info className="w-3 h-3" /> No records to clear
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg transition-colors">Cancel</button>
            <button onClick={() => onExport({ columns: columns.filter(c => c.selected), scope, format })} className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-lg shadow-indigo-200 dark:shadow-none hover:shadow-indigo-300 transition-all flex items-center gap-2">
                <Download className="w-4 h-4" />
                Export
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Simple Chevron Icon for Selects
const ChevronDownIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="m6 9 6 6 6-6"/></svg>
);

const Dashboard = ({ user, onLogout }: { user: UserAccount, onLogout: () => void }) => {
  // Use state to track API key so UI updates when changed
  const [apiKey, setApiKey] = useState(() => getApiKey());
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [showUserModal, setShowUserModal] = useState(false);
  
  // Speed Profile State
  const [speedProfile, setSpeedProfile] = useState<'safe' | 'balanced' | 'turbo'>(() => {
    return (localStorage.getItem('SPEED_PROFILE') as 'safe' | 'balanced' | 'turbo') || DESKTOP_CONFIG.DEFAULT_PROFILE;
  });
  
  const changeSpeedProfile = (profile: 'safe' | 'balanced' | 'turbo') => {
    localStorage.setItem('SPEED_PROFILE', profile);
    setSpeedProfile(profile);
    const profileData = DESKTOP_CONFIG.SPEED_PROFILES[profile];
    addToast(`⚡ Speed: ${profile.toUpperCase()} - ${profileData.description}`, 'info');
  };

  const handleSaveApiKey = (newKey: string) => {
    if (newKey) {
        localStorage.setItem('GEMINI_API_KEY', newKey);
    } else {
        localStorage.removeItem('GEMINI_API_KEY');
    }
    setApiKey(getApiKey()); // Re-evaluate to fallback to env if cleared
    addToast("API Key configuration updated!", "success");
  };
  
  // --- STATE ---
  // Dark Mode
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('darkMode')) {
      return localStorage.getItem('darkMode') === 'true';
    }
    if (typeof window !== 'undefined') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('darkMode', String(isDarkMode));
  }, [isDarkMode]);

  // Undo/Redo System
  const initialVoters = useMemo(() => parseCSVChunk(CSV_DATA, true), []);
  const [history, setHistory] = useState<Voter[][]>([initialVoters]);
  const [historyIndex, setHistoryIndex] = useState(0);
  // Derived state for current view (GUARDED)
  const allVoters = history[historyIndex] || [];
  // File Handle for Live Save
  const [fileHandle, setFileHandle] = useState<any>(null); // FileSystemFileHandle
  const [isLiveSaveActive, setIsLiveSaveActive] = useState(false);

  // Initialize DB on Load
  useEffect(() => {
    const loadData = async () => {
       const savedVoters = await loadBackupFromDB();
       if (savedVoters && savedVoters.length > initialVoters.length) {
         setHistory([savedVoters]);
         setHistoryIndex(0);
         addToast(`Restored ${savedVoters.length} voters from database backup`, 'info');
       }
    };
    loadData();
  }, [initialVoters]);

  const addToast = (message: string, type: 'success' | 'error' | 'info') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
  };

  const updateVotersWithHistory = useCallback(async (newVoters: Voter[]) => {
    // LARGE DATASET OPTIMIZATION
    // If > 5000 records, disable undo/redo stack to save memory
    if (newVoters.length > 5000) {
        setHistory([newVoters]);
        setHistoryIndex(0);
    } else {
        setHistory(prev => {
          const currentHistory = prev.slice(0, historyIndex + 1);
          const updatedHistory = [...currentHistory, newVoters];
          if (updatedHistory.length > 20) {
            updatedHistory.shift();
          }
          return updatedHistory;
        });
        setHistoryIndex(prev => {
            if (historyIndex < 19) return historyIndex + 1;
            return 19;
        });
    }

    // AUTO-BACKUP: IndexedDB
    await saveBackupToDB(newVoters);

    // LIVE SAVE: File System Access API
    if (isLiveSaveActive && fileHandle) {
        try {
           const writable = await fileHandle.createWritable();
           const header = "Serial No,ID,Name,Name (En),Relative's Name,Relative's Name (En),House No,Age,Gender,Status\n";
           const rows = newVoters.map(v => 
             `${v.serialNo},${v.id},"${v.name}","${v.nameEn || ''}","${v.relativeName}","${v.relativeNameEn || ''}",${v.houseNo},${v.age},${v.gender},${v.status}`
           ).join('\n');
           await writable.write(header + rows);
           await writable.close();
        } catch (e) {
           console.error("Live Save Failed", e);
           setIsLiveSaveActive(false);
           addToast("Live save stopped. File permission lost.", 'error');
        }
    }
  }, [historyIndex, fileHandle, isLiveSaveActive]);

  const undo = () => {
    if (historyIndex > 0) setHistoryIndex(historyIndex - 1);
  };

  const redo = () => {
    if (historyIndex < history.length - 1) setHistoryIndex(historyIndex + 1);
  };

  const handleClearAllData = async () => {
      // Employees can only clear their own extracted data
      if (user.role === 'employee') {
        const myRecords = allVoters.filter(v => v.extractedBy === user.username);
        const othersRecords = allVoters.filter(v => v.extractedBy !== user.username);
        
        if (myRecords.length === 0) {
          addToast(`❌ You have no extracted records to clear.`, 'error');
          return;
        }
        
        let confirmMsg = `🗑️ Clear ${myRecords.length} records that YOU extracted?`;
        if (othersRecords.length > 0) {
          confirmMsg += `\n\n⚠️ ${othersRecords.length} records by others will be KEPT.`;
        }
        confirmMsg += `\n\nThis will allow you to start a fresh batch.`;
        
        if (!confirm(confirmMsg)) return;
        
        // Keep only others' records
        updateVotersWithHistory(othersRecords);
        addToast(`✅ Cleared ${myRecords.length} of your records. Ready for next batch!`, 'success');
        return;
      }
      
      // Admin can clear all
      if (!confirm('⚠️ Clear ALL data from database?\n\nThis will delete ALL voters extracted by ALL users!')) return;
      await clearDB();
      setHistory([initialVoters]);
      setHistoryIndex(0);
      setToasts([]);
      addToast("Database cleared. Ready for next batch.", 'success');
  };

  // Persisted Filters
  const [searchTerm, setSearchTerm] = useState(() => localStorage.getItem('searchTerm') || '');
  const [exactIdSearch, setExactIdSearch] = useState(() => localStorage.getItem('exactIdSearch') === 'true');
  const [genderFilter, setGenderFilter] = useState(() => localStorage.getItem('genderFilter') || 'All');
  const [statusFilter, setStatusFilter] = useState(() => localStorage.getItem('statusFilter') || 'All');
  const [currentPage, setCurrentPage] = useState(1);
  const [sortConfig, setSortConfig] = useState<SortConfig>(() => {
    const saved = localStorage.getItem('sortConfig');
    return saved ? JSON.parse(saved) : { key: null, direction: 'asc' };
  });

  // Save filters on change
  useEffect(() => { localStorage.setItem('searchTerm', searchTerm); }, [searchTerm]);
  useEffect(() => { localStorage.setItem('exactIdSearch', String(exactIdSearch)); }, [exactIdSearch]);
  useEffect(() => { localStorage.setItem('genderFilter', genderFilter); }, [genderFilter]);
  useEffect(() => { localStorage.setItem('statusFilter', statusFilter); }, [statusFilter]);
  useEffect(() => { localStorage.setItem('sortConfig', JSON.stringify(sortConfig)); }, [sortConfig]);


  const [selectedVoter, setSelectedVoter] = useState<Voter | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
  // Modals & Progress
  const [isProcessing, setIsProcessing] = useState(false);
  const [processProgress, setProcessProgress] = useState(0);
  const [isProcessComplete, setIsProcessComplete] = useState(false);
  const [newVoterCount, setNewVoterCount] = useState(0);
  const [processTitle, setProcessTitle] = useState("Processing File");
  const [currentFileName, setCurrentFileName] = useState("");
  const [processDetail, setProcessDetail] = useState("");
  const [processEta, setProcessEta] = useState("");
  const [showExportModal, setShowExportModal] = useState(false);
  const [lastImportStats, setLastImportStats] = useState<ImportStats | null>(null);

  // Toast
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Cost Calculator
  const [showCostCalc, setShowCostCalc] = useState(false);

  const removeToast = (id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  const ITEMS_PER_PAGE = 50;
  const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks

  // --- LIVE SAVE HANDLER ---
  const handleEnableLiveSave = async () => {
    // Security check for iframe environments
    if (typeof window !== 'undefined' && window.self !== window.top) {
        addToast("Live Save blocked in preview. Use Export.", 'error');
        return;
    }

    if (!('showSaveFilePicker' in window)) {
        addToast("Feature not supported in this browser.", 'error');
        return;
    }
    try {
        // @ts-ignore
        const handle = await window.showSaveFilePicker({
            suggestedName: `voter_list_${new Date().toISOString().slice(0,10)}.csv`,
            types: [{
                description: 'CSV File',
                accept: {'text/csv': ['.csv']},
            }],
        });
        setFileHandle(handle);
        setIsLiveSaveActive(true);
        addToast("Live Save Active! Data is writing to disk.", 'success');
        
        // Initial Write
        // @ts-ignore
        const writable = await handle.createWritable();
        const header = "Serial No,ID,Name,Name (En),Relative's Name,Relative's Name (En),House No,Age,Gender,Status\n";
        const rows = allVoters.map(v => 
             `${v.serialNo},${v.id},"${v.name}","${v.nameEn || ''}","${v.relativeName}","${v.relativeNameEn || ''}",${v.houseNo},${v.age},${v.gender},${v.status}`
        ).join('\n');
        await writable.write(header + rows);
        await writable.close();

    } catch (err: any) {
        console.error("Live save cancelled or failed", err);
        if (err.name === 'AbortError') {
            addToast("Save cancelled by user.", 'info');
        } else if (err.name === 'SecurityError' || err.message.includes('Cross origin')) {
             addToast("Blocked by security settings. Use Export.", 'error');
        } else {
             setIsLiveSaveActive(false);
             addToast("Live Save failed to start.", 'error');
        }
    }
  };

  const handleDisableLiveSave = () => {
      setIsLiveSaveActive(false);
      setFileHandle(null);
      addToast("Live Save disabled.", 'info');
  }

  // ============================================================
  // ADVANCED HYBRID OCR SYSTEM - Maximum Speed + Accuracy
  // ============================================================
  
  // Cache for Tesseract worker (reuse for speed)
  const tesseractWorkerRef = useRef<any>(null);
  
  // Initialize Tesseract worker once (for hybrid OCR)
  const getTesseractWorker = async () => {
    if (!tesseractWorkerRef.current && DESKTOP_CONFIG.ENABLE_HYBRID_OCR) {
      try {
        tesseractWorkerRef.current = await Tesseract.createWorker('mar+eng', 1, {
          logger: () => {} // Silent logging
        });
      } catch (e) {
        console.warn("Tesseract init failed, using Gemini-only mode");
      }
    }
    return tesseractWorkerRef.current;
  };

  // Fast Tesseract OCR for text hints (improves Gemini accuracy)
  const quickOCR = async (imageBase64: string): Promise<string> => {
    if (!DESKTOP_CONFIG.ENABLE_HYBRID_OCR) return '';
    try {
      const worker = await getTesseractWorker();
      if (!worker) return '';
      
      const { data } = await worker.recognize(`data:image/jpeg;base64,${imageBase64}`);
      return data.text.slice(0, 800); // Limit for prompt size
    } catch (e) {
      return '';
    }
  };

  // Helper: Convert Devanagari digits to English
  const convertDevanagariDigits = (str: string): string => {
    const devanagariDigits = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'];
    let result = str;
    devanagariDigits.forEach((d, i) => {
      result = result.replace(new RegExp(d, 'g'), i.toString());
    });
    return result;
  };

  // --- SMART PAGE TYPE DETECTION ---
  // Detects if page is a cover/instruction page or actual voter data page
  const detectPageType = async (base64Data: string): Promise<'cover' | 'voter_data' | 'single_voter' | 'empty'> => {
    if (!apiKey) return 'voter_data'; // Default to processing
    
    const ai = new GoogleGenAI({ apiKey: apiKey });
    
    const prompt = `Analyze this electoral roll page and classify it.

RESPOND WITH ONLY ONE WORD:
- "COVER" - if this is a cover page, title page, instructions, or summary page (no voter table)
- "EMPTY" - if page is blank or has no useful data
- "SINGLE" - if page has exactly 1 voter record in a table
- "DATA" - if page has a voter table with 2+ voter records

Look for:
- Voter table with columns (Serial, Photo, Name, Age, etc.)
- Individual voter entries with EPIC/Voter IDs
- Cover pages usually have large titles, logos, instructions

CLASSIFICATION:`;

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: {
          parts: [
            { inlineData: { mimeType: 'image/jpeg', data: base64Data }},
            { text: prompt }
          ]
        },
        config: { temperature: 0, maxOutputTokens: 20 }
      });
      
      const result = (response.text || '').toUpperCase().trim();
      
      if (result.includes('COVER')) return 'cover';
      if (result.includes('EMPTY')) return 'empty';
      if (result.includes('SINGLE')) return 'single_voter';
      return 'voter_data';
    } catch (e) {
      return 'voter_data'; // Default to processing on error
    }
  };

  // --- STRUCTURED JSON EXTRACTION (2-Call Approach: Header + Voters) ---
  // Call 1: Extract header/metadata, Call 2: Extract all voter records
  // Uses Google GenAI's JSON schema for 99%+ accuracy (Python reference implementation)
  const callGeminiWithImage = async (base64Data: string, extractedTextHint?: string, pageNum?: number, sourceFile?: string): Promise<Voter[]> => {
     if (!apiKey) throw new Error("API Key missing");
     const ai = new GoogleGenAI({ apiKey: apiKey });
     
     // CALL 1: Extract Header/Metadata (Structured JSON)
     const headerSchema = {
       type: "object" as const,
       properties: {
         GAT_and_Gan_Details: { type: "string" as const, description: "Constituency/Election division details" },
         PartNo: { type: "string" as const, description: "Part number with locality/village name" },
         BootName: { type: "string" as const, description: "Polling station name" },
         BoothaAddress: { type: "string" as const, description: "Full polling station address" },
         Page_Number: { type: "string" as const, description: "Page number (convert Devanagari to English digits)" },
         ACNo: { type: "string" as const, description: "Assembly Constituency number" }
       },
       required: ["GAT_and_Gan_Details", "PartNo", "BootName", "BoothaAddress", "Page_Number", "ACNo"]
     };
     
     const headerPrompt = `Analyze this electoral roll page and extract ONLY the header/footer metadata.
     
Instructions:
1. Extract header fields: Constituency details, Part number, Polling station name & address
2. Extract Page_Number from footer (convert Devanagari digits: ०→0, १→1, २→2, ३→3, ४→4, ५→5, ६→6, ७→7, ८→8, ९→9)
3. DO NOT extract voter table data - only metadata
4. Output strictly as JSON matching the schema

;
     
     let headerData: any = {};
     try {
       const headerResponse = await ai.models.generateContent({
         model: 'gemini-2.0-flash-exp',
         contents: { parts: [{ inlineData: { mimeType: 'image/jpeg', data: base64Data }}, { text: headerPrompt }] },
         config: {
           temperature: 0.05,
           maxOutputTokens: 500,
           topP: 0.8,
           responseMimeType: "application/json",
           responseSchema: headerSchema
         }
       });
       headerData = JSON.parse(headerResponse.text || '{}');
     } catch (e) {
       console.warn(`Header extraction failed for page ${pageNum}:`, e);
       headerData = {
         GAT_and_Gan_Details: '',
         PartNo: '',
         BootName: '',
         BoothaAddress: '',
         Page_Number: pageNum?.toString() || '',
         ACNo: ''
       };
     }
     
     // CALL 2: Extract Voter Records (Structured JSON Array)
     const voterSchema = {
       type: "object" as const,
       properties: {
         VoterStatus: { type: "string" as const, description: "ALIVE or DELETED" },
         SerialNoInPart: { type: "string" as const },
         SrNo: { type: "string" as const },
         EPIC: { type: "string" as const, description: "Voter ID (2-3 letters + 7-10 digits)" },
         FullName_M: { type: "string" as const, description: "Full name in Marathi script" },
         FullName_E: { type: "string" as const, description: "Phonetic English name" },
         RelationType: { type: "string" as const, description: "Father/Husband/Mother" },
         RelationName_M: { type: "string" as const },
         RelationName_E: { type: "string" as const },
         HouseNo: { type: "string" as const },
         Age: { type: "string" as const },
         Sex: { type: "string" as const, description: "M or F" }
       },
       required: ["VoterStatus", "SrNo", "EPIC", "FullName_M", "FullName_E", "RelationType", "RelationName_M", "RelationName_E", "HouseNo", "Age", "Sex"]
     };
     
     const voterArraySchema = {
       type: "array" as const,
       items: voterSchema
     };
     
     const voterPrompt = `Analyze the voter table in this electoral roll page (Page ${pageNum || '?'}). Extract EVERY SINGLE VOTER RECORD.

Instructions:
1. Each photo box = 1 voter. Count ALL boxes and extract ALL voters.
2. Extract all fields: SrNo, EPIC (voter ID), FullName_M (Marathi), FullName_E (English phonetic), RelationType, RelationName_M, RelationName_E, HouseNo, Age, Sex
3. VoterStatus: Set to 'ALIVE' unless voter entry is crossed out/strikethrough (then 'DELETED')
4. Convert Devanagari digits to English: ०→0, १→1, २→2, ३→3, ④→4, ५→5, ६→6, ७→7, ८→8, ९→9
5. EPIC format: 2-3 uppercase letters + 7-10 digits (e.g., WUB1234567, YLC8904561)
6. Sex: M (पुरुष/Male) or F (महिला/Female)
7. For missing fields, use empty string "", but NEVER skip the voter entry
8. Output as JSON array of voter objects
${extractedTextHint ? `\n\nText hint: ${extractedTextHint.slice(0, 200)}` : ''}`;

      try {
        const voterResponse = await ai.models.generateContent({
          model: 'gemini-2.0-flash-exp',
          contents: { parts: [{ inlineData: { mimeType: 'image/jpeg', data: base64Data }}, { text: voterPrompt }] },
          config: {
            temperature: 0.05,
            maxOutputTokens: 8000,
            topP: 0.8,
            topK: 20,
            responseMimeType: \"application/json\",
            responseSchema: voterArraySchema
          }
        });

        const voterRecords: any[] = JSON.parse(voterResponse.text || '[]');
        
        // Map JSON response to Voter objects
        const voters: Voter[] = voterRecords.map((record: any) => {
          const serialNo = convertDevanagariDigits(record.SrNo || '').replace(/[^\d]/g, '');
          const id = (record.EPIC || '').replace(/\s/g, '').toUpperCase();
          const age = parseInt(convertDevanagariDigits(record.Age || '').replace(/[^\d]/g, '')) || 0;
          const gender: 'M' | 'F' = record.Sex === 'F' || record.Sex === 'महिला' ? 'F' : 'M';
          const status = record.VoterStatus === 'DELETED' ? 'DELETED' : 'ALIVE';
          
          // Validation & confidence scoring
          const isValidId = /^[A-Z]{2,3}\d{7,10}$/.test(id);
          const isValidAge = age > 17 && age < 120;
          let confidence = 75;
          if (isValidId) confidence += 15;
          if (isValidAge) confidence += 5;
          if ((record.FullName_M || '').length > 3) confidence += 5;
          
          return {
            // Header fields from Call 1
            GAT_and_Gan_Details: headerData.GAT_and_Gan_Details || '',
            PartNo: headerData.PartNo || '',
            BootName: headerData.BootName || '',
            BoothaAddress: headerData.BoothaAddress || '',
            Page_Number: headerData.Page_Number || pageNum?.toString() || '',
            ACNo: headerData.ACNo || '',
            PartNo_Segment: (headerData.PartNo || '').match(/\d+/)?.[0] || '',
            SerialNoInPart: convertDevanagariDigits(record.SerialNoInPart || record.SrNo || '').replace(/[^\d]/g, ''),
            
            // Voter fields from Call 2
            serialNo,
            id,
            name: record.FullName_M || '',
            nameEn: record.FullName_E || '',
            relationType: record.RelationType || 'Father',
            relativeName: record.RelationName_M || '',
            relativeNameEn: record.RelationName_E || '',
            houseNo: record.HouseNo || '',
            age: isValidAge ? age : 0,
            gender,
            status,
            confidenceScore: Math.min(100, confidence),
            sourceImageFile: sourceFile || `Page_${pageNum || 'Unknown'}`
          };
        }).filter(v => v.name.length > 2 || v.id.length > 5); // Filter out invalid entries
        
        if (voters.length === 0) {
          console.warn(`⚠️ Page ${pageNum}: No voters extracted from structured JSON response`);
        }
        
        return voters;

      } catch (e: any) {
        console.error(`Gemini Error (Page ${pageNum}):`, e.status || e.message);
        
        // Retry logic with exponential backoff (matching Python implementation)
        if (e.status === 429) {
          console.warn(`⚠️ Rate limit (429) - retrying in 2 seconds...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
          return callGeminiWithImage(base64Data, extractedTextHint, pageNum, sourceFile);
        }
        
        if (e.status === 503 || e.status === 500) {
          console.warn(`⚠️ Server error (${e.status}) - retrying in 3 seconds...`);
          await new Promise(resolve => setTimeout(resolve, 3000));
          return callGeminiWithImage(base64Data, extractedTextHint, pageNum, sourceFile);
        }
        
        return [];
      }
  };

  // --- BATCH PROCESSING: Multiple pages per API call ---
  const callGeminiBatch = async (pages: { pageNum: number, base64: string }[]): Promise<Map<number, Voter[]>> => {
    if (!apiKey || pages.length === 0) return new Map();
    
    const ai = new GoogleGenAI({ apiKey: apiKey });
    const results = new Map<number, Voter[]>();
    
    // Build multi-image prompt
    const parts: any[] = [];
    
    pages.forEach((page, idx) => {
      parts.push({ inlineData: { mimeType: 'image/jpeg', data: page.base64 }});
      parts.push({ text: `[PAGE ${idx + 1}]` });
    });
    
    parts.push({ text: `
Extract ALL voters from ALL ${pages.length} pages above.

FORMAT for each voter:
PageNum|Serial|VoterID|Name|Relative|House|Age|Gender|Status

RULES:
- PageNum: Which page (1, 2, 3...)
- Extract EVERY voter from EVERY page
- Keep EXACT Marathi text
- VoterID: Letters + Digits (e.g., WUB1234567)
- Gender: M/F
- Status: A/D

OUTPUT:` });

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: { parts },
        config: {
          temperature: 0.05,
          maxOutputTokens: 16384, // Large for batch
        }
      });

      const text = response.text || "";
      const lines = text.split('\n').filter(l => l.includes('|') && l.trim().length > 20);
      
      for (const line of lines) {
        const cols = line.split('|').map(c => c.trim());
        if (cols.length < 7) continue;
        
        const pageIdx = parseInt(cols[0]) || 1;
        const pageNum = pages[pageIdx - 1]?.pageNum || pageIdx;
        
        if (!results.has(pageNum)) {
          results.set(pageNum, []);
        }
        
        const voter: Voter = {
          serialNo: cols[1]?.replace(/[^\d]/g, '') || '',
          id: cols[2]?.replace(/\s/g, '').toUpperCase() || '',
          name: cols[3] || '',
          nameEn: '',
          relativeName: cols[4] || '',
          relativeNameEn: '',
          houseNo: cols[5] || '',
          age: parseInt(cols[6]) || 0,
          gender: cols[7]?.toUpperCase() === 'M' ? 'Male' : cols[7]?.toUpperCase() === 'F' ? 'Female' : 'Unknown',
          status: cols[8]?.toUpperCase() === 'D' ? 'DELETED' : 'Active',
          confidenceScore: 90
        };
        
        if (voter.name.length > 2) {
          results.get(pageNum)!.push(voter);
        }
      }
      
    } catch (e) {
      console.error("Batch processing failed:", e);
    }
    
    return results;
  };

  // --- ULTRA-FAST PDF PROCESSING (Maximum Speed + Accuracy) ---
  const handlePdfProcessing = async (file: File) => {
    setIsProcessing(true);
    setCurrentFileName(file.name);
    setProcessProgress(0);
    setProcessTitle("🚀 ULTRA-SPEED PDF Extraction");
    setProcessDetail("Initializing high-performance engine...");
    setProcessEta("Calculating...");
    setIsProcessComplete(false);
    setNewVoterCount(0);
    setLastImportStats(null);
    
    try {
        // STEP 1: Load PDF file
        try {
            const arrayBuffer = await file.arrayBuffer();
            if (!arrayBuffer || arrayBuffer.byteLength === 0) {
                throw new Error('PDF file is empty or corrupted');
            }
            console.log('📄 PDF loaded:', file.name, 'Size:', (arrayBuffer.byteLength / 1024).toFixed(2) + 'KB');
        } catch (fileErr: any) {
            console.error('❌ FILE LOAD ERROR:', fileErr.message);
            addToast('❌ Failed to load PDF file: ' + fileErr.message, 'error');
            setIsProcessing(false);
            return;
        }
        
        // STEP 2: Configure PDF options
        let getDocOptions: any = {};
        try {
            getDocOptions = { 
              data: new Uint8Array(await file.arrayBuffer()),
              isEvalSupported: true,
              useSystemFonts: true,
              cMapUrl: isElectronEnv 
                ? 'file://' + (await (window as any).electronAPI?.getAppPath?.())?.replace(/\\/g, '/') 
                : 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/',
              cMapPacked: true
            };
            
            // Only use worker fetch on Electron; web has CORS/worker issues
            if (isElectronEnv) {
                getDocOptions.useWorkerFetch = true;
                console.log('🖥️ Electron detected - using worker fetch');
            } else {
                getDocOptions.useWorkerFetch = false;
                console.log('🌐 Web detected - disabling worker fetch');
            }
        } catch (optErr: any) {
            console.error('❌ PDF OPTIONS ERROR:', optErr.message);
            addToast('❌ Failed to configure PDF parser: ' + optErr.message, 'error');
            setIsProcessing(false);
            return;
        }
        
        // STEP 3: Parse PDF document
        let pdf: any;
        try {
            console.log('⏳ Parsing PDF...');
            pdf = await pdfjs.getDocument(getDocOptions).promise;
            const numPages = pdf.numPages;
            console.log('✅ PDF parsed successfully. Pages:', numPages);
            
            if (!pdf || numPages === undefined) {
                throw new Error('PDF parsing returned invalid document');
            }
            if (numPages === 0) {
                throw new Error('PDF has 0 pages');
            }
        } catch (parseErr: any) {
            console.error('❌ PDF PARSE ERROR:', parseErr.message);
            addToast('❌ Failed to parse PDF: ' + parseErr.message, 'error');
            setIsProcessing(false);
            return;
        }
        
        const numPages = pdf.numPages;
        
        let currentSessionVoters: Voter[] = [];
        
        // ============ DYNAMIC SPEED SETTINGS FROM PROFILE ============
        const speedProfile = getSpeedProfile();
        const CONCURRENCY = speedProfile.CONCURRENCY;          // Dynamic based on profile
        const IMAGE_SCALE = DESKTOP_CONFIG.IMAGE_SCALE;        // 2.5 for high accuracy
        const JPEG_QUALITY = DESKTOP_CONFIG.JPEG_QUALITY;      // 0.85 for optimal OCR
        const RENDER_CONCURRENCY = speedProfile.RENDER_CONCURRENCY; // Dynamic parallel renders
        const BATCH_SIZE = speedProfile.BATCH_SIZE;            // Dynamic batch size
        const USE_BATCH_MODE = BATCH_SIZE > 1 && numPages >= 8; // Enable batch if enough pages
        // ==========================================================
        
        const profileName = localStorage.getItem('SPEED_PROFILE') || DESKTOP_CONFIG.DEFAULT_PROFILE;
        const startTime = Date.now();
        console.log(`🚀 SPEED PROFILE: ${profileName.toUpperCase()} | ${numPages} pages | Concurrency: ${CONCURRENCY} | Scale: ${IMAGE_SCALE}x | Batch: ${USE_BATCH_MODE ? BATCH_SIZE : 'OFF'}`);

        // PHASE 1: Pre-render all pages with HIGH QUALITY images
        setProcessDetail(`Pre-rendering ${numPages} pages at ${IMAGE_SCALE}x quality...`);
        
        const preRenderPage = async (pageNum: number): Promise<{ pageNum: number, base64: string, textHint: string }> => {
            try {
                const page = await pdf.getPage(pageNum);
                if (!page) {
                    throw new Error(`Failed to get page ${pageNum}`);
                }
                
                const textContent = await page.getTextContent();
                const pageText = textContent.items.map((item: any) => item.str).join(' ').slice(0, 600);
                
                const viewport = page.getViewport({ scale: IMAGE_SCALE });
                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d', { 
                  alpha: false,
                  willReadFrequently: false,
                  desynchronized: true // Faster rendering
                });
                
                if (!context) {
                    throw new Error(`Failed to create canvas context for page ${pageNum}`);
                }
                
                canvas.height = viewport.height;
                canvas.width = viewport.width;
                
                // High-quality rendering settings
                context.imageSmoothingEnabled = true;
                context.imageSmoothingQuality = 'high';
                context.fillStyle = 'white';
                context.fillRect(0, 0, canvas.width, canvas.height);
                
                await page.render({ 
                  canvasContext: context, 
                  viewport: viewport,
                  intent: 'print' // Higher quality rendering
                }).promise;
                
                // Enhanced contrast for better OCR
                const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
                const data = imageData.data;
                const contrast = 1.15; // Slight contrast boost
                const factor = (259 * (contrast * 255 + 255)) / (255 * (259 - contrast * 255));
                
                for (let i = 0; i < data.length; i += 4) {
                  data[i] = Math.min(255, Math.max(0, factor * (data[i] - 128) + 128));
                  data[i + 1] = Math.min(255, Math.max(0, factor * (data[i + 1] - 128) + 128));
                  data[i + 2] = Math.min(255, Math.max(0, factor * (data[i + 2] - 128) + 128));
                }
                context.putImageData(imageData, 0, 0);
                
                const base64 = canvas.toDataURL('image/jpeg', JPEG_QUALITY).split(',')[1];
                
                // Cleanup
                canvas.width = 0;
                canvas.height = 0;
                
                return { pageNum, base64, textHint: pageText };
            } catch (renderErr: any) {
                console.error(`❌ RENDER ERROR (Page ${pageNum}):`, renderErr.message);
                return { pageNum, base64: '', textHint: '' };
            }
        };

        // STEP 4: Render all pages with high concurrency
        let renderedPages: any[] = [];
        try {
            console.log(`⏳ Rendering ${numPages} pages with ${RENDER_CONCURRENCY} concurrency...`);
            const pageNumbers = Array.from({ length: numPages }, (_, i) => i + 1);
            renderedPages = await pMap(pageNumbers, preRenderPage, { concurrency: RENDER_CONCURRENCY });
            
            const successfulRenders = renderedPages.filter(p => p.base64).length;
            const failedRenders = renderedPages.length - successfulRenders;
            console.log(`✅ Rendering complete: ${successfulRenders}/${numPages} pages successfully rendered`);
            
            if (failedRenders > 0) {
                console.warn(`⚠️ ${failedRenders} pages failed to render`);
                addToast(`⚠️ Warning: ${failedRenders} pages failed to render. Results may be incomplete.`, 'warning');
            }
            
            if (successfulRenders === 0) {
                throw new Error('All pages failed to render');
            }
        } catch (renderBatchErr: any) {
            console.error('❌ RENDERING BATCH ERROR:', renderBatchErr.message);
            addToast('❌ Failed to render PDF pages: ' + renderBatchErr.message, 'error');
            setIsProcessing(false);
            return;
        }
        
        setProcessProgress(15);
        setProcessDetail(`✅ All ${numPages} pages rendered. Starting AI extraction...`);

        // PHASE 2: Process with Gemini (Batch or Single mode)
        let completedCount = 0;
        let totalVotersExtracted = 0;
        let skippedPages = 0;
        let singleVoterPages = 0;
        const sourceFileName = file.name;
        
        const processWithGemini = async (pageData: { pageNum: number, base64: string, textHint: string }) => {
            if (!pageData.base64) {
                console.warn(`⚠️ Page ${pageData.pageNum}: No image data available (render failed)`);
                completedCount++;
                skippedPages++;
                return [];
            }
            
            try {
                // HYBRID OCR: Quick Tesseract scan for text hints (improves accuracy)
                let enhancedHint = pageData.textHint;
                if (DESKTOP_CONFIG.ENABLE_HYBRID_OCR) {
                  try {
                    const ocrHint = await quickOCR(pageData.base64);
                    if (ocrHint.length > 50) {
                      enhancedHint = ocrHint;
                    }
                  } catch (ocrErr: any) {
                    console.warn(`⚠️ OCR hint failed for page ${pageData.pageNum}:`, ocrErr.message);
                    // Continue with text hint fallback
                  }
                }
                
                // Pass pageNum and sourceFile for header extraction
                let voters: Voter[] = [];
                try {
                    voters = await callGeminiWithImage(
                      pageData.base64, 
                      enhancedHint, 
                      pageData.pageNum,
                      `${sourceFileName}_Page${pageData.pageNum}`
                    );
                } catch (geminiErr: any) {
                    console.error(`❌ Gemini API error for page ${pageData.pageNum}:`, geminiErr.message);
                    addToast(`❌ API error on page ${pageData.pageNum}. Check API key or rate limit.`, 'error');
                    completedCount++;
                    return [];
                }
                
                completedCount++;
                
                // Track page types - only count as empty if truly no data
                if (voters.length === 0) {
                  skippedPages++;
                  console.warn(`⚠️ Page ${pageData.pageNum}: No voters extracted - check console for details`);
                } else if (voters.length === 1) {
                  singleVoterPages++;
                }
                
                totalVotersExtracted += voters.length;
                
                const progress = 15 + ((completedCount / numPages) * 80);
                setProcessProgress(Math.min(95, progress));
                setNewVoterCount(totalVotersExtracted);
                
                // Speed calculation with page type info
                const elapsed = (Date.now() - startTime) / 1000;
                const rate = completedCount / elapsed;
                const remaining = (numPages - completedCount) / rate;
                setProcessEta(remaining > 1 ? `${Math.ceil(remaining)}s left` : "Almost done!");
                
                // Show extraction progress (don't call it "cover pages")
                const failInfo = skippedPages > 0 ? ` (${skippedPages} pages need review)` : '';
                setProcessDetail(`Page ${completedCount}/${numPages} • ${totalVotersExtracted} records${failInfo}`);
                
                return voters;
            } catch (e: any) {
                console.error(`❌ UNEXPECTED ERROR on Page ${pageData.pageNum}:`, e?.message || e);
                completedCount++;
                return [];
            }
        };

        // Fire all Gemini requests with MAXIMUM concurrency
        const results = await pMap(renderedPages, processWithGemini, { concurrency: CONCURRENCY });
        
        // Flatten results and add extractedBy field
        const extractionTimestamp = new Date().toISOString();
        currentSessionVoters = results.flat().map(v => ({
          ...v,
          extractedBy: user.username,
          extractedAt: extractionTimestamp
        }));

        // PHASE 3: Advanced deduplication by Voter ID
        const seen = new Map<string, Voter>();
        let duplicates = 0;
        currentSessionVoters.forEach(v => {
            const normalizedId = v.id?.toUpperCase().replace(/\s/g, '');
            if (normalizedId && !seen.has(normalizedId)) {
                seen.set(normalizedId, v);
            } else if (normalizedId) {
                duplicates++;
            }
        });
        currentSessionVoters = Array.from(seen.values());

        // Final Save
        await updateVotersWithHistory([...allVoters, ...currentSessionVoters]);
        
        const totalConf = currentSessionVoters.reduce((acc, v) => acc + (v.confidenceScore || 0), 0);
        const avgConf = currentSessionVoters.length ? Math.round(totalConf / currentSessionVoters.length) : 0;
        setLastImportStats({ count: currentSessionVoters.length, avgConfidence: avgConf });

        const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
        const pagesPerMin = Math.round((numPages / parseFloat(totalTime)) * 60);
        const votersPerSec = Math.round(currentSessionVoters.length / parseFloat(totalTime));
        const dataPages = numPages - skippedPages;
        
        setProcessProgress(100);
        setIsProcessComplete(true);
        
        // Show summary - be honest about extraction issues
        const failSummary = skippedPages > 0 ? ` | ⚠️ ${skippedPages} pages need review` : '';
        const singleSummary = singleVoterPages > 0 ? ` | ${singleVoterPages} single-voter pages` : '';
        setProcessDetail(`✅ ${currentSessionVoters.length} records from ${dataPages} pages in ${totalTime}s${failSummary}`);
        
        console.log(`
🚀 EXTRACTION COMPLETE:
   ────────────────────────────────
   📄 Total Pages: ${numPages}
   📊 Pages with Data: ${dataPages}
   ⚠️ Pages Needing Review: ${skippedPages}
   👤 Single-Voter Pages: ${singleVoterPages}
   ────────────────────────────────
   👥 Voters Extracted: ${currentSessionVoters.length}
   🔄 Duplicates Removed: ${duplicates}
   ⏱️ Time: ${totalTime}s
   🏎️ Speed: ${pagesPerMin} pages/min | ${votersPerSec} voters/sec
   🎯 Avg Accuracy: ${avgConf}%
   ────────────────────────────────
   ⚙️ Settings: Concurrency=${CONCURRENCY}, Scale=${IMAGE_SCALE}x
        `);

    } catch (err: any) {
        console.error("❌ PDF PROCESSING ERROR:", err?.message || err);
        console.error("Full error details:", err);
        
        // Provide specific error guidance
        if (err?.message?.includes('0 pages')) {
            addToast("❌ PDF appears to be invalid or corrupted. Please check the file.", 'error');
        } else if (err?.message?.includes('worker')) {
            addToast("❌ PDF rendering failed (worker issue). Try reloading the page.", 'error');
        } else if (err?.message?.includes('CORS') || err?.message?.includes('401') || err?.message?.includes('403')) {
            addToast("❌ CDN access issue. Check your internet connection or try again.", 'error');
        } else if (err?.message?.includes('API') || err?.message?.includes('key')) {
            addToast("❌ API configuration error. Check your Gemini API key.", 'error');
        } else {
            addToast("❌ PDF processing failed: " + (err?.message || 'Unknown error'), 'error');
        }
        
        setIsProcessing(false);
    }
  };

  const handleAiProcessingSingle = async (file: File) => {
      setIsProcessing(true);
      setCurrentFileName(file.name);
      setProcessProgress(10);
      setProcessTitle("AI Analyzing Image");
      setProcessDetail("Enhancing Image...");
      setLastImportStats(null);
      try {
        const base64 = await fileToBase64(file);
        
        setProcessProgress(40);
        setProcessDetail("Gemini Vision AI processing...");
        const voters = await callGeminiWithImage(base64, '', 1, file.name);
        
        const totalConf = voters.reduce((acc, v) => acc + (v.confidenceScore || 0), 0);
        const avgConf = voters.length ? Math.round(totalConf / voters.length) : 0;
        setLastImportStats({ count: voters.length, avgConfidence: avgConf });
        
        setProcessProgress(100);
        setNewVoterCount(voters.length);
        await updateVotersWithHistory([...allVoters, ...voters]);
        setIsProcessComplete(true);
      } catch (e) {
        console.error(e);
        addToast("Processing failed. Check API Key.", 'error');
        setIsProcessing(false);
      }
  };

  // --- CSV / FILE UPLOAD HANDLER ---
  const handleUnifiedUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.type === 'application/pdf') {
       await handlePdfProcessing(file);
       event.target.value = '';
       return;
    }
    
    if (file.type.startsWith('image/')) {
        await handleAiProcessingSingle(file);
        event.target.value = '';
        return;
    }

    // Default to CSV handling
    setIsProcessing(true);
    setCurrentFileName(file.name);
    setProcessProgress(0);
    setProcessTitle("Importing CSV Database");
    setProcessDetail("Analyzing Headers...");
    setIsProcessComplete(false);
    setNewVoterCount(0);
    setLastImportStats(null);

    let offset = 0;
    let remainder = '';
    const accumulatedVoters: Voter[] = [];
    const fileSize = file.size;

    const readNextChunk = () => {
      const slice = file.slice(offset, offset + CHUNK_SIZE);
      const reader = new FileReader();

      reader.onload = async (e) => {
        const content = e.target?.result as string;
        if (!content) return;

        const fullText = remainder + content;
        const lastNewlineIndex = fullText.lastIndexOf('\n');
        
        let chunkToProcess = '';
        if (lastNewlineIndex !== -1 && offset + CHUNK_SIZE < fileSize) {
          chunkToProcess = fullText.substring(0, lastNewlineIndex);
          remainder = fullText.substring(lastNewlineIndex + 1);
        } else {
          chunkToProcess = fullText;
          remainder = '';
        }

        const newVoters = parseCSVChunk(chunkToProcess, offset === 0);
        accumulatedVoters.push(...newVoters);

        offset += CHUNK_SIZE;
        const progress = Math.min(100, Math.round((offset / fileSize) * 100));
        setProcessProgress(progress);
        setNewVoterCount(prev => prev + newVoters.length);
        setProcessDetail(`Processed ${accumulatedVoters.length} records...`);

        if (offset < fileSize) {
          setTimeout(readNextChunk, 0);
        } else {
          setLastImportStats({ count: accumulatedVoters.length, avgConfidence: 100 });
          await updateVotersWithHistory([...allVoters, ...accumulatedVoters]);
          setIsProcessComplete(true);
          setProcessDetail("Database Updated");
          event.target.value = '';
        }
      };
      reader.onerror = () => {
        setIsProcessing(false);
        addToast("Error reading file", 'error');
      };
      reader.readAsText(slice);
    };
    readNextChunk();
  };

  const closeProcessModal = () => {
    setIsProcessing(false);
    setIsProcessComplete(false);
  };

  const handleCreateVoter = (newVoter: Voter) => {
    updateVotersWithHistory([newVoter, ...allVoters]);
    setShowCreateModal(false);
    addToast("New voter registered successfully", 'success');
  };

  const handleUpdateVoter = (updatedVoter: Voter) => {
    // Employees can only edit their own records
    if (user.role === 'employee') {
      const originalVoter = allVoters.find(v => v.id === updatedVoter.id && v.serialNo === updatedVoter.serialNo);
      if (originalVoter && originalVoter.extractedBy !== user.username) {
        addToast(`❌ You can only edit records you extracted.`, 'error');
        setSelectedVoter(null);
        return;
      }
    }
    updateVotersWithHistory(allVoters.map(v => (v.id === updatedVoter.id && v.serialNo === updatedVoter.serialNo) ? updatedVoter : v));
    setSelectedVoter(null);
    addToast("Voter updated successfully", 'success');
  };

  // --- BULK ACTIONS ---
  const toggleSelection = (voter: Voter) => {
    const cid = generateCompositeId(voter);
    const newSet = new Set(selectedIds);
    if (newSet.has(cid)) newSet.delete(cid);
    else newSet.add(cid);
    setSelectedIds(newSet);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size > 0 && Array.from(selectedIds).some(id => paginatedVoters.some(v => generateCompositeId(v) === id))) {
      // Deselect all on current page
      const newSet = new Set(selectedIds);
      paginatedVoters.forEach(v => newSet.delete(generateCompositeId(v)));
      setSelectedIds(newSet);
    } else {
      // Select all on current page
      const newSet = new Set(selectedIds);
      paginatedVoters.forEach(v => newSet.add(generateCompositeId(v)));
      setSelectedIds(newSet);
    }
  };

  // Select ALL filtered voters (not just current page)
  const selectAllFilteredVoters = () => {
    const newSet = new Set<string>();
    filteredVoters.forEach(v => newSet.add(generateCompositeId(v)));
    setSelectedIds(newSet);
    addToast(`Selected all ${filteredVoters.length} records`, 'info');
  };

  // Get current user's permissions
  const userPermissions = getPermissions(user.role);
  
  // Helper: Get records owned by current user
  const getMyRecords = () => allVoters.filter(v => v.extractedBy === user.username);
  const myRecordsCount = getMyRecords().length;

  // Delete ALL filtered voters directly (without needing to select first)
  const handleDeleteAllFiltered = () => {
    // Employees can only delete their own data
    if (user.role === 'employee') {
      const myFilteredRecords = filteredVoters.filter(v => v.extractedBy === user.username);
      if (myFilteredRecords.length === 0) {
        addToast('❌ No records found that you extracted. You can only delete your own data.', 'error');
        return;
      }
      if (!confirm(`Delete ${myFilteredRecords.length} records that YOU extracted?\n\n(You can only delete your own data)`)) return;
      
      const myIds = new Set(myFilteredRecords.map(v => generateCompositeId(v)));
      const newVoters = allVoters.filter(v => !myIds.has(generateCompositeId(v)));
      updateVotersWithHistory(newVoters);
      setSelectedIds(new Set());
      addToast(`✅ Deleted ${myFilteredRecords.length} of your records`, 'success');
      return;
    }
    
    // Admin can delete all
    if (filteredVoters.length === 0) {
      addToast('No records to delete', 'error');
      return;
    }
    if (!confirm(`⚠️ Are you sure you want to DELETE ALL ${filteredVoters.length} records?\n\nThis action cannot be undone!`)) return;
    
    const filteredIds = new Set(filteredVoters.map(v => generateCompositeId(v)));
    const newVoters = allVoters.filter(v => !filteredIds.has(generateCompositeId(v)));
    updateVotersWithHistory(newVoters);
    setSelectedIds(new Set());
    addToast(`Deleted all ${filteredVoters.length} records`, 'success');
  };

  // ========== DUPLICATE DETECTION ==========
  const findDuplicates = () => {
    const duplicateGroups: Map<string, Voter[]> = new Map();
    
    // Group by name + relative name + age (likely same person)
    allVoters.forEach(voter => {
      const key = `${voter.name?.toLowerCase().trim()}-${voter.relativeName?.toLowerCase().trim()}-${voter.age}`;
      if (!duplicateGroups.has(key)) {
        duplicateGroups.set(key, []);
      }
      duplicateGroups.get(key)!.push(voter);
    });
    
    // Filter only groups with more than 1 voter (duplicates)
    const duplicates = Array.from(duplicateGroups.entries())
      .filter(([_, voters]) => voters.length > 1)
      .map(([key, voters]) => ({ key, voters, count: voters.length }));
    
    return duplicates;
  };

  const handleFindDuplicates = () => {
    const duplicates = findDuplicates();
    const totalDuplicates = duplicates.reduce((sum, d) => sum + d.count - 1, 0);
    
    if (duplicates.length === 0) {
      addToast("✅ No duplicates found!", "success");
      return;
    }
    
    const message = `Found ${duplicates.length} groups with ${totalDuplicates} duplicate entries.\n\nDo you want to select all duplicates for review?`;
    if (confirm(message)) {
      // Select all duplicates (keep first, select rest)
      const duplicateIds = new Set<string>();
      duplicates.forEach(group => {
        // Skip first one (keep it), select rest as duplicates
        group.voters.slice(1).forEach(v => {
          duplicateIds.add(generateCompositeId(v));
        });
      });
      setSelectedIds(duplicateIds);
      addToast(`Selected ${duplicateIds.size} duplicate records for review`, "info");
    }
  };

  // ========== DATA VALIDATION ==========
  const handleValidateData = () => {
    const issues: { type: string; count: number; voters: Voter[] }[] = [];
    
    // Check for missing names
    const missingNames = allVoters.filter(v => !v.name || v.name.trim() === '');
    if (missingNames.length > 0) {
      issues.push({ type: 'Missing Name', count: missingNames.length, voters: missingNames });
    }
    
    // Check for invalid ages
    const invalidAges = allVoters.filter(v => !v.age || v.age < 18 || v.age > 120);
    if (invalidAges.length > 0) {
      issues.push({ type: 'Invalid Age', count: invalidAges.length, voters: invalidAges });
    }
    
    // Check for missing voter IDs
    const missingIds = allVoters.filter(v => !v.id || v.id.trim() === '' || v.id.length < 5);
    if (missingIds.length > 0) {
      issues.push({ type: 'Missing/Invalid Voter ID', count: missingIds.length, voters: missingIds });
    }
    
    // Check for missing gender
    const missingGender = allVoters.filter(v => !v.gender || !['M', 'F', 'Male', 'Female'].includes(v.gender));
    if (missingGender.length > 0) {
      issues.push({ type: 'Missing Gender', count: missingGender.length, voters: missingGender });
    }
    
    // Check for low confidence
    const lowConfidence = allVoters.filter(v => (v.confidenceScore || 100) < 70);
    if (lowConfidence.length > 0) {
      issues.push({ type: 'Low Confidence (<70%)', count: lowConfidence.length, voters: lowConfidence });
    }
    
    if (issues.length === 0) {
      addToast("✅ All data is valid!", "success");
      return;
    }
    
    const message = issues.map(i => `• ${i.type}: ${i.count} records`).join('\n');
    alert(`Data Validation Report:\n\n${message}\n\nTotal Issues: ${issues.reduce((s, i) => s + i.count, 0)}`);
  };

  const handleBulkDelete = () => {
    // Employees can only delete their own selected records
    if (user.role === 'employee') {
      const selectedVoters = allVoters.filter(v => selectedIds.has(generateCompositeId(v)));
      const mySelectedRecords = selectedVoters.filter(v => v.extractedBy === user.username);
      const othersRecords = selectedVoters.filter(v => v.extractedBy !== user.username);
      
      if (mySelectedRecords.length === 0) {
        addToast(`❌ None of the ${selectedIds.size} selected records were extracted by you.`, 'error');
        return;
      }
      
      let confirmMsg = `Delete ${mySelectedRecords.length} records that YOU extracted?`;
      if (othersRecords.length > 0) {
        confirmMsg += `\n\n⚠️ ${othersRecords.length} records by others will NOT be deleted.`;
      }
      
      if (!confirm(confirmMsg)) return;
      
      const myIds = new Set(mySelectedRecords.map(v => generateCompositeId(v)));
      const newVoters = allVoters.filter(v => !myIds.has(generateCompositeId(v)));
      updateVotersWithHistory(newVoters);
      setSelectedIds(new Set());
      addToast(`✅ Deleted ${mySelectedRecords.length} of your records`, 'success');
      return;
    }
    
    // Admin can delete all selected
    if (!confirm(`Are you sure you want to delete ${selectedIds.size} voters?`)) return;
    const newVoters = allVoters.filter(v => !selectedIds.has(generateCompositeId(v)));
    updateVotersWithHistory(newVoters);
    setSelectedIds(newSet => new Set());
    addToast(`Deleted ${selectedIds.size} voters`, 'success');
  };

  const handleBulkStatusChange = (newStatus: string) => {
    const newVoters = allVoters.map(v => {
      if (selectedIds.has(generateCompositeId(v))) {
        return { ...v, status: newStatus };
      }
      return v;
    });
    updateVotersWithHistory(newVoters);
    setSelectedIds(newSet => new Set());
    addToast(`Updated status for selected voters`, 'success');
  };

  const handleBulkTranslateMissing = async () => {
      // 1. Identify ALL names that need translation
      const allCandidates = allVoters.filter(v => 
          v.name && v.name.length > 0 && 
          (!v.nameEn || v.nameEn === v.name || v.nameEn.trim() === '')
      );
      
      if(allCandidates.length === 0) {
          addToast("All names are already translated!", "info");
          return;
      }
      
      // Ask user which translation method to use
      const useFreeApi = DESKTOP_CONFIG.USE_FREE_TRANSLATION || 
        confirm(`Choose translation method:\n\n• OK = FREE (MyMemory API - slower but free)\n• Cancel = Gemini AI (faster but uses API quota)\n\nTranslating ${allCandidates.length} names...`);
      
      addToast(`Starting ${useFreeApi ? 'FREE' : 'Gemini'} translation of ${allCandidates.length} names...`, "info");
      
      try {
          const transMap = new Map<string, string>();
          
          if (useFreeApi) {
              // ========== FREE TRANSLATION (MyMemory API) ==========
              const uniqueNames: string[] = Array.from(new Set(allCandidates.map(c => c.name).filter((n): n is string => !!n)));
              
              const translations = await batchTranslateFree(uniqueNames, (done, total) => {
                  addToast(`Translated ${done}/${total} unique names (FREE)...`, "info");
              });
              
              // Map results to all candidates with same name
              allCandidates.forEach(c => {
                  const translated = translations.get(c.name);
                  if (translated && translated !== c.name) {
                      transMap.set(c.id + c.serialNo, translated);
                  }
              });
              
          } else {
              // ========== GEMINI AI TRANSLATION (Paid) ==========
              if(!apiKey) throw new Error("No API Key");
              const ai = new GoogleGenAI({ apiKey });
              
              // Process in batches of 100 for API efficiency
              const BATCH_SIZE = 100;
              const batches = [];
              for (let i = 0; i < allCandidates.length; i += BATCH_SIZE) {
                  batches.push(allCandidates.slice(i, i + BATCH_SIZE));
              }
              
              let completed = 0;
              
              // Process batches with concurrency limit
              for (const batch of batches) {
                  const prompt = `Transliterate these Marathi names to English phonetically. Return ONLY a valid JSON array of strings in the EXACT same order.
Input: ${JSON.stringify(batch.map(c => c.name))}
Output (JSON array only):`;
                  
                  try {
                      const response = await ai.models.generateContent({
                         model: 'gemini-2.5-flash',
                         contents: prompt,
                         config: { temperature: 0.1 }
                      });
                      const text = response.text || "[]";
                      const clean = text.replace(/```json/g, '').replace(/```/g, '').trim();
                      
                      // Try to parse JSON
                      let translations: string[] = [];
                      try {
                          translations = JSON.parse(clean);
                      } catch {
                          // If JSON fails, try line-by-line
                          translations = clean.split('\n').map(l => l.replace(/["\[\],]/g, '').trim()).filter(l => l.length > 0);
                      }
                      
                      // Map results
                      batch.forEach((c, idx) => {
                          if (translations[idx]) {
                              transMap.set(c.id + c.serialNo, translations[idx]);
                          }
                      });
                      
                      completed += batch.length;
                      addToast(`Translated ${completed}/${allCandidates.length} names (Gemini)...`, "info");
                      
                  } catch (batchError) {
                      console.error("Batch translation error:", batchError);
                      // Continue with next batch
                  }
                  
                  // Small delay to avoid rate limits
                  await new Promise(r => setTimeout(r, 200));
              }
          }

          // Apply all translations
          const newVoters = allVoters.map(v => {
              const key = v.id + v.serialNo;
              if (transMap.has(key)) {
                  return { ...v, nameEn: transMap.get(key) };
              }
              return v;
          });

          updateVotersWithHistory(newVoters);
          addToast(`✅ Successfully translated ${transMap.size} names using ${useFreeApi ? 'FREE API' : 'Gemini'}!`, "success");

      } catch (e) {
          console.error("Bulk Translate Error", e);
          addToast("Translation failed. Check connection and try again.", "error");
      }
  };


  const filteredVoters = useMemo(() => {
    const currentList = allVoters || [];
    return currentList.filter(voter => {
      let matchesSearch = false;
      
      if (exactIdSearch && searchTerm) {
         matchesSearch = voter.id.toLowerCase() === searchTerm.toLowerCase();
      } else {
         matchesSearch = 
           voter.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
           voter.nameEn?.toLowerCase().includes(searchTerm.toLowerCase()) ||
           voter.id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
           voter.houseNo?.toLowerCase().includes(searchTerm.toLowerCase());
      }
      
      const matchesGender = genderFilter === 'All' || 
        (genderFilter === 'Male' && (voter.gender === 'पुरुष' || voter.gender === 'Male')) ||
        (genderFilter === 'Female' && (voter.gender === 'महिला' || voter.gender === 'Female'));

      const matchesStatus = statusFilter === 'All' || 
        (statusFilter === 'Active' && !voter.status) ||
        (statusFilter === 'Deleted' && voter.status === 'DELETED');

      return matchesSearch && matchesGender && matchesStatus;
    });
  }, [allVoters, searchTerm, exactIdSearch, genderFilter, statusFilter]);

  const sortedVoters = useMemo(() => {
    let sortableItems = [...filteredVoters];
    if (sortConfig.key !== null) {
      sortableItems.sort((a, b) => {
        // @ts-ignore
        const aValue = a[sortConfig.key!] as string | number;
        // @ts-ignore
        const bValue = b[sortConfig.key!] as string | number;
        
        if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return sortableItems;
  }, [filteredVoters, sortConfig]);

  const paginatedVoters = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return sortedVoters.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [sortedVoters, currentPage]);

  const totalPages = Math.ceil(sortedVoters.length / ITEMS_PER_PAGE);

  const stats = useMemo(() => {
    const total = filteredVoters.length;
    const male = filteredVoters.filter(v => v.gender === 'पुरुष' || v.gender === 'Male').length;
    const female = filteredVoters.filter(v => v.gender === 'महिला' || v.gender === 'Female').length;
    const deleted = filteredVoters.filter(v => v.status === 'DELETED').length;
    const avgAge = total > 0 ? Math.round(filteredVoters.reduce((acc, curr) => acc + curr.age, 0) / total) : 0;
    const avgConfidence = total > 0 ? Math.round(filteredVoters.reduce((acc, curr) => acc + (curr.confidenceScore || 100), 0) / total) : 100;

    return { total, male, female, avgAge, deleted, avgConfidence };
  }, [filteredVoters]);

  const handleSort = (key: SortKey) => {
    let direction: SortDirection = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const executeExport = (config: ExportConfig) => {
    const sourceData = config.scope === 'filtered' ? sortedVoters : (allVoters || []);
    const dateStr = new Date().toISOString().slice(0, 10);

    // CSV EXPORT LOGIC
    if (config.format === 'csv') {
        const headerRow = config.columns.map(c => c.label).join(',');
        const rows = sourceData.map(v => {
          return config.columns.map(col => {
            const val = v[col.key as keyof Voter];
            return `"${val || ''}"`;
          }).join(',');
        });
        const csvContent = [headerRow, ...rows].join('\n');
        // BOM for Excel compatibility with UTF-8 CSVs
        const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `voter_export_${dateStr}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } 
    // EXCEL (XLS) EXPORT LOGIC - HTML Table Method
    else {
        const header = config.columns.map(c => `<th>${c.label}</th>`).join('');
        const rows = sourceData.map(v => 
          `<tr>${config.columns.map(c => {
             // Correctly iterate with 'c' instead of using undefined 'col'
             const val = v[c.key as keyof Voter];
             return `<td>${val || ''}</td>`;
          }).join('')}</tr>`
        ).join('');
        
        const html = `
          <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
          <head>
            <!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Voters</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
            <meta charset="UTF-8">
            <style>td { mso-number-format:"\@"; } </style>
          </head>
          <body>
            <table>
              <thead><tr>${header}</tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </body>
          </html>
        `;
        
        const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `voter_export_${dateStr}.xls`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
    
    setShowExportModal(false);
    addToast("Export started", 'success');
  };

  const resetFilters = () => {
    setSearchTerm('');
    setExactIdSearch(false);
    setGenderFilter('All');
    setStatusFilter('All');
    setCurrentPage(1);
  };

  const SortableHeader = ({ label, sortKey, align = 'left' }: { label: string, sortKey: SortKey, align?: 'left'|'center'|'right' }) => (
    <th scope="col" className={`px-6 py-4 text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider cursor-pointer hover:bg-slate-100/50 dark:hover:bg-slate-800/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors group select-none whitespace-nowrap text-${align}`} onClick={() => handleSort(sortKey)} tabIndex={0} onKeyDown={(e) => { if(e.key === 'Enter') handleSort(sortKey) }} aria-sort={sortConfig.key === sortKey ? (sortConfig.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <div className={`flex items-center gap-2 ${align === 'right' ? 'justify-end' : ''}`}>
        {label}
        <span className="text-slate-300 dark:text-slate-600 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
          {sortConfig.key === sortKey ? (
            sortConfig.direction === 'asc' ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />
          ) : (
            <ArrowUpDown className="w-3.5 h-3.5" />
          )}
        </span>
      </div>
    </th>
  );

  return (
    <div className="min-h-screen bg-slate-50/50 dark:bg-slate-950 transition-colors duration-300">
      
      {/* HEADER */}
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-30 shadow-sm backdrop-blur-xl bg-white/90 dark:bg-slate-900/90 transition-colors">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-br from-indigo-600 to-violet-600 p-2.5 rounded-xl shadow-lg shadow-indigo-200 dark:shadow-none">
              <FileText className="text-white w-5 h-5" />
            </div>
            <div>
               <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight leading-none">VoterAlign</h1>
               <div className="flex items-center gap-2 mt-0.5">
                   <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">Election Data</p>
                   <span className="w-1 h-1 bg-slate-300 dark:bg-slate-600 rounded-full"></span>
                   <p className="text-xs text-indigo-600 dark:text-indigo-400 font-bold">{user.username} ({user.role})</p>
               </div>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            
            {/* Speed Profile Selector */}
            <div className="hidden lg:flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-full border border-slate-200 dark:border-slate-700">
                <button 
                    onClick={() => changeSpeedProfile('safe')}
                    className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-all ${speedProfile === 'safe' ? 'bg-emerald-500 text-white shadow' : 'text-slate-500 hover:text-emerald-600'}`}
                    title="Safe: For 20 simultaneous users"
                >
                    🛡️ Safe
                </button>
                <button 
                    onClick={() => changeSpeedProfile('balanced')}
                    className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-all ${speedProfile === 'balanced' ? 'bg-blue-500 text-white shadow' : 'text-slate-500 hover:text-blue-600'}`}
                    title="Balanced: For ~10 active users"
                >
                    ⚖️ Balanced
                </button>
                <button 
                    onClick={() => changeSpeedProfile('turbo')}
                    className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-all ${speedProfile === 'turbo' ? 'bg-orange-500 text-white shadow' : 'text-slate-500 hover:text-orange-600'}`}
                    title="Turbo: FASTEST - For 1-3 active users only!"
                >
                    🚀 Turbo
                </button>
            </div>

            {/* Cost Calculator Button */}
            <button 
                onClick={() => setShowCostCalc(!showCostCalc)} 
                className={`hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${showCostCalc ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'}`}
            >
                <Calculator className="w-3.5 h-3.5" />
                Cost Est.
            </button>

            {/* Live Save Indicator/Toggle */}
            {isLiveSaveActive ? (
                <button onClick={handleDisableLiveSave} className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-red-50 text-red-700 border border-red-200 animate-pulse hover:bg-red-100 transition-colors" title="Click to Stop Saving">
                    <div className="w-2 h-2 rounded-full bg-red-600"></div>
                    REC: Live Saving
                </button>
            ) : (
                <button onClick={handleEnableLiveSave} className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors" title="Enable Live Save to Disk">
                    <HardDrive className="w-3.5 h-3.5" />
                    Live Save Off
                </button>
            )}

            {user.role === 'admin' && (
                <button
                    onClick={() => setShowUserModal(true)}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-900/30 dark:border-indigo-800 dark:text-indigo-400"
                    title="Manage Users & View Employee Activity"
                >
                    <Users className="w-3.5 h-3.5" />
                    👥 Users
                </button>
            )}

            {user.role === 'admin' && (
                <button
                    onClick={() => setShowApiKeyModal(true)}
                    className={`hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${apiKey ? 'bg-indigo-50 border-indigo-200 text-indigo-700 dark:bg-indigo-900/30 dark:border-indigo-800 dark:text-indigo-400' : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400'}`}
                    title="Configure Gemini API Key"
                >
                    <Key className="w-3.5 h-3.5" />
                    {apiKey ? 'API Key Set' : 'Set API Key'}
                </button>
            )}

            <button onClick={() => setIsDarkMode(!isDarkMode)} className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors">
              {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
            
            <button onClick={onLogout} className="p-2 rounded-full hover:bg-rose-50 dark:hover:bg-rose-900/20 text-slate-500 hover:text-rose-600 transition-colors" title="Logout">
                <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
        
        {/* Cost Calculator Dropdown */}
        {showCostCalc && (
            <div className="absolute right-4 md:right-32 top-16 w-80 bg-white dark:bg-slate-900 rounded-xl shadow-xl border border-slate-100 dark:border-slate-800 p-4 z-40 animate-in slide-in-from-top-2">
                <h3 className="text-sm font-bold text-slate-800 dark:text-white mb-3">💰 Cost Estimator (Gemini 2.5 Flash)</h3>
                <div className="space-y-3">
                    {/* Current Data Stats */}
                    <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-lg">
                        <p className="text-xs text-slate-500 mb-2">Current Data</p>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                            <div className="flex justify-between">
                                <span className="text-slate-600 dark:text-slate-400">Voters:</span>
                                <span className="font-mono font-bold text-slate-800 dark:text-white">{stats.total.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-slate-600 dark:text-slate-400">Est. Pages:</span>
                                <span className="font-mono font-bold text-slate-800 dark:text-white">{Math.ceil(stats.total / 30)}</span>
                            </div>
                        </div>
                    </div>
                    
                    {/* Cost Calculation */}
                    <div className="bg-emerald-50 dark:bg-emerald-900/20 p-3 rounded-lg border border-emerald-200 dark:border-emerald-800">
                        <p className="text-xs text-emerald-600 dark:text-emerald-400 mb-1">Estimated Processing Cost</p>
                        <div className="flex items-baseline gap-2">
                            <span className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                                ₹{(() => {
                                    // Gemini 2.5 Flash: $0.075/1M input tokens, $0.30/1M output
                                    // ~800 tokens per page (image + prompt), ~500 output tokens
                                    const pages = Math.ceil(stats.total / 30);
                                    const inputTokens = pages * 800;
                                    const outputTokens = pages * 500;
                                    const inputCostUSD = (inputTokens / 1000000) * 0.075;
                                    const outputCostUSD = (outputTokens / 1000000) * 0.30;
                                    const totalUSD = inputCostUSD + outputCostUSD;
                                    const totalINR = totalUSD * 84; // USD to INR
                                    return totalINR.toFixed(2);
                                })()}
                            </span>
                            <span className="text-sm text-emerald-500">INR</span>
                        </div>
                        <p className="text-xs text-emerald-600/70 mt-1">
                            (~${(() => {
                                const pages = Math.ceil(stats.total / 30);
                                const inputTokens = pages * 800;
                                const outputTokens = pages * 500;
                                const inputCostUSD = (inputTokens / 1000000) * 0.075;
                                const outputCostUSD = (outputTokens / 1000000) * 0.30;
                                return (inputCostUSD + outputCostUSD).toFixed(3);
                            })()} USD)
                        </p>
                    </div>
                    
                    {/* Per PDF Estimate */}
                    <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg">
                        <p className="text-xs text-blue-600 dark:text-blue-400 mb-2">📄 Per PDF Estimate (36 pages)</p>
                        <div className="flex justify-between text-sm">
                            <span className="text-slate-600 dark:text-slate-400">~1,080 voters:</span>
                            <span className="font-bold text-blue-600 dark:text-blue-400">₹{((36 * 800 / 1000000 * 0.075 + 36 * 500 / 1000000 * 0.30) * 84).toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-sm mt-1">
                            <span className="text-slate-600 dark:text-slate-400">~100 pages PDF:</span>
                            <span className="font-bold text-blue-600 dark:text-blue-400">₹{((100 * 800 / 1000000 * 0.075 + 100 * 500 / 1000000 * 0.30) * 84).toFixed(2)}</span>
                        </div>
                    </div>
                    
                    <p className="text-[10px] text-slate-400 leading-tight">
                        💡 Based on Gemini 2.5 Flash ($0.075/1M input, $0.30/1M output). 
                        Paid tier required for high speed (2000 RPM).
                    </p>
                </div>
            </div>
        )}
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 pb-32">
        
        {/* STATS GRID */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard 
            title="Total Voters" 
            value={stats.total.toLocaleString()} 
            icon={<Users className="w-6 h-6" />}
            subLabel="Registered in list"
          />
          <StatCard 
            title="Avg Accuracy" 
            value={`${stats.avgConfidence}%`} 
            icon={stats.avgConfidence > 90 ? <ShieldCheck className="w-6 h-6 text-emerald-500" /> : <ShieldAlert className="w-6 h-6 text-amber-500" />} 
            subLabel="AI Confidence Score"
            trend={stats.avgConfidence > 90 ? 'up' : 'down'}
          />
          <StatCard 
            title="Gender Ratio" 
            value={`${Math.round((stats.male/stats.total)*100 || 0)}%`} 
            icon={<PieChart className="w-6 h-6" />} 
            subLabel={`${stats.male} M · ${stats.female} F`}
          />
          <StatCard 
            title="Inactive" 
            value={stats.deleted} 
            icon={<AlertCircle className="w-6 h-6" />} 
            subLabel="Deleted or moved"
          />
        </div>

        {/* CONTROLS BAR */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 p-5 flex flex-col xl:flex-row gap-5 justify-between items-start xl:items-center transition-colors">
          
          {/* Search */}
          <div className="relative w-full xl:w-96 group">
            <label htmlFor="search" className="sr-only">Search</label>
            <div className="flex gap-2">
               <input
                id="search"
                type="text"
                placeholder={exactIdSearch ? "Enter Exact ID..." : "Search name, ID, house..."}
                className="pl-11 pr-4 py-3 border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-xl focus:bg-white dark:focus:bg-slate-900 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 w-full outline-none transition-all placeholder:text-slate-400 dark:placeholder:text-slate-500 font-medium text-sm text-slate-700 dark:text-slate-200"
                value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
              />
              <button 
                onClick={() => setExactIdSearch(!exactIdSearch)}
                className={`p-3 rounded-xl border transition-all ${exactIdSearch ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400 hover:text-indigo-600'}`}
                title="Toggle Exact ID Search"
              >
                <ScanLine className="w-4 h-4" />
              </button>
            </div>
            <Search className="absolute left-4 top-3.5 w-4 h-4 text-slate-400 dark:text-slate-500 group-focus-within:text-indigo-500 transition-colors" />
          </div>

          {/* Filters & Actions */}
          <div className="flex flex-col sm:flex-row flex-wrap items-center gap-3 w-full xl:w-auto">
            
            {/* UNDO / REDO */}
            <div className="flex items-center gap-1 bg-slate-50 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
               <button onClick={undo} disabled={historyIndex === 0} className="p-2 text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-white dark:hover:bg-slate-700 rounded-lg disabled:opacity-30 disabled:hover:bg-transparent transition-all" aria-label="Undo">
                 <RotateCcw className="w-4 h-4" />
               </button>
               <button onClick={redo} disabled={historyIndex === history.length - 1} className="p-2 text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-white dark:hover:bg-slate-700 rounded-lg disabled:opacity-30 disabled:hover:bg-transparent transition-all" aria-label="Redo">
                 <RotateCw className="w-4 h-4" />
               </button>
            </div>

            <div className="flex items-center gap-3 w-full sm:w-auto bg-slate-50 dark:bg-slate-800 p-1.5 rounded-xl border border-slate-200 dark:border-slate-700">
               <div className="flex items-center px-2">
                 <Filter className="w-4 h-4 text-slate-400 dark:text-slate-500" />
               </div>
               <label htmlFor="genderFilter" className="sr-only">Filter by Gender</label>
               <select id="genderFilter" className="bg-transparent text-sm font-medium text-slate-600 dark:text-slate-300 outline-none cursor-pointer hover:text-indigo-600 dark:hover:text-indigo-400" value={genderFilter} onChange={(e) => { setGenderFilter(e.target.value); setCurrentPage(1); }}>
                <option value="All">All Genders</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
              </select>
              <div className="w-px h-4 bg-slate-300 dark:bg-slate-600"></div>
              <label htmlFor="statusFilter" className="sr-only">Filter by Status</label>
              <select id="statusFilter" className="bg-transparent text-sm font-medium text-slate-600 dark:text-slate-300 outline-none cursor-pointer hover:text-indigo-600 dark:hover:text-indigo-400" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setCurrentPage(1); }}>
                <option value="All">All Status</option>
                <option value="Active">Active</option>
                <option value="Deleted">Deleted</option>
              </select>
            </div>

            <div className="flex-1"></div>

            <div className="flex items-center gap-3 w-full sm:w-auto">
               <button onClick={handleFindDuplicates} className="hidden lg:flex items-center justify-center gap-2 bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800 px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors" title="Find duplicate voters">
                 <Users className="w-4 h-4" />
                 Find Duplicates
               </button>

               <button onClick={handleValidateData} className="hidden lg:flex items-center justify-center gap-2 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors" title="Validate data quality">
                 <ShieldCheck className="w-4 h-4" />
                 Validate
               </button>

               <button onClick={selectAllFilteredVoters} className="hidden lg:flex items-center justify-center gap-2 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors" title="Select all filtered records">
                 <CheckSquare className="w-4 h-4" />
                 Select All ({filteredVoters.length})
               </button>

               {/* Delete Button - Admins delete all, Employees delete their own */}
               <button onClick={handleDeleteAllFiltered} className="hidden lg:flex items-center justify-center gap-2 bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800 px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-rose-100 dark:hover:bg-rose-900/40 transition-colors" title={user.role === 'admin' ? 'Delete all filtered records' : 'Delete your own extracted records'}>
                 <Trash className="w-4 h-4" />
                 {user.role === 'admin' ? `Delete All (${filteredVoters.length})` : `Delete My Data (${myRecordsCount})`}
               </button>

               <button onClick={handleBulkTranslateMissing} className="hidden lg:flex items-center justify-center gap-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors" title="Auto-translate missing English names (FREE or Gemini)">
                 <Languages className="w-4 h-4" />
                 Translate
               </button>

               <button onClick={() => setShowCreateModal(true)} className="flex items-center justify-center gap-2 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-800 px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors">
                 <Plus className="w-4 h-4" />
                 New
               </button>
            
              {/* UNIFIED IMPORT / SCAN BUTTON */}
              <label tabIndex={0} onKeyDown={(e) => { if(e.key === 'Enter') e.currentTarget.click() }} className={`flex-1 sm:flex-none flex items-center justify-center gap-2 bg-slate-900 dark:bg-indigo-600 hover:bg-slate-800 dark:hover:bg-indigo-700 text-white border border-transparent shadow-md shadow-slate-200 dark:shadow-none hover:shadow-lg px-6 py-2.5 rounded-xl text-sm font-semibold transition-all cursor-pointer focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${isProcessing ? 'opacity-50 pointer-events-none' : ''}`}>
                {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                Add Data
                <input 
                  type="file" 
                  accept=".csv, .pdf, image/*" 
                  className="hidden" 
                  onChange={handleUnifiedUpload} 
                  disabled={isProcessing} 
                />
              </label>

              <button onClick={() => setShowExportModal(true)} className="p-2.5 text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-slate-800 rounded-xl transition-colors focus:ring-2 focus:ring-indigo-500" aria-label="Export CSV Options" title="Export CSV">
                <Settings className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

        {/* BULK ACTIONS BAR (Floating) */}
        {selectedIds.size > 0 && (
          <div className="fixed bottom-8 left-1/2 transform -translate-x-1/2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-6 z-40 animate-in slide-in-from-bottom-5 fade-in duration-300">
            <div className="flex items-center gap-3 font-medium text-sm border-r border-slate-700 dark:border-slate-200 pr-6">
              <div className="bg-indigo-600 text-white w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold">
                {selectedIds.size}
              </div>
              Selected
            </div>
            <div className="flex items-center gap-2">
              {/* Delete button - Admins delete all selected, Employees delete only their own selected */}
              <button onClick={handleBulkDelete} className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-800 dark:hover:bg-slate-100 rounded-lg transition-colors text-sm font-medium text-rose-400 hover:text-rose-300 dark:text-rose-600 dark:hover:text-rose-700" title={user.role === 'admin' ? 'Delete all selected' : 'Delete your selected records'}>
                <Trash className="w-4 h-4" />
                Delete
              </button>
              <div className="w-px h-4 bg-slate-700 dark:bg-slate-200"></div>
               <button onClick={() => handleBulkStatusChange('DELETED')} className="px-3 py-1.5 hover:bg-slate-800 dark:hover:bg-slate-100 rounded-lg text-slate-300 dark:text-slate-600 hover:text-white dark:hover:text-slate-900 transition-colors text-sm font-medium">
                Mark Deleted
              </button>
               <button onClick={() => handleBulkStatusChange('Active')} className="px-3 py-1.5 hover:bg-slate-800 dark:hover:bg-slate-100 rounded-lg text-slate-300 dark:text-slate-600 hover:text-white dark:hover:text-slate-900 transition-colors text-sm font-medium">
                Mark Active
              </button>
            </div>
            <button onClick={() => setSelectedIds(new Set())} className="ml-2 p-1 hover:bg-slate-800 dark:hover:bg-slate-100 rounded-full text-slate-400 dark:text-slate-500" aria-label="Clear Selection">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* TABLE CARD */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden transition-colors">
          <div className="overflow-x-auto relative">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-50/90 dark:bg-slate-900/90 backdrop-blur-md sticky top-0 z-20 shadow-sm border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th scope="col" className="px-4 py-4 w-12 text-center">
                    <button 
                      onClick={toggleSelectAll} 
                      className="text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded" 
                      aria-label="Select All Visible Voters"
                      title="Select all visible voters"
                    >
                      {selectedIds.size > 0 && Array.from(selectedIds).some(id => paginatedVoters.some(v => generateCompositeId(v) === id)) ? 
                        <CheckSquare className="w-5 h-5 text-indigo-600 dark:text-indigo-400" /> : 
                        <Square className="w-5 h-5" />
                      }
                    </button>
                  </th>
                  <SortableHeader label="Voter Identity" sortKey="name" />
                  <SortableHeader label="Relative / House" sortKey="relativeName" />
                  <SortableHeader label="Demographics" sortKey="age" />
                  <SortableHeader label="Status" sortKey="status" />
                  <SortableHeader label="Accuracy" sortKey="confidenceScore" />
                  <th scope="col" className="px-6 py-4 text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {paginatedVoters.length > 0 ? (
                  paginatedVoters.map((voter, index) => {
                    const cid = generateCompositeId(voter);
                    const isSelected = selectedIds.has(cid);
                    const confidence = voter.confidenceScore || 100;
                    const isLowConfidence = confidence < 80;

                    return (
                      <tr key={`${voter.id}-${index}`} className={`group transition-colors ${isSelected ? 'bg-indigo-50/50 dark:bg-indigo-900/10 hover:bg-indigo-50 dark:hover:bg-indigo-900/20' : isLowConfidence ? 'bg-amber-50/40 dark:bg-amber-900/10 hover:bg-amber-50 dark:hover:bg-amber-900/20 border-l-2 border-l-amber-500' : 'hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
                        <td className="px-4 py-4 text-center">
                           <button onClick={() => toggleSelection(voter)} className="text-slate-300 dark:text-slate-600 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors focus:outline-none" aria-label={`Select ${voter.name}`}>
                             {isSelected ? <CheckSquare className="w-5 h-5 text-indigo-600 dark:text-indigo-400" /> : <Square className="w-5 h-5" />}
                           </button>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <Avatar name={voter.nameEn || voter.name} />
                            <div>
                              <div className="text-sm font-semibold text-slate-900 dark:text-slate-200 flex flex-col">
                                {voter.nameEn && voter.nameEn !== voter.name ? (
                                     <>
                                       <span>{voter.nameEn}</span>
                                       <span className="text-xs font-normal text-slate-500 dark:text-slate-400">{voter.name}</span>
                                     </>
                                ) : (
                                     <span>{voter.name}</span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 mt-0.5">
                                {isLowConfidence && <span title="Low confidence extraction. Please verify."><AlertTriangle className="w-3.5 h-3.5 text-amber-500" /></span>}
                                <span className="text-[10px] font-mono font-medium text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">ID: {voter.id}</span>
                                <span className="text-[10px] text-slate-400 dark:text-slate-500">#{voter.serialNo}</span>
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm text-slate-600 dark:text-slate-400 mb-0.5 flex flex-col">
                             {voter.relativeNameEn && voter.relativeNameEn !== voter.relativeName ? (
                                <>
                                  <span className="font-medium text-slate-700 dark:text-slate-300">{voter.relativeNameEn}</span>
                                  <span className="text-xs text-slate-400 dark:text-slate-500">{voter.relativeName}</span>
                                </>
                             ) : (
                                <span>{voter.relativeName}</span>
                             )}
                          </div>
                          <div className="flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500 mt-1">
                            <Home className="w-3 h-3" />
                            House {voter.houseNo || 'N/A'}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <Badge variant={voter.gender.includes("Male") || voter.gender.includes("पुरुष") ? 'blue' : voter.gender.includes("Female") || voter.gender.includes("महिला") ? 'purple' : 'neutral'}>
                              {voter.gender}
                            </Badge>
                            <span className="text-sm text-slate-600 dark:text-slate-400">{voter.age} yrs</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          {voter.status === 'DELETED' ? (
                            <Badge variant="danger">Deleted</Badge>
                          ) : (
                            <Badge variant="success">Active</Badge>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2" title={`${confidence}% confidence`}>
                             <div className="w-16 h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                               <div className={`h-full rounded-full ${confidence > 90 ? 'bg-emerald-500' : confidence > 75 ? 'bg-amber-500' : 'bg-rose-500'}`} style={{width: `${confidence}%`}}></div>
                             </div>
                             <span className={`text-xs font-medium ${confidence > 90 ? 'text-emerald-600' : confidence > 75 ? 'text-amber-600' : 'text-rose-600'}`}>{confidence}%</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right">
                          {/* Employees can only edit their own records */}
                          {(user.role === 'admin' || voter.extractedBy === user.username) ? (
                            <button 
                              onClick={() => setSelectedVoter(voter)} 
                              className="p-2 text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-slate-700 rounded-lg transition-all opacity-0 group-hover:opacity-100 focus:opacity-100 focus:ring-2 focus:ring-indigo-500"
                              aria-label={`Edit ${voter.name}`}
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>
                          ) : (
                            <span className="p-2 text-slate-300 dark:text-slate-600 opacity-0 group-hover:opacity-100" title="Only the employee who extracted this can edit it">
                              <Lock className="w-4 h-4" />
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={7} className="px-6 py-16 text-center">
                      <div className="flex flex-col items-center justify-center max-w-sm mx-auto">
                        <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mb-4 text-slate-400 dark:text-slate-500">
                          <Search className="w-8 h-8" />
                        </div>
                        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-200 mb-1">No voters found</h3>
                        <p className="text-slate-500 dark:text-slate-400 text-sm mb-6">We couldn't find any records matching your search or filters.</p>
                        <button onClick={resetFilters} className="text-indigo-600 dark:text-indigo-400 font-medium text-sm hover:underline focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded">Clear all filters</button>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          
          {/* PAGINATION */}
          <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex items-center justify-between transition-colors">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Showing <span className="font-semibold text-slate-700 dark:text-slate-300">{(currentPage - 1) * ITEMS_PER_PAGE + 1}</span> - <span className="font-semibold text-slate-700 dark:text-slate-300">{Math.min(currentPage * ITEMS_PER_PAGE, sortedVoters.length)}</span> of <span className="font-semibold text-slate-700 dark:text-slate-300">{sortedVoters.length}</span>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="p-2 rounded-lg hover:bg-white dark:hover:bg-slate-800 hover:shadow-sm text-slate-500 dark:text-slate-400 disabled:opacity-30 disabled:hover:shadow-none transition-all focus:ring-2 focus:ring-indigo-500" aria-label="Previous Page">
                <ChevronLeft className="w-4 h-4" />
              </button>
              
              <div className="flex items-center gap-1 mx-2">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum = i + 1;
                  if (totalPages > 5 && currentPage > 3) {
                     pageNum = currentPage - 2 + i;
                     if (pageNum > totalPages) pageNum = totalPages - (4 - i);
                  }
                  if (pageNum < 1) pageNum = 1; // Safety
                  
                  return (
                    <button key={pageNum} onClick={() => setCurrentPage(pageNum)} className={`w-8 h-8 rounded-lg text-xs font-semibold transition-all focus:ring-2 focus:ring-indigo-500 ${currentPage === pageNum ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200 dark:shadow-none' : 'text-slate-600 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-800 hover:shadow-sm'}`} aria-label={`Page ${pageNum}`} aria-current={currentPage === pageNum ? 'page' : undefined}>
                      {pageNum}
                    </button>
                  );
                })}
              </div>

              <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages || totalPages === 0} className="p-2 rounded-lg hover:bg-white dark:hover:bg-slate-800 hover:shadow-sm text-slate-500 dark:text-slate-400 disabled:opacity-30 disabled:hover:shadow-none transition-all focus:ring-2 focus:ring-indigo-500" aria-label="Next Page">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* TOASTS CONTAINER */}       
      <div className="fixed bottom-0 right-0 p-6 z-50 pointer-events-none">
        <div className="flex flex-col gap-3 pointer-events-auto">
          {toasts.map(toast => (
            <Toast key={toast.id} message={toast.message} type={toast.type} onClose={() => removeToast(toast.id)} />
          ))}
        </div>
      </div>

      {selectedVoter && <VoterFormModal voter={selectedVoter} mode="edit" onClose={() => setSelectedVoter(null)} onSave={handleUpdateVoter} />}
      {showCreateModal && <VoterFormModal mode="create" onClose={() => setShowCreateModal(false)} onSave={handleCreateVoter} />}
      
      {isProcessing && <UploadProgressModal progress={processProgress} totalVoters={newVoterCount} isComplete={isProcessComplete} onClose={closeProcessModal} title={processTitle} fileName={currentFileName} detail={processDetail} eta={processEta} batchAccuracy={lastImportStats?.avgConfidence} />}
      {showExportModal && <ExportModal onClose={() => setShowExportModal(false)} onExport={executeExport} onClear={handleClearAllData} isAdmin={user.role === 'admin'} myRecordsCount={myRecordsCount} />}
      {showApiKeyModal && <ApiKeyModal onClose={() => setShowApiKeyModal(false)} onSave={handleSaveApiKey} />}
      {showUserModal && <UserManagementModal onClose={() => setShowUserModal(false)} />}
    </div>
  );
};

const App = () => {
    const [user, setUser] = useState<UserAccount | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    // Persist session - but always show login screen on fresh start for employees
    useEffect(() => {
        const checkSession = async () => {
            try {
                const sessionUser = localStorage.getItem('VOTER_APP_SESSION');
                if(sessionUser) {
                    const parsed = JSON.parse(sessionUser);
                    // Only auto-restore admin sessions (employees should always login fresh)
                    if (parsed.role === 'admin') {
                        // Verify admin still exists in users list
                        const users = getUsers();
                        const validAdmin = users.find(u => u.username === parsed.username && u.role === 'admin');
                        if (validAdmin) {
                            setUser(parsed);
                        } else {
                            localStorage.removeItem('VOTER_APP_SESSION');
                        }
                    } else {
                        // Clear employee session - they need to login each time
                        localStorage.removeItem('VOTER_APP_SESSION');
                    }
                }
            } catch (e) {
                console.error('Session check error:', e);
                localStorage.removeItem('VOTER_APP_SESSION');
            } finally {
                setIsLoading(false);
            }
        };
        // Small delay to ensure localStorage is ready
        setTimeout(checkSession, 100);
    }, []);

    const handleLogin = (loggedInUser: UserAccount) => {
        setUser(loggedInUser);
        localStorage.setItem('VOTER_APP_SESSION', JSON.stringify(loggedInUser));
    };

    const handleLogout = () => {
        setUser(null);
        localStorage.removeItem('VOTER_APP_SESSION');
    };

    // Show loading spinner while checking session
    if (isLoading) {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col justify-center items-center">
                <div className="bg-gradient-to-br from-indigo-600 to-violet-600 w-16 h-16 rounded-2xl flex items-center justify-center shadow-xl shadow-indigo-200 dark:shadow-none mb-4 animate-pulse">
                    <FileText className="text-white w-8 h-8" />
                </div>
                <p className="text-slate-500 dark:text-slate-400 animate-pulse">Loading VoterAlign Pro...</p>
            </div>
        );
    }

    if (!user) {
        return <LoginScreen onLogin={handleLogin} />;
    }

    return <Dashboard user={user} onLogout={handleLogout} />;
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);