const db = require("../config/db");

// ── Crear tabla si no existe ──────────────────────────────────────
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

// ── Guardar código (reemplaza si ya existe uno para ese correo) ───
const guardarCodigo = async (correo, codigo) => {
  const expira = new Date(Date.now() + 10 * 60 * 1000); // 10 min
  // Borra cualquier código anterior del mismo correo
  await db.query("DELETE FROM codigos_recuperacion WHERE correo = ?", [correo]);
  await db.query(
    "INSERT INTO codigos_recuperacion (correo, codigo, expira) VALUES (?, ?, ?)",
    [correo, codigo, expira]
  );
};

// ── Obtener registro más reciente del correo ──────────────────────
const obtenerCodigo = async (correo) => {
  const [rows] = await db.query(
    "SELECT * FROM codigos_recuperacion WHERE correo = ? ORDER BY creado_en DESC LIMIT 1",
    [correo]
  );
  return rows.length ? rows[0] : null;
};

// ── Marcar como verificado ────────────────────────────────────────
const marcarVerificado = async (correo) => {
  await db.query(
    "UPDATE codigos_recuperacion SET verificado = 1 WHERE correo = ?",
    [correo]
  );
};

// ── Eliminar código ───────────────────────────────────────────────
const eliminarCodigo = async (correo) => {
  await db.query("DELETE FROM codigos_recuperacion WHERE correo = ?", [correo]);
};

// ── Verificar si expiró ───────────────────────────────────────────
const codigoEstaExpirado = (registro) => new Date() > new Date(registro.expira);

// ── Limpiar códigos expirados (llamar periódicamente) ─────────────
const limpiarExpirados = async () => {
  try {
    await db.query("DELETE FROM codigos_recuperacion WHERE expira < NOW()");
  } catch (_) {}
};
// Limpiar cada hora
setInterval(limpiarExpirados, 60 * 60 * 1000);

module.exports = {
  guardarCodigo,
  obtenerCodigo,
  marcarVerificado,
  eliminarCodigo,
  codigoEstaExpirado,
};