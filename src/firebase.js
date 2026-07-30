import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { doc, getDoc, getFirestore, setDoc } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const app = initializeApp({ projectId: "rio-en-alerta-sanfernando", appId: "1:241546874418:web:36ac924c7b055ba3a3b62b", apiKey: "AIzaSyCmA_YPVZtDR-mYNVvXWkqRxT_2kvYJYEA", authDomain: "rio-en-alerta-sanfernando.firebaseapp.com" });
const auth = getAuth(app);
const db = getFirestore(app);
let userPromise;
async function user() { return userPromise ??= signInAnonymously(auth).then(({ user }) => user); }
export async function loadCloudSettings() { const snapshot = await getDoc(doc(db, "alertSettings", (await user()).uid)); return snapshot.exists() ? snapshot.data() : null; }
export async function saveCloudSettings(settings) { await setDoc(doc(db, "alertSettings", (await user()).uid), settings, { merge: true }); }
