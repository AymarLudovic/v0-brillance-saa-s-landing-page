import { initializeApp, getApps } from "firebase/app"
import { getAuth, GoogleAuthProvider } from "firebase/auth"
import { getFirestore } from "firebase/firestore"

const firebaseConfig = {
  apiKey: "AIzaSyDvWAR0JBl8U61rr_nXdU_E5eI6jZgcjbI",
  authDomain: "artboxx.firebaseapp.com",
  projectId: "artboxx",
  storageBucket: "artboxx.firebasestorage.app",
  messagingSenderId: "1031383618010",
  appId: "1:1031383618010:web:a760f5eeb5295b5e7d70e3",
}

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)
export const googleProvider = new GoogleAuthProvider()
  
