import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCY1Gx8Qz5sbhgXoDgwb3c29cd6wROcklw",
  authDomain: "tbp-portal-67c20.firebaseapp.com",
  projectId: "tbp-portal-67c20",
  storageBucket: "tbp-portal-67c20.firebasestorage.app",
  messagingSenderId: "830637510118",
  appId: "1:830637510118:web:39145957bed0ac31695a27"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();
export const db = getFirestore(app);
