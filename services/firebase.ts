import { getApp, getApps, initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  getAuth,
  GoogleAuthProvider,
  initializeAuth,
  browserPopupRedirectResolver,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyANLsms4NhwUfEVm5EsMwtmpeStP8FhASk",
  authDomain: "newwattwalker.firebaseapp.com",
  projectId: "newwattwalker",
  storageBucket: "newwattwalker.firebasestorage.app",
  messagingSenderId: "459814369556",
  appId: "1:459814369556:web:5515d7fbb763b50fc22a01",
  measurementId: "G-MKSR95NW1C"
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

/**
 * Capacitor iOS WKWebView often misbehaves with default IndexedDB auth persistence;
 * browserLocalPersistence avoids some hangs on signInWithEmailAndPassword.
 */
function initAuth() {
  try {
    return initializeAuth(app, { 
      persistence: browserLocalPersistence,
      popupRedirectResolver: browserPopupRedirectResolver
    });
  } catch (e: unknown) {
    const code =
      typeof e === "object" && e !== null && "code" in e
        ? String((e as { code: unknown }).code)
        : "";
    if (code === "auth/already-initialized") {
      return getAuth(app);
    }
    throw e;
  }
}

export const auth = initAuth();
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();
