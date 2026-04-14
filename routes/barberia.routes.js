const express = require("express");
const router  = express.Router();
const db      = require("../config/db");
const path    = require("path");
const fs      = require("fs");
const multer  = require("multer");

// ── Configuración de multer ──────────────────────────────────────
const uploadDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (req, _file, cb) => {
    // Nombre único: barberia_ID_timestamp.ext
    const ext = path.extname(_file.originalname).toLowerCase() || ".jpg";
    cb(null, `barberia_${req.params.id}_${Date.now()}${ext}`);
  }
});

const fileFilter = (_req, file, cb) => {
  const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  if (allowed.includes(file.mimetype)) cb(null, true);
  else cb(new Error("Solo se permiten imágenes (jpg, png, webp)"), false);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 3 * 1024 * 1024 } // 3MB máximo
});

// ─────────────────────────────────────────────────────────────────
// GET /barberia/:id
// ─────────────────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const [results] = await db.query(
      "SELECT id, nombre, direccion, nombre_encargado, telefono, correo, idSuscripcion, foto_perfil FROM barberia WHERE id = ?",
      [req.params.id]
    );
    if (results.length === 0) return res.status(404).json({ error: "Barbería no encontrada" });
    res.json(results[0]);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener la barbería" });
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /barberia/:id/foto  →  Subir foto de perfil
// ─────────────────────────────────────────────────────────────────
router.post("/:id/foto", upload.single("foto"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No se recibió ninguna imagen" });

  try {
    // Borrar foto anterior si existe
    const [rows] = await db.query("SELECT foto_perfil FROM barberia WHERE id=?", [req.params.id]);
    if (rows.length && rows[0].foto_perfil) {
      const rutaAnterior = path.join(__dirname, "../", rows[0].foto_perfil.replace(/^\//, ""));
      if (fs.existsSync(rutaAnterior)) fs.unlinkSync(rutaAnterior);
    }

    const rutaRelativa = `/uploads/${req.file.filename}`;
    await db.query("UPDATE barberia SET foto_perfil=? WHERE id=?", [rutaRelativa, req.params.id]);

    res.json({ message: "Foto actualizada", foto_perfil: rutaRelativa });
  } catch (e) {
    console.error("Error POST foto:", e);
    res.status(500).json({ error: "Error al guardar la foto" });
  }
});

// ─────────────────────────────────────────────────────────────────
// DELETE /barberia/:id/foto  →  Eliminar foto de perfil
// ─────────────────────────────────────────────────────────────────
router.delete("/:id/foto", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT foto_perfil FROM barberia WHERE id=?", [req.params.id]);
    if (rows.length && rows[0].foto_perfil) {
      const rutaFisica = path.join(__dirname, "../", rows[0].foto_perfil.replace(/^\//, ""));
      if (fs.existsSync(rutaFisica)) fs.unlinkSync(rutaFisica);
    }
    await db.query("UPDATE barberia SET foto_perfil=NULL WHERE id=?", [req.params.id]);
    res.json({ message: "Foto eliminada" });
  } catch (e) {
    res.status(500).json({ error: "Error al eliminar la foto" });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /barberia/:id/servicios
// ─────────────────────────────────────────────────────────────────
router.get("/:id/servicios", async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT id, descripcion, precio, hora_estimada, IFNULL(activo, 1) AS activo FROM servicios WHERE id_barberia = ? ORDER BY id ASC",
      [req.params.id]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: "Error al obtener servicios" });
  }
});

// POST /barberia/:id/servicios
router.post("/:id/servicios", async (req, res) => {
  const { descripcion, precio, hora_estimada } = req.body;
  if (!descripcion || !precio || !hora_estimada)
    return res.status(400).json({ error: "descripcion, precio y hora_estimada son requeridos" });
  try {
    let result;
    try {
      [result] = await db.query(
        "INSERT INTO servicios (id_barberia, descripcion, precio, hora_estimada, activo) VALUES (?,?,?,?,1)",
        [req.params.id, descripcion.trim(), parseFloat(precio), parseInt(hora_estimada)]
      );
    } catch (_) {
      [result] = await db.query(
        "INSERT INTO servicios (id_barberia, descripcion, precio, hora_estimada) VALUES (?,?,?,?)",
        [req.params.id, descripcion.trim(), parseFloat(precio), parseInt(hora_estimada)]
      );
    }
    res.status(201).json({ message: "Servicio creado", id: result.insertId });
  } catch (e) {
    res.status(500).json({ error: "Error al crear servicio" });
  }
});

// PUT /barberia/:id/servicios/:sid
router.put("/:id/servicios/:sid", async (req, res) => {
  const { descripcion, precio, hora_estimada, activo } = req.body;
  if (!descripcion || !precio || !hora_estimada)
    return res.status(400).json({ error: "Faltan campos requeridos" });
  try {
    let result;
    try {
      [result] = await db.query(
        "UPDATE servicios SET descripcion=?, precio=?, hora_estimada=?, activo=? WHERE id=? AND id_barberia=?",
        [descripcion.trim(), parseFloat(precio), parseInt(hora_estimada), activo !== undefined ? (activo ? 1 : 0) : 1, req.params.sid, req.params.id]
      );
    } catch (_) {
      [result] = await db.query(
        "UPDATE servicios SET descripcion=?, precio=?, hora_estimada=? WHERE id=? AND id_barberia=?",
        [descripcion.trim(), parseFloat(precio), parseInt(hora_estimada), req.params.sid, req.params.id]
      );
    }
    if (result.affectedRows === 0) return res.status(404).json({ error: "Servicio no encontrado" });
    res.json({ message: "Servicio actualizado" });
  } catch (e) {
    res.status(500).json({ error: "Error al actualizar servicio" });
  }
});

// PATCH /barberia/:id/servicios/:sid/toggle
router.patch("/:id/servicios/:sid/toggle", async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT IFNULL(activo,1) AS activo FROM servicios WHERE id=? AND id_barberia=?",
      [req.params.sid, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Servicio no encontrado" });
    const nuevoEstado = rows[0].activo ? 0 : 1;
    try {
      await db.query("UPDATE servicios SET activo=? WHERE id=? AND id_barberia=?",
        [nuevoEstado, req.params.sid, req.params.id]);
    } catch (_) {
      return res.status(400).json({ error: "Agrega la columna: ALTER TABLE servicios ADD COLUMN activo TINYINT DEFAULT 1;" });
    }
    res.json({ message: nuevoEstado ? "Activado" : "Desactivado", activo: nuevoEstado });
  } catch (e) {
    res.status(500).json({ error: "Error al cambiar estado" });
  }
});

// DELETE /barberia/:id/servicios/:sid
router.delete("/:id/servicios/:sid", async (req, res) => {
  try {
    const [result] = await db.query(
      "DELETE FROM servicios WHERE id=? AND id_barberia=?",
      [req.params.sid, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: "Servicio no encontrado" });
    res.json({ message: "Servicio eliminado" });
  } catch (e) {
    res.status(500).json({ error: "Error al eliminar. Puede tener citas asociadas." });
  }
});

// GET /barberia/:id/horario
router.get("/:id/horario", async (req, res) => {
  const DEFAULT_HORARIO = { diasLaborales:[1,2,3,4,5,6], horaInicio:"09:00", horaFin:"18:00", intervaloMinutos:30 };
  try {
    try {
      await db.query(`CREATE TABLE IF NOT EXISTS configuracion_barberia (id_barberia INT PRIMARY KEY, horario_config TEXT)`);
      const [rows] = await db.query("SELECT horario_config FROM configuracion_barberia WHERE id_barberia=?", [req.params.id]);
      if (rows.length && rows[0].horario_config) return res.json(JSON.parse(rows[0].horario_config));
    } catch (_) {}
    res.json(DEFAULT_HORARIO);
  } catch (e) {
    res.json(DEFAULT_HORARIO);
  }
});

// PUT /barberia/:id/horario
router.put("/:id/horario", async (req, res) => {
  const config = req.body;
  if (!config.diasLaborales || !config.horaInicio || !config.horaFin)
    return res.status(400).json({ error: "Faltan datos de horario" });
  const configStr = JSON.stringify(config);
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS configuracion_barberia (id_barberia INT PRIMARY KEY, horario_config TEXT)`);
    await db.query(
      "INSERT INTO configuracion_barberia (id_barberia, horario_config) VALUES (?,?) ON DUPLICATE KEY UPDATE horario_config=?",
      [req.params.id, configStr, configStr]
    );
    res.json({ message: "Horario guardado" });
  } catch (e) {
    res.status(500).json({ error: "Error al guardar horario" });
  }
});

// GET /barberia/:id/clientes/buscar?q=texto
router.get("/:id/clientes/buscar", async (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 2) return res.json([]);
  try {
    const b = `%${q.trim()}%`;
    try {
      const [rows] = await db.query(
        `SELECT c.id, c.nombre, c.primerAp, c.telefono FROM clientes c
         INNER JOIN cliente_barberia cb ON cb.id_cliente = c.id
         WHERE cb.id_barberia=? AND (CONCAT(c.nombre,' ',c.primerAp) LIKE ? OR c.telefono LIKE ?)
         ORDER BY c.nombre ASC LIMIT 10`,
        [req.params.id, b, b]
      );
      return res.json(rows);
    } catch (_) {
      const [rows] = await db.query(
        "SELECT id, nombre, primerAp, telefono FROM clientes WHERE CONCAT(nombre,' ',primerAp) LIKE ? OR telefono LIKE ? LIMIT 10",
        [b, b]
      );
      return res.json(rows);
    }
  } catch (e) {
    res.status(500).json({ error: "Error al buscar" });
  }
});

// PUT /barberia/:id/perfil
router.put("/:id/perfil", async (req, res) => {
  const { nombre, direccion, nombre_encargado, telefono, correo } = req.body;
  if (!nombre || !nombre_encargado || !telefono || !correo)
    return res.status(400).json({ error: "Faltan campos obligatorios" });
  try {
    const [result] = await db.query(
      "UPDATE barberia SET nombre=?, direccion=?, nombre_encargado=?, telefono=?, correo=? WHERE id=?",
      [nombre.trim(), direccion?.trim() || '', nombre_encargado.trim(), telefono.trim(), correo.trim().toLowerCase(), req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: "Barbería no encontrada" });
    res.json({ message: "Datos actualizados correctamente" });
  } catch (e) {
    res.status(500).json({ error: "Error al actualizar datos" });
  }
});

// PUT /barberia/:id/password
router.put("/:id/password", async (req, res) => {
  const bcrypt = require("bcryptjs");
  const { actual, nueva } = req.body;
  if (!actual || !nueva) return res.status(400).json({ error: "Contraseña actual y nueva son requeridas" });
  if (nueva.length < 8) return res.status(400).json({ error: "La nueva contraseña debe tener mínimo 8 caracteres" });
  try {
    const [rows] = await db.query("SELECT password FROM barberia WHERE id=?", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Cuenta no encontrada" });
    const valida = await bcrypt.compare(actual, rows[0].password);
    if (!valida) return res.status(401).json({ error: "La contraseña actual es incorrecta" });
    const hash = await bcrypt.hash(nueva, 14);
    await db.query("UPDATE barberia SET password=? WHERE id=?", [hash, req.params.id]);
    res.json({ message: "Contraseña actualizada correctamente" });
  } catch (e) {
    res.status(500).json({ error: "Error al cambiar contraseña" });
  }
});

module.exports = router;