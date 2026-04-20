const express     = require("express");
const router      = express.Router();
const bcrypt      = require("bcryptjs");
const multer      = require("multer");
const db          = require("../config/db");
const { subirACloudinary, eliminarDeCloudinary } = require("../config/cloudinary");
const { verificarBarbero } = require("../middlewares/barberoAuth.middleware");

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Solo se permiten imágenes (jpg, png, webp)"), false);
  },
  limits: { fileSize: 3 * 1024 * 1024 },
});

// ─────────────────────────────────────────────────────────────────
// GET /barbero/citas — citas asignadas al barbero autenticado
// ─────────────────────────────────────────────────────────────────
router.get("/citas", verificarBarbero, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT
        c.id, c.fechaInicio, c.fechaFin, c.estado, c.precio,
        CONCAT(cl.nombre, ' ', cl.primerAp) AS cliente_nombre,
        cl.telefono,
        s.descripcion  AS servicio_desc,
        IFNULL(s.tipo, 'servicio') AS servicio_tipo,
        s.hora_estimada
       FROM citas c
       LEFT JOIN clientes cl    ON cl.id = c.id_cliente
       LEFT JOIN detalle_citas dc ON dc.id_cita = c.id
       LEFT JOIN servicios s    ON s.id = dc.id_servicio
       WHERE c.id_barbero = ?
       ORDER BY c.fechaInicio DESC`,
      [req.barbero.id]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: "Error al obtener citas" });
  }
});

// ─────────────────────────────────────────────────────────────────
// PUT /barbero/citas/:id/estado — cambiar estado de una cita propia
// ─────────────────────────────────────────────────────────────────
router.put("/citas/:id/estado", verificarBarbero, async (req, res) => {
  const { estado } = req.body;
  const ESTADOS_VALIDOS = ["pendiente", "confirmada", "cancelada", "completada"];
  if (!ESTADOS_VALIDOS.includes(estado))
    return res.status(400).json({ error: "Estado no válido" });

  try {
    const [citas] = await db.query(
      "SELECT id_barbero FROM citas WHERE id = ?", [req.params.id]
    );
    if (!citas.length)
      return res.status(404).json({ error: "Cita no encontrada" });
    if (String(citas[0].id_barbero) !== String(req.barbero.id))
      return res.status(403).json({ error: "No tienes permiso para modificar esta cita" });

    await db.query("UPDATE citas SET estado = ? WHERE id = ?", [estado, req.params.id]);
    res.json({ message: "Estado actualizado", estado });
  } catch (e) {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /barbero/perfil — datos del barbero autenticado
// ─────────────────────────────────────────────────────────────────
router.get("/perfil", verificarBarbero, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT b.id, b.nombre, b.correo, b.foto, b.activo,
              bar.nombre AS barberia_nombre
       FROM barberos b
       INNER JOIN barberia bar ON bar.id = b.id_barberia
       WHERE b.id = ?`,
      [req.barbero.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Barbero no encontrado" });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// ─────────────────────────────────────────────────────────────────
// PUT /barbero/nombre — actualizar nombre propio
// ─────────────────────────────────────────────────────────────────
router.put("/nombre", verificarBarbero, async (req, res) => {
  const { nombre } = req.body;
  if (!nombre || !nombre.trim())
    return res.status(400).json({ error: "El nombre es obligatorio" });
  if (nombre.trim().length < 2)
    return res.status(400).json({ error: "El nombre debe tener al menos 2 caracteres" });

  try {
    await db.query(
      "UPDATE barberos SET nombre = ? WHERE id = ?",
      [nombre.trim(), req.barbero.id]
    );
    res.json({ message: "Nombre actualizado", nombre: nombre.trim() });
  } catch (e) {
    res.status(500).json({ error: "Error al actualizar nombre" });
  }
});

// ─────────────────────────────────────────────────────────────────
// PUT /barbero/password — cambiar contraseña propia
// ─────────────────────────────────────────────────────────────────
router.put("/password", verificarBarbero, async (req, res) => {
  const { actual, nueva } = req.body;
  if (!actual || !nueva)
    return res.status(400).json({ error: "Contraseña actual y nueva son requeridas" });
  if (nueva.length < 6)
    return res.status(400).json({ error: "La nueva contraseña debe tener mínimo 6 caracteres" });

  try {
    const [rows] = await db.query(
      "SELECT password FROM barberos WHERE id = ?", [req.barbero.id]
    );
    if (!rows.length)
      return res.status(404).json({ error: "Barbero no encontrado" });

    const valida = await bcrypt.compare(actual, rows[0].password);
    if (!valida)
      return res.status(401).json({ error: "La contraseña actual es incorrecta" });

    const hash = await bcrypt.hash(nueva, 14);
    await db.query("UPDATE barberos SET password = ? WHERE id = ?", [hash, req.barbero.id]);
    res.json({ message: "Contraseña actualizada correctamente" });
  } catch (e) {
    res.status(500).json({ error: "Error al cambiar contraseña" });
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /barbero/foto — subir foto de perfil propia
// ─────────────────────────────────────────────────────────────────
router.post("/foto", verificarBarbero, upload.single("foto"), async (req, res) => {
  if (!req.file)
    return res.status(400).json({ error: "No se recibió ninguna imagen" });
  try {
    const result = await subirACloudinary(
      req.file.buffer,
      `barbero_${req.barbero.id}`,
      "barberos"
    );
    await db.query(
      "UPDATE barberos SET foto = ? WHERE id = ?",
      [result.secure_url, req.barbero.id]
    );
    res.json({ message: "Foto actualizada", foto: result.secure_url });
  } catch (e) {
    console.error("Error POST /barbero/foto:", e);
    res.status(500).json({ error: "Error al subir la foto" });
  }
});

// ─────────────────────────────────────────────────────────────────
// DELETE /barbero/foto — eliminar foto de perfil propia
// ─────────────────────────────────────────────────────────────────
router.delete("/foto", verificarBarbero, async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT foto FROM barberos WHERE id = ?", [req.barbero.id]
    );
    if (rows.length && rows[0].foto) {
      await eliminarDeCloudinary(rows[0].foto, "barberos");
    }
    await db.query("UPDATE barberos SET foto = NULL WHERE id = ?", [req.barbero.id]);
    res.json({ message: "Foto eliminada" });
  } catch (e) {
    res.status(500).json({ error: "Error al eliminar la foto" });
  }
});

module.exports = router;