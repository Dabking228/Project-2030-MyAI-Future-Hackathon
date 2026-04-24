import { initializeApp, getApps, FirebaseApp } from "firebase/app";
import {
  getFunctions,
  Functions,
  connectFunctionsEmulator,
} from "firebase/functions";

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? "",
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? "",
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "",
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_ID ?? "",
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? "",
};

const app: FirebaseApp =
  getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

// Functions instance — region must match Cloud Function deployment region
export const functions: Functions = getFunctions(app, "us-central1");

// Point to local emulator when running locally
// Expo sets EXPO_PUBLIC_USE_EMULATOR=true in .env.local for local dev
if (process.env.EXPO_PUBLIC_USE_EMULATOR === "true") {
  const host = process.env.EXPO_PUBLIC_EMULATOR_HOST || "localhost";
  connectFunctionsEmulator(functions, host, 5001);
}

export default app;
