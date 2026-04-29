const db     = require("../config/db");
const crypto = require("crypto");

// ── Códigos de recuperación ───────────────────────────────────────

async function initTabla() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS codigos_recuperacion (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        correo      VARCHAR(100) NOT NULL,
        codigo      VARCHAR(10)  NOT NULL,
        expira      DATETIME     NOT NULL,
        verificado  TINYINT      DEFAULT 0,
        creado_en   DATETIME     DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_correo (correo)
      )
    `);
  } catch (e) {
    console.error("Error creando tabla codigos_recuperacion:", e.message);
  }
}
initTabla();

const guardarCodigo = async (correo, codigo) => {
  const expira = new Date(Date.now() + 10 * 60 * 1000); // 10 min
  await db.query("DELETE FROM codigos_recuperacion WHERE correo = ?", [correo]);
  await db.query(
    "INSERT INTO codigos_recuperacion (correo, codigo, expira) VALUES (?, ?, ?)",
    [correo, codigo, expira]
  );
};

const obtenerCodigo = async (correo) => {
  const [rows] = await db.query(
    "SELECT * FROM codigos_recuperacion WHERE correo = ? ORDER BY creado_en DESC LIMIT 1",
    [correo]
  );
  return rows.length ? rows[0] : null;
};

const marcarVerificado = async (correo) => {
  await db.query(
    "UPDATE codigos_recuperacion SET verificado = 1 WHERE correo = ?",
    [correo]
  );
};

const eliminarCodigo = async (correo) => {
  await db.query("DELETE FROM codigos_recuperacion WHERE correo = ?", [correo]);
};

const codigoEstaExpirado = (registro) => new Date() > new Date(registro.expira);

const limpiarExpirados = async () => {
  try {
    await db.query("DELETE FROM codigos_recuperacion WHERE expira < NOW()");
  } catch (_) {}
};
setInterval(limpiarExpirados, 60 * 60 * 1000);

// ── Refresh tokens ────────────────────────────────────────────────

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function initTablaRefresh() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        token_hash VARCHAR(64)  NOT NULL UNIQUE,
        user_id    INT          NOT NULL,
        user_type  ENUM('barberia','barbero','admin') NOT NULL,
        expira     DATETIME     NOT NULL,
        creado_en  DATETIME     DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_hash (token_hash),
        INDEX idx_user (user_id, user_type)
      )
    `);
  } catch (e) {
    console.error("Error creando tabla refresh_tokens:", e.message);
  }
}
initTablaRefresh();

const guardarRefreshToken = async (token, userId, userType) => {
  const hash   = hashToken(token);
  const expira = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 días
  await db.query(
    "INSERT INTO refresh_tokens (token_hash, user_id, user_type, expira) VALUES (?, ?, ?, ?)",
    [hash, userId, userType, expira]
  );
};

const obtenerRefreshToken = async (token) => {
  const hash = hashToken(token);
  const [rows] = await db.query(
    "SELECT * FROM refresh_tokens WHERE token_hash = ? AND expira > NOW()",
    [hash]
  );
  return rows.length ? rows[0] : null;
};

const revocarRefreshToken = async (token) => {
  const hash = hashToken(token);
  await db.query("DELETE FROM refresh_tokens WHERE token_hash = ?", [hash]);
};

const limpiarRefreshExpirados = async () => {
  try {
    await db.query("DELETE FROM refresh_tokens WHERE expira < NOW()");
  } catch (_) {}
};
setInterval(limpiarRefreshExpirados, 60 * 60 * 1000);

module.exports = {
  guardarCodigo,
  obtenerCodigo,
  marcarVerificado,
  eliminarCodigo,
  codigoEstaExpirado,
  guardarRefreshToken,
  obtenerRefreshToken,
  revocarRefreshToken,
};
