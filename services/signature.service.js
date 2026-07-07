
const crypto = require("crypto");

function getPrivateKey() {
  const key = process.env.RSA_PRIVATE_KEY;
  if (!key) throw new Error("[signature.service] RSA_PRIVATE_KEY no está definida");
  return key.replace(/\\n/g, "\n"); // soporte para .env con \n literal
}

function getPublicKey() {
  const key = process.env.RSA_PUBLIC_KEY;
  if (!key) throw new Error("[signature.service] RSA_PUBLIC_KEY no está definida");
  return key.replace(/\\n/g, "\n");
}

function sign(data) {
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  const signer  = crypto.createSign("RSA-SHA256");
  signer.update(payload, "utf8");
  signer.end();
  return signer.sign(getPrivateKey(), "base64");
}

function verify(data, signature) {
  if (!signature) return false;
  const payload  = typeof data === "string" ? data : JSON.stringify(data);
  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(payload, "utf8");
  verifier.end();
  try {
    return verifier.verify(getPublicKey(), signature, "base64");
  } catch (e) {
    console.error("[signature.service] Error al verificar firma:", e.message);
    return false;
  }
}

function citaPayload(cita) {
  return {
    id_barberia: cita.id_barberia,
    id_cliente:  cita.id_cliente,
    id_barbero:  cita.id_barbero,
    fecha:       cita.fecha,
    hora:        cita.hora,
    servicios:   cita.servicios,
  };
}

module.exports = { sign, verify, citaPayload };
