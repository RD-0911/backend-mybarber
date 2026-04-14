const express   = require("express");
const bcrypt    = require("bcryptjs");
const jwt       = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const router    = express.Router();

const db = require("../config/db");
const { validarBarberia, validarEmail, validarPassword } = require("../validators/barberia.validator");
const { generarCodigo, enviarCorreoRecuperacion }        = require("../services/email.service");
const { guardarCodigo, obtenerCodigo, marcarVerificado,
        eliminarCodigo, codigoEstaExpirado }             = require("../services/auth.service");

// ── Rate limiter: máx 5 intentos de login por IP cada 15 min ─────
// keyGenerator usa IP + correo para no bloquear IPs compartidas
const loginLimiter = rateLimit({
  windowMs:         15 * 60 * 1000,
  max:              5,
  standardHeaders:  true,
  legacyHeaders:    false,
  skipSuccessfulRequests: true,
  // Bloquear por correo (no por IP) — evita problemas con proxies/red local
  keyGenerator: (req) => {
    const correo = req.body?.correo?.trim().toLowerCase() || "unknown"
    return `login:${correo}`
  },
  handler: (req, res) => {
    const correo = req.body?.correo?.trim() || ""
    const resetEn = new Date(Date.now() + 15 * 60 * 1000)
      .toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })
    res.status(429).json({
      error: `Demasiados intentos fallidos para este correo. Intenta de nuevo a las ${resetEn}.`
    })
  }
});

// ── Rate limiter: máx 3 solicitudes de código por correo cada hora ──
const forgotLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max:      3,
  keyGenerator: (req) => {
    const correo = req.body?.correo?.trim().toLowerCase() || "unknown"
    return `forgot:${correo}`
  },
  message: { error: "Demasiadas solicitudes de recuperación para este correo. Espera una hora." }
});

// ── Generar JWT ───────────────────────────────────────────────────
function generarToken(barberia) {
  return jwt.sign(
    { id: barberia.id, correo: barberia.correo },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "8h" }
  );
}

// ─────────────────────────────────────────────────────────────────
// POST /auth/register
// ─────────────────────────────────────────────────────────────────
router.post("/register", async (req, res) => {
  const errores = validarBarberia(req.body);
  if (errores.length > 0)
    return res.status(400).json({ error: "Errores de validación", detalles: errores });

  const { nombre, direccion, nombre_encargado, telefono, correo, password } = req.body;
  const correoNorm = correo.trim().toLowerCase();

  try {
    const [existe] = await db.query(
      "SELECT id FROM barberia WHERE correo = ?", [correoNorm]
    );
    if (existe.length > 0)
      return res.status(409).json({ error: "El correo ya está registrado" });

    const passwordHash = await bcrypt.hash(password, 14);

    const [result] = await db.query(
      `INSERT INTO barberia (nombre, direccion, nombre_encargado, telefono, correo, password)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [nombre.trim(), direccion.trim(), nombre_encargado.trim(),
       telefono.trim(), correoNorm, passwordHash]
    );

    res.status(201).json({ message: "Barbería registrada correctamente", id: result.insertId });
  } catch (error) {
    console.error("Error en /register:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /auth/login  — con rate limiting y JWT
// ─────────────────────────────────────────────────────────────────
router.post("/login", loginLimiter, async (req, res) => {
  const { correo, password } = req.body;

  if (!correo || !password)
    return res.status(400).json({ error: "Correo y contraseña son obligatorios" });

  if (!validarEmail(correo.trim()))
    return res.status(400).json({ error: "El formato del correo no es válido" });

  try {
    // SELECT solo columnas necesarias — sin SELECT *
    const [results] = await db.query(
      `SELECT id, nombre, direccion, nombre_encargado, telefono,
              correo, idSuscripcion, foto_perfil, password
       FROM barberia WHERE correo = ?`,
      [correo.trim().toLowerCase()]
    );

    if (results.length === 0)
      return res.status(401).json({ error: "Correo o contraseña incorrectos" });

    const barberia = results[0];
    const passwordValida = await bcrypt.compare(password, barberia.password);

    if (!passwordValida)
      return res.status(401).json({ error: "Correo o contraseña incorrectos" });

    // Generar JWT
    const token = generarToken(barberia);

    // Devolver datos sin el hash
    const { password: _omitir, ...barberiaSegura } = barberia;

    res.json({
      message: "Login exitoso",
      token,
      barberia: barberiaSegura
    });

  } catch (error) {
    console.error("Error en /login:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /auth/forgot-password  — con rate limiting
// ─────────────────────────────────────────────────────────────────
router.post("/forgot-password", forgotLimiter, async (req, res) => {
  const { correo } = req.body;

  if (!correo || !validarEmail(correo.trim()))
    return res.status(400).json({ error: "Correo inválido" });

  const correoNorm = correo.trim().toLowerCase();

  try {
    const [results] = await db.query(
      "SELECT id FROM barberia WHERE correo = ?", [correoNorm]
    );

    // Siempre responder igual aunque no exista (no revelar si está registrado)
    if (results.length === 0)
      return res.status(200).json({ message: "Si el correo está registrado, recibirás un código" });

    const codigo = generarCodigo();
    await guardarCodigo(correoNorm, codigo);
    await enviarCorreoRecuperacion(correoNorm, codigo);

    res.json({ message: "Código enviado correctamente" });
  } catch (error) {
    await eliminarCodigo(correoNorm).catch(() => {});
    console.error("Error en /forgot-password:", error);
    res.status(500).json({ error: "No se pudo enviar el correo. Intenta de nuevo." });
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /auth/verify-code
// ─────────────────────────────────────────────────────────────────
router.post("/verify-code", async (req, res) => {
  const { correo, codigo } = req.body;

  if (!correo || !codigo)
    return res.status(400).json({ error: "Correo y código son obligatorios" });

  const correoNorm = correo.trim().toLowerCase();

  try {
    const registro = await obtenerCodigo(correoNorm);

    if (!registro)
      return res.status(400).json({ error: "No hay un código activo para este correo. Solicita uno nuevo." });

    if (codigoEstaExpirado(registro)) {
      await eliminarCodigo(correoNorm);
      return res.status(400).json({ error: "El código ha expirado. Solicita uno nuevo." });
    }

    if (registro.codigo !== codigo.trim())
      return res.status(400).json({ error: "Código incorrecto. Verifica e intenta de nuevo." });

    await marcarVerificado(correoNorm);
    res.json({ message: "Código verificado correctamente" });
  } catch (error) {
    console.error("Error en /verify-code:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /auth/reset-password
// ─────────────────────────────────────────────────────────────────
router.post("/reset-password", async (req, res) => {
  const { correo, codigo, nuevaPassword } = req.body;

  if (!correo || !codigo || !nuevaPassword)
    return res.status(400).json({ error: "Faltan datos obligatorios" });

  if (!validarPassword(nuevaPassword))
    return res.status(400).json({ error: "La contraseña debe tener mínimo 8 caracteres con letras y números" });

  const correoNorm = correo.trim().toLowerCase();

  try {
    const registro = await obtenerCodigo(correoNorm);

    if (!registro || !registro.verificado)
      return res.status(400).json({ error: "Sesión de recuperación inválida. Empieza de nuevo." });

    if (codigoEstaExpirado(registro)) {
      await eliminarCodigo(correoNorm);
      return res.status(400).json({ error: "El código ha expirado. Solicita uno nuevo." });
    }

    if (registro.codigo !== codigo.trim())
      return res.status(400).json({ error: "Código incorrecto." });

    const passwordHash = await bcrypt.hash(nuevaPassword, 14);

    const [result] = await db.query(
      "UPDATE barberia SET password = ? WHERE correo = ?",
      [passwordHash, correoNorm]
    );

    if (result.affectedRows === 0)
      return res.status(404).json({ error: "Cuenta no encontrada" });

    await eliminarCodigo(correoNorm);
    res.json({ message: "Contraseña actualizada correctamente" });

  } catch (error) {
    console.error("Error en /reset-password:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

module.exports = router;