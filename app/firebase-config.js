/*
 * ========================================
 *  FIREBASE SETUP — follow these steps:
 * ========================================
 *
 *  1. Go to  https://console.firebase.google.com
 *  2. Click "Create a project" → name it (e.g. "mindset-stack")
 *  3. Disable Google Analytics (not needed) → Create project
 *
 *  Enable Google Sign-In:
 *  4. Go to  Build → Authentication → Get started
 *  5. Click "Google" → Enable it → add your email → Save
 *
 *  Create the Database:
 *  6. Go to  Build → Firestore Database → Create database
 *  7. Choose "Start in test mode" → pick closest region → Enable
 *
 *  Get your Config:
 *  8. Click the ⚙ gear icon (top-left) → Project settings
 *  9. Scroll down to "Your apps" → click the web icon (</>)
 * 10. Nickname: "Mindset Stack" → Register app
 * 11. Copy each value into the matching field below
 *
 *  SECURE YOUR DATABASE (do this after testing):
 *  Go to Firestore → Rules tab → replace with:
 *
 *    rules_version = '2';
 *    service cloud.firestore {
 *      match /databases/{database}/documents {
 *        match /users/{userId} {
 *          allow read, write: if request.auth != null
 *                             && request.auth.uid == userId;
 *        }
 *      }
 *    }
 *
 * ========================================
 */

const firebaseConfig = {
  apiKey:            "AIzaSyB2AWqOIc2H8HpbJzQHXvomE1rmPEnEHUg",
  authDomain:        "mindstack-c5a42.firebaseapp.com",
  projectId:         "mindstack-c5a42",
  storageBucket:     "mindstack-c5a42.firebasestorage.app",
  messagingSenderId: "620679823732",
  appId:             "1:620679823732:web:defadf6855cb8a2395ac21"
};
