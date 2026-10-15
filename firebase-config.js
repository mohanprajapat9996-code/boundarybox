// Paste your Firebase Web App configuration here (Firebase Console > Project settings > Your apps).
// Firebase web config is not a password. Protect data with the included Firestore/Storage rules.
export const firebaseConfig = {
  apiKey: "PASTE_API_KEY_HERE",
  authDomain: "PASTE_PROJECT_ID_HERE.firebaseapp.com",
  projectId: "PASTE_PROJECT_ID_HERE",
  storageBucket: "PASTE_PROJECT_ID_HERE.firebasestorage.app",
  messagingSenderId: "PASTE_MESSAGING_SENDER_ID_HERE",
  appId: "PASTE_APP_ID_HERE"
};
// Must exactly match the administrator email used in firestore.rules and storage.rules.
export const ADMIN_EMAIL = "YOUR_ADMIN_EMAIL@example.com";
