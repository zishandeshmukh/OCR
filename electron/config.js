// Configuration file for VoterAlign Pro Desktop App
// This file stores the shared API key and app settings

module.exports = {
  // ===========================================
  // API CONFIGURATION (SHARED ACROSS ALL PCs)
  // ===========================================
  
  // Your Paid Gemini API Key - This will be embedded in the app
  // All 10 computers will use this same key
  GEMINI_API_KEY: 'AIzaSyBM_EBIoCLHRpllWDfU6ToxNXHkjy3u-OE',
  
  // ===========================================
  // RATE LIMITING SETTINGS
  // ===========================================
  
  // Paid tier allows 2000 RPM total
  // With 10 computers: 2000 / 10 = 200 RPM per computer (safe margin)
  // We use conservative settings to prevent hitting limits
  
  CONCURRENCY_PER_MACHINE: 15,  // Max parallel API requests per computer
  DELAY_BETWEEN_PAGES_MS: 100,  // Small delay to spread out requests
  MAX_RETRIES: 2,
  
  // ===========================================
  // PROCESSING SETTINGS
  // ===========================================
  
  IMAGE_RENDER_SCALE: 1.5,     // Balance between quality and speed
  JPEG_QUALITY: 0.65,          // Image compression quality
  MAX_PAGES_PER_BATCH: 50,     // Maximum pages to process at once
  
  // ===========================================
  // APP SETTINGS
  // ===========================================
  
  APP_NAME: 'VoterAlign Pro',
  APP_VERSION: '1.0.0',
  COMPANY_NAME: 'Election Data Systems',
  
  // Auto-save interval (milliseconds)
  AUTO_SAVE_INTERVAL: 30000,   // 30 seconds
  
  // Maximum records before disabling undo/redo (memory optimization)
  MAX_RECORDS_FOR_UNDO: 5000,
  
  // ===========================================
  // ADMIN SETTINGS
  // ===========================================
  
  // Default admin credentials (change these!)
  DEFAULT_ADMIN: {
    username: 'admin',
    password: 'admin123'  // Change this to a strong password!
  },
  
  // Enable/disable features for employees
  EMPLOYEE_PERMISSIONS: {
    canImportPDF: true,
    canExportData: true,
    canDeleteRecords: false,  // Only admin can bulk delete
    canClearDatabase: false,  // Only admin can clear all data
    canChangeAPIKey: false    // Only admin can modify API settings
  }
};
