import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const app = initializeApp({
  projectId: "rio-en-alerta-sanfernando",
  appId: "1:241546874418:web:36ac924c7b055ba3a3b62b",
  apiKey: "AIzaSyCmA_YPVZtDR-mYNVvXWkqRxT_2kvYJYEA",
  authDomain: "rio-en-alerta-sanfernando.firebaseapp.com",
});

export const auth = getAuth(app);
export const db = getFirestore(app);
