
const crypto = require("crypto");

// ── Par RSA-2048 ──────────────────────────────────────────────
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding:  { type: "spki",  format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

// Convertir saltos de línea a \n para almacenar en .env en una sola línea
const toEnvLine = (pem) => pem.replace(/\n/g, "\\n");

console.log("# VARIABLES PARA .ENV GENERADAS:");
console.log(`RSA_PRIVATE_KEY="${toEnvLine(privateKey)}"`);
console.log(`RSA_PUBLIC_KEY="${toEnvLine(publicKey)}"`);

