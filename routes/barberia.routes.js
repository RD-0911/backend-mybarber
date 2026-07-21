const express     = require("express");
const router      = express.Router();
const bcrypt      = require("bcryptjs");
const db          = require("../config/db");
const multer      = require("multer");
const cloudinary  = require("cloudinary").v2;
const streamifier = require("streamifier");
const { verificarToken } = require("../middlewares/auth.middleware");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Solo se permiten imágenes (jpg, png, webp)"), false);
  },
  limits: { fileSize: 3 * 1024 * 1024 }
});

function subirACloudinary(buffer, publicId) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { public_id: publicId, folder: "mybarber", overwrite: true, resource_type: "image" },
      (error, result) => { if (error) reject(error); else resolve(result); }
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });
}

function esOwner(req, res) {
  if (String(req.barberia.id) !== String(req.params.id)) {
    res.status(403).json({ error: "No tienes permiso para modificar esta barbería" });
    return false;
  }
  return true;
}

// ═══════════════════════════════════════════════════════════════
// RUTAS SIN :id — DEBEN IR ANTES DE LAS RUTAS CON /:id
// (si no, Express interpreta "bloqueos" como un :id)
// ═══════════════════════════════════════════════════════════════

// GET /barberia/bloqueos — todos los bloqueos activos/futuros de la barbería
router.get("/bloqueos", verificarToken, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT bb.id, bb.id_barbero, bb.fecha_inicio, bb.fecha_fin, bb.motivo, bb.created_at,
              b.nombre AS barbero_nombre, b.foto AS barbero_foto
       FROM bloqueos_barbero bb
       INNER JOIN barberos b ON b.id = bb.id_barbero
       WHERE b.id_barberia = ?
         AND bb.fecha_fin >= NOW()
       ORDER BY bb.fecha_inicio ASC`,
      [req.barberia.id]
    );
    res.json(rows);
  } catch (e) {
    console.error("Error GET /barberia/bloqueos:", e);
    res.status(500).json({ error: "Error al obtener bloqueos" });
  }
});

// ═══════════════════════════════════════════════════════════════
// RUTAS CON :id
// ═══════════════════════════════════════════════════════════════

// GET /barberia/:id  — público
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

// POST /barberia/:id/foto  [JWT + owner]
router.post("/:id/foto", verificarToken, upload.single("foto"), async (req, res) => {
  if (!esOwner(req, res)) return;
  if (!req.file) return res.status(400).json({ error: "No se recibió ninguna imagen" });
  try {
    const publicId = `barberia_${req.params.id}`;
    const result   = await subirACloudinary(req.file.buffer, publicId);
    await db.query("UPDATE barberia SET foto_perfil=? WHERE id=?", [result.secure_url, req.params.id]);
    res.json({ message: "Foto actualizada", foto_perfil: result.secure_url });
  } catch (e) {
    console.error("Error POST foto:", e);
    res.status(500).json({ error: "Error al guardar la foto" });
  }
});

// DELETE /barberia/:id/foto  [JWT + owner]
router.delete("/:id/foto", verificarToken, async (req, res) => {
  if (!esOwner(req, res)) return;
  try {
    await cloudinary.uploader.destroy(`mybarber/barberia_${req.params.id}`);
    await db.query("UPDATE barberia SET foto_perfil=NULL WHERE id=?", [req.params.id]);
    res.json({ message: "Foto eliminada" });
  } catch (e) {
    res.status(500).json({ error: "Error al eliminar la foto" });
  }
});

// GET /barberia/:id/servicios  — público
router.get("/:id/servicios", async (req, res) => {
  try {
    let rows;
    try {
      [rows] = await db.query(
        `SELECT id, descripcion, IFNULL(tipo,'servicio') AS tipo,
                IFNULL(contenido,'') AS contenido,
                precio, hora_estimada, IFNULL(activo,1) AS activo
         FROM servicios WHERE id_barberia = ? ORDER BY tipo ASC, id ASC`,
        [req.params.id]
      );
    } catch (_) {
      [rows] = await db.query(
        `SELECT id, descripcion, 'servicio' AS tipo, '' AS contenido,
                precio, hora_estimada, IFNULL(activo,1) AS activo
         FROM servicios WHERE id_barberia = ? ORDER BY id ASC`,
        [req.params.id]
      );
    }
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: "Error al obtener servicios" });
  }
});

// POST /barberia/:id/servicios  [JWT + owner]
router.post("/:id/servicios", verificarToken, async (req, res) => {
  if (!esOwner(req, res)) return;
  const { descripcion, precio, hora_estimada, tipo = "servicio", contenido = "" } = req.body;
  if (!descripcion || precio === undefined || precio === null || hora_estimada === undefined || hora_estimada === null)
    return res.status(400).json({ error: "descripcion, precio y hora_estimada son requeridos" });
  const tipoValido = ["servicio", "paquete"].includes(tipo) ? tipo : "servicio";
  try {
    let result;
    try {
      [result] = await db.query(
        "INSERT INTO servicios (id_barberia, descripcion, tipo, contenido, precio, hora_estimada, activo) VALUES (?,?,?,?,?,?,1)",
        [req.params.id, descripcion.trim(), tipoValido, contenido?.trim() || null, parseFloat(precio), parseInt(hora_estimada)]
      );
    } catch (_) {
      [result] = await db.query(
        "INSERT INTO servicios (id_barberia, descripcion, precio, hora_estimada, activo) VALUES (?,?,?,?,1)",
        [req.params.id, descripcion.trim(), parseFloat(precio), parseInt(hora_estimada)]
      );
    }
    res.status(201).json({ message: "Creado correctamente", id: result.insertId });
  } catch (e) {
    res.status(500).json({ error: "Error al crear" });
  }
});

// PUT /barberia/:id/servicios/:sid  [JWT + owner]
router.put("/:id/servicios/:sid", verificarToken, async (req, res) => {
  if (!esOwner(req, res)) return;
  const { descripcion, precio, hora_estimada, activo, tipo = "servicio", contenido = "" } = req.body;
  if (!descripcion || precio === undefined || precio === null || hora_estimada === undefined || hora_estimada === null)
    return res.status(400).json({ error: "Faltan campos requeridos" });
  const tipoValido = ["servicio", "paquete"].includes(tipo) ? tipo : "servicio";
  try {
    let result;
    try {
      [result] = await db.query(
        "UPDATE servicios SET descripcion=?, tipo=?, contenido=?, precio=?, hora_estimada=?, activo=? WHERE id=? AND id_barberia=?",
        [descripcion.trim(), tipoValido, contenido?.trim() || null, parseFloat(precio), parseInt(hora_estimada),
         activo !== undefined ? (activo ? 1 : 0) : 1, req.params.sid, req.params.id]
      );
    } catch (_) {
      [result] = await db.query(
        "UPDATE servicios SET descripcion=?, precio=?, hora_estimada=?, activo=? WHERE id=? AND id_barberia=?",
        [descripcion.trim(), parseFloat(precio), parseInt(hora_estimada),
         activo !== undefined ? (activo ? 1 : 0) : 1, req.params.sid, req.params.id]
      );
    }
    if (result.affectedRows === 0) return res.status(404).json({ error: "Servicio no encontrado" });
    res.json({ message: "Actualizado correctamente" });
  } catch (e) {
    res.status(500).json({ error: "Error al actualizar" });
  }
});

// PATCH /barberia/:id/servicios/:sid/toggle  [JWT + owner]
router.patch("/:id/servicios/:sid/toggle", verificarToken, async (req, res) => {
  if (!esOwner(req, res)) return;
  try {
    const [rows] = await db.query(
      "SELECT IFNULL(activo,1) AS activo FROM servicios WHERE id=? AND id_barberia=?",
      [req.params.sid, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Servicio no encontrado" });
    const nuevoEstado = rows[0].activo ? 0 : 1;
    await db.query("UPDATE servicios SET activo=? WHERE id=? AND id_barberia=?",
      [nuevoEstado, req.params.sid, req.params.id]);
    res.json({ message: nuevoEstado ? "Activado" : "Desactivado", activo: nuevoEstado });
  } catch (e) {
    res.status(500).json({ error: "Error al cambiar estado" });
  }
});

// DELETE /barberia/:id/servicios/:sid  [JWT + owner]
router.delete("/:id/servicios/:sid", verificarToken, async (req, res) => {
  if (!esOwner(req, res)) return;
  try {
    const [result] = await db.query(
      "DELETE FROM servicios WHERE id=? AND id_barberia=?",
      [req.params.sid, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: "Servicio no encontrado" });
    res.json({ message: "Eliminado correctamente" });
  } catch (e) {
    res.status(500).json({ error: "Error al eliminar. Puede tener citas asociadas." });
  }
});

// GET /barberia/:id/horario  — público
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

// PUT /barberia/:id/horario  [JWT + owner]
router.put("/:id/horario", verificarToken, async (req, res) => {
  if (!esOwner(req, res)) return;
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

// GET /barberia/:id/clientes/buscar  [JWT + owner]
router.get("/:id/clientes/buscar", verificarToken, async (req, res) => {
  if (!esOwner(req, res)) return;
  const { q } = req.query;
  if (!q || q.trim().length < 2) return res.json([]);
  try {
    const b = `%${q.trim()}%`;
    try {
      const [rows] = await db.query(
        `SELECT c.id, c.nombre, c.primerAp, c.telefono FROM clientes c
         INNER JOIN cliente_barberia cb ON cb.id_cliente = c.id
         WHERE cb.id_barberia=? AND (c.nombre LIKE ? OR c.telefono LIKE ?)
         ORDER BY c.nombre ASC LIMIT 10`,
        [req.params.id, b, b]
      );
      return res.json(rows);
    } catch (_) {
      const [rows] = await db.query(
        "SELECT id, nombre, primerAp, telefono FROM clientes WHERE nombre LIKE ? OR telefono LIKE ? LIMIT 10",
        [b, b]
      );
      return res.json(rows);
    }
  } catch (e) {
    res.status(500).json({ error: "Error al buscar" });
  }
});

// PUT /barberia/:id/perfil  [JWT + owner]
router.put("/:id/perfil", verificarToken, async (req, res) => {
  if (!esOwner(req, res)) return;
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

// PUT /barberia/:id/password  [JWT + owner]
router.put("/:id/password", verificarToken, async (req, res) => {
  if (!esOwner(req, res)) return;
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

// GET /barberia/:id/configuracion/confirmaciones — obtener estado
router.get("/:id/configuracion/confirmaciones", verificarToken, async (req, res) => {
  if (!esOwner(req, res)) return;
  try {
    const [rows] = await db.query(
      "SELECT confirmaciones_automaticas FROM configuracion_barberia WHERE id_barberia=?",
      [req.params.id]
    );
    const confirmacionesActivas = rows.length > 0 ? rows[0].confirmaciones_automaticas : true;
    res.json({ confirmaciones_automaticas: confirmacionesActivas });
  } catch (e) {
    res.status(500).json({ error: "Error al obtener configuración" });
  }
});

// POST /barberia/:id/configuracion/confirmaciones — cambiar estado
router.post("/:id/configuracion/confirmaciones", verificarToken, async (req, res) => {
  if (!esOwner(req, res)) return;
  const { confirmaciones_automaticas } = req.body;
  if (confirmaciones_automaticas === undefined)
    return res.status(400).json({ error: "Campo confirmaciones_automaticas requerido" });

  try {
    // 1. Insertar o actualizar configuración
    await db.query(
      `INSERT INTO configuracion_barberia (id_barberia, confirmaciones_automaticas)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE confirmaciones_automaticas=?`,
      [req.params.id, confirmaciones_automaticas, confirmaciones_automaticas]
    );

    // 2. Si se desactiva, convertir pendientes a confirmadas
    if (!confirmaciones_automaticas) {
      await db.query(
        "UPDATE citas SET estado='confirmada' WHERE id_barberia=? AND estado='pendiente'",
        [req.params.id]
      );
    }

    res.json({ message: "Configuración actualizada", confirmaciones_automaticas });
  } catch (e) {
    console.error("Error actualizando configuración:", e);
    res.status(500).json({ error: "Error al actualizar configuración" });
  }
});

module.exports = router;