const express   = require("express");
const bcrypt    = require("bcryptjs");
const jwt       = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const { OAuth2Client } = require("google-auth-library");
const router    = express.Router();

const db = require("../config/db");
const { validarBarberia, validarEmail, validarPassword } = require("../validators/barberia.validator");
const { generarCodigo, enviarCorreoRecuperacion }        = require("../services/email.service");
const { guardarCodigo, obtenerCodigo, marcarVerificado,
        eliminarCodigo, codigoEstaExpirado }             = require("../services/auth.service");

// ── Google OAuth ──────────────────────────────────────────────────
// .trim() blinda contra espacios/saltos de línea accidentales en la variable de entorno
const GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || "").trim();
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// ── Rate limiters ─────────────────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 5,
  standardHeaders: true, legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `login:${req.body?.correo?.trim().toLowerCase() || "unknown"}`,
  handler: (req, res) => {
    const resetEn = new Date(Date.now() + 15 * 60 * 1000)
      .toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })
    res.status(429).json({
      error: `Demasiados intentos fallidos para este correo. Intenta de nuevo a las ${resetEn}.`
    })
  }
});

const googleLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  standardHeaders: true, legacyHeaders: false,
  message: { error: "Demasiados intentos. Espera unos minutos." }
});

const forgotLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 3,
  keyGenerator: (req) => `forgot:${req.body?.correo?.trim().toLowerCase() || "unknown"}`,
  message: { error: "Demasiadas solicitudes de recuperación. Espera una hora." }
});

function generarToken(payload, expira = "8h") {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: expira });
}

function generarTokenRegistro(googleData) {
  return jwt.sign(
    { google_id: googleData.sub, correo: googleData.email, nombre: googleData.name, scope: "complete_register" },
    process.env.JWT_SECRET,
    { expiresIn: "15m" }
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
      `INSERT INTO barberia (nombre, direccion, nombre_encargado, telefono, correo, password, auth_provider)
       VALUES (?, ?, ?, ?, ?, ?, 'local')`,
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
// POST /auth/login — detecta si es barbería o barbero
// ─────────────────────────────────────────────────────────────────
router.post("/login", loginLimiter, async (req, res) => {
  const { correo, password } = req.body;

  if (!correo || !password)
    return res.status(400).json({ error: "Correo y contraseña son obligatorios" });

  if (!validarEmail(correo.trim()))
    return res.status(400).json({ error: "El formato del correo no es válido" });

  const correoNorm = correo.trim().toLowerCase();

  try {
    const [resBarberia] = await db.query(
      `SELECT id, nombre, direccion, nombre_encargado, telefono,
              correo, idSuscripcion, foto_perfil, password, auth_provider
       FROM barberia WHERE correo = ?`,
      [correoNorm]
    );

    if (resBarberia.length > 0) {
      const barberia = resBarberia[0];

      if (!barberia.password) {
        return res.status(401).json({
          error: "Esta cuenta usa Google. Inicia sesión con Google o añade una contraseña desde tu perfil."
        });
      }

      const valida = await bcrypt.compare(password, barberia.password);
      if (!valida)
        return res.status(401).json({ error: "Correo o contraseña incorrectos" });

      const token = generarToken({ id: barberia.id, correo: barberia.correo, tipo: "barberia" });
      const { password: _, auth_provider: __, ...barberiaSegura } = barberia;
      return res.json({
        message: "Login exitoso",
        tipo: "barberia",
        token,
        barberia: barberiaSegura
      });
    }

    const [resBarbero] = await db.query(
      `SELECT id, id_barberia, nombre, correo, foto, activo, password
       FROM barberos WHERE correo = ?`,
      [correoNorm]
    );

    if (resBarbero.length > 0) {
      const barbero = resBarbero[0];

      if (!barbero.activo)
        return res.status(403).json({ error: "Tu cuenta está desactivada. Contacta al dueño del negocio." });

      const valida = await bcrypt.compare(password, barbero.password);
      if (!valida)
        return res.status(401).json({ error: "Correo o contraseña incorrectos" });

      const token = generarToken({
        id:          barbero.id,
        id_barberia: barbero.id_barberia,
        correo:      barbero.correo,
        tipo:        "barbero"
      });

      const { password: _, ...barberoSeguro } = barbero;
      return res.json({
        message: "Login exitoso",
        tipo: "barbero",
        token,
        barbero: barberoSeguro
      });
    }

    return res.status(401).json({ error: "Correo o contraseña incorrectos" });

  } catch (error) {
    console.error("Error en /login:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /auth/google — login / registro con Google
// ═══════════════════════════════════════════════════════════════
router.post("/google", googleLimiter, async (req, res) => {
  const { credential } = req.body;
  if (!credential) return res.status(400).json({ error: "Token de Google requerido" });

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();

    if (!payload.email_verified)
      return res.status(400).json({ error: "Tu correo de Google no está verificado" });

    const googleId = payload.sub;
    const correoNorm = payload.email.trim().toLowerCase();
    const nombreGoogle = payload.name || "";

    // 1. Buscar en barberia por google_id o correo
    const [resBarberia] = await db.query(
      `SELECT id, nombre, direccion, nombre_encargado, telefono,
              correo, idSuscripcion, foto_perfil, google_id, password
       FROM barberia WHERE google_id = ? OR correo = ?`,
      [googleId, correoNorm]
    );

    if (resBarberia.length > 0) {
      const barberia = resBarberia[0];

      if (!barberia.google_id) {
        await db.query(
          "UPDATE barberia SET google_id = ? WHERE id = ?",
          [googleId, barberia.id]
        );
      }

      const token = generarToken({ id: barberia.id, correo: barberia.correo, tipo: "barberia" });
      const { password, google_id, ...barberiaSegura } = barberia;
      return res.json({
        message: "Login exitoso con Google",
        tipo: "barberia",
        token,
        barberia: barberiaSegura,
        tieneContrasena: !!password,
      });
    }

    // 2. Buscar en barberos
    const [resBarbero] = await db.query(
      `SELECT id, id_barberia, nombre, correo, foto, activo, google_id
       FROM barberos WHERE google_id = ? OR correo = ?`,
      [googleId, correoNorm]
    );

    if (resBarbero.length > 0) {
      const barbero = resBarbero[0];

      if (!barbero.activo)
        return res.status(403).json({ error: "Tu cuenta está desactivada. Contacta al dueño del negocio." });

      if (!barbero.google_id) {
        await db.query(
          "UPDATE barberos SET google_id = ? WHERE id = ?",
          [googleId, barbero.id]
        );
      }

      const token = generarToken({
        id:          barbero.id,
        id_barberia: barbero.id_barberia,
        correo:      barbero.correo,
        tipo:        "barbero",
      });
      const { google_id, ...barberoSeguro } = barbero;
      return res.json({
        message: "Login exitoso con Google",
        tipo: "barbero",
        token,
        barbero: barberoSeguro,
      });
    }

    // 3. No existe — emitir token temporal de registro
    const tokenRegistro = generarTokenRegistro(payload);
    return res.status(200).json({
      needsRegistration: true,
      registroToken: tokenRegistro,
      prefill: {
        correo: correoNorm,
        nombre_encargado: nombreGoogle,
      },
    });

  } catch (e) {
    console.error("Error POST /auth/google:", e.message);
    return res.status(401).json({ error: "Token de Google inválido o expirado" });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /auth/google/complete-register
// ═══════════════════════════════════════════════════════════════
router.post("/google/complete-register", async (req, res) => {
  const { registroToken, nombre, direccion, nombre_encargado, telefono } = req.body;

  if (!registroToken)
    return res.status(400).json({ error: "Token de registro requerido" });

  let googleData;
  try {
    googleData = jwt.verify(registroToken, process.env.JWT_SECRET);
    if (googleData.scope !== "complete_register")
      return res.status(401).json({ error: "Token inválido" });
  } catch (_) {
    return res.status(401).json({ error: "Tu sesión de registro expiró. Vuelve a iniciar con Google." });
  }

  if (!nombre?.trim() || !direccion?.trim() || !nombre_encargado?.trim() || !telefono?.trim())
    return res.status(400).json({ error: "Todos los campos son obligatorios" });

  if (!/^\d{10}$/.test(telefono.trim()))
    return res.status(400).json({ error: "El teléfono debe tener exactamente 10 dígitos" });

  try {
    const [existe] = await db.query(
      "SELECT id FROM barberia WHERE correo = ? OR google_id = ?",
      [googleData.correo, googleData.google_id]
    );
    if (existe.length > 0)
      return res.status(409).json({ error: "Este correo ya tiene una cuenta registrada" });

    const [result] = await db.query(
      `INSERT INTO barberia
       (nombre, direccion, nombre_encargado, telefono, correo, google_id, auth_provider, password)
       VALUES (?, ?, ?, ?, ?, ?, 'google', NULL)`,
      [nombre.trim(), direccion.trim(), nombre_encargado.trim(),
       telefono.trim(), googleData.correo, googleData.google_id]
    );

    const token = generarToken({
      id: result.insertId,
      correo: googleData.correo,
      tipo: "barberia"
    });

    const [nuevaBarberia] = await db.query(
      "SELECT id, nombre, direccion, nombre_encargado, telefono, correo, idSuscripcion, foto_perfil FROM barberia WHERE id = ?",
      [result.insertId]
    );

    res.status(201).json({
      message: "Cuenta creada exitosamente",
      tipo: "barberia",
      token,
      barberia: nuevaBarberia[0],
      tieneContrasena: false,
    });
  } catch (e) {
    console.error("Error complete-register:", e.message);
    res.status(500).json({ error: "Error al crear la cuenta" });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /auth/add-password — añadir contraseña a cuenta de Google
// ═══════════════════════════════════════════════════════════════
const { verificarToken } = require("../middlewares/auth.middleware");

router.post("/add-password", verificarToken, async (req, res) => {
  const { nueva } = req.body;
  if (!nueva) return res.status(400).json({ error: "Contraseña requerida" });
  if (!validarPassword(nueva))
    return res.status(400).json({ error: "La contraseña debe tener mínimo 8 caracteres con letras y números" });

  try {
    const [rows] = await db.query("SELECT password FROM barberia WHERE id = ?", [req.barberia.id]);
    if (!rows.length) return res.status(404).json({ error: "Cuenta no encontrada" });

    if (rows[0].password)
      return res.status(400).json({ error: "Ya tienes una contraseña. Usa 'cambiar contraseña' en su lugar." });

    const hash = await bcrypt.hash(nueva, 14);
    await db.query("UPDATE barberia SET password = ? WHERE id = ?", [hash, req.barberia.id]);
    res.json({ message: "Contraseña añadida correctamente. Ahora puedes iniciar sesión con correo y contraseña." });
  } catch (e) {
    console.error("Error add-password:", e);
    res.status(500).json({ error: "Error al añadir contraseña" });
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /auth/forgot-password
// ─────────────────────────────────────────────────────────────────
router.post("/forgot-password", forgotLimiter, async (req, res) => {
  const { correo } = req.body;
  if (!correo || !validarEmail(correo.trim()))
    return res.status(400).json({ error: "Correo inválido" });

  const correoNorm = correo.trim().toLowerCase();

  try {
    const [results] = await db.query(
      "SELECT id, password FROM barberia WHERE correo = ?", [correoNorm]
    );
    if (results.length === 0)
      return res.status(200).json({ message: "Si el correo está registrado, recibirás un código" });

    if (!results[0].password)
      return res.status(400).json({
        error: "Esta cuenta usa Google. Inicia sesión con Google en lugar de recuperar contraseña."
      });

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
      return res.status(400).json({ error: "No hay un código activo para este correo." });
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