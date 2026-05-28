import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyDt4gTL-KqWyBPC2777wH4s-t6cAmGoEwY",
  authDomain: "ets-vandaele.firebaseapp.com",
  projectId: "ets-vandaele",
  storageBucket: "ets-vandaele.firebasestorage.app",
  messagingSenderId: "1027752944412",
  appId: "1:1027752944412:web:8242cf5452db79bac810d9",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
