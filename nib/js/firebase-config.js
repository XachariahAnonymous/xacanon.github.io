/* =====================================================================
   LOLCOIN TCG — Firebase config  (Spark / free plan; client-only)
   The apiKey is PUBLIC by design (identifies the project; it does not
   grant data access — Firestore Rules do). Safe to commit/host.
   Set enabled:false to fall back to the offline localStorage demo.
   ===================================================================== */
window.NIB_CONFIG = {
  enabled: true,

  firebase: {
    apiKey: "AIzaSyD609wYA3dI9IutiR34hZRd2o0N7x8u5R4",
    authDomain: "nibcoin.firebaseapp.com",
    projectId: "nibcoin",
    storageBucket: "nibcoin.firebasestorage.app",
    messagingSenderId: "701297194479",
    appId: "1:701297194479:web:27f19de64fcdb8b0db321a",
    measurementId: "G-FXPLQRLLFV",
  },
};
