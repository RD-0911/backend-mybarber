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
        TRIM(CONCAT(IFNULL(cl.nombre, ''), ' ', IFNULL(cl.primerAp, ''))) AS cliente_nombre,
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

// ─────────────────────────────────────────────────────────────────
// GET /barbero/clientes/buscar?q=... — buscar clientes de su barbería
// ─────────────────────────────────────────────────────────────────
router.get("/clientes/buscar", verificarBarbero, async (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 2) return res.json([]);
  try {
    const b = `%${q.trim()}%`;
    const [rows] = await db.query(
      `SELECT c.id, c.nombre, c.primerAp, c.telefono
       FROM clientes c
       INNER JOIN cliente_barberia cb ON cb.id_cliente = c.id
       WHERE cb.id_barberia = ?
         AND (c.nombre LIKE ? OR c.telefono LIKE ?)
       ORDER BY c.nombre ASC LIMIT 10`,
      [req.barbero.id_barberia, b, b]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: "Error al buscar clientes" });
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /barbero/citas — agendar una cita (asignada a este barbero)
// ─────────────────────────────────────────────────────────────────
router.post("/citas", verificarBarbero, async (req, res) => {
  const { id_cliente, id_servicio, fechaInicio } = req.body;
  const id_barberia = req.barbero.id_barberia;
  const id_barbero  = req.barbero.id;

  if (!id_cliente || !id_servicio || !fechaInicio)
    return res.status(400).json({ error: "Cliente, servicio y fecha son obligatorios" });

  const inicioDate = new Date(fechaInicio);
  if (isNaN(inicioDate.getTime()))
    return res.status(400).json({ error: "Fecha inválida" });
  if (inicioDate < new Date())
    return res.status(400).json({ error: "No puedes agendar en una fecha pasada" });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Verificar servicio
    const [servicios] = await conn.query(
      "SELECT precio, hora_estimada FROM servicios WHERE id = ? AND id_barberia = ?",
      [id_servicio, id_barberia]
    );
    if (!servicios.length) {
      await conn.rollback();
      return res.status(400).json({ error: "Servicio no válido" });
    }

    const { precio, hora_estimada } = servicios[0];
    const bloqueoMin = Math.ceil(hora_estimada / 60) * 60;
    const fin        = new Date(inicioDate.getTime() + bloqueoMin * 60000);

    // Verificar conflicto del barbero en ese horario
    const [conflictos] = await conn.query(
      `SELECT id FROM citas
       WHERE id_barbero = ?
         AND estado NOT IN ('cancelada')
         AND fechaFin IS NOT NULL
         AND fechaInicio < ? AND fechaFin > ?`,
      [id_barbero, fin.toISOString(), inicioDate.toISOString()]
    );
    if (conflictos.length > 0) {
      await conn.rollback();
      return res.status(409).json({ error: "Ya tienes una cita en ese horario" });
    }

    // Crear la cita
    const [cita] = await conn.query(
      "INSERT INTO citas (fechaInicio, fechaFin, id_barberia, id_cliente, id_barbero, estado, precio) VALUES (?,?,?,?,?,'pendiente',?)",
      [inicioDate, fin, id_barberia, id_cliente, id_barbero, precio]
    );

    // Crear detalle
    await conn.query(
      "INSERT INTO detalle_citas (id_cita, id_servicio, cantidad, precio_unitario, precio_total) VALUES (?,?,1,?,?)",
      [cita.insertId, id_servicio, precio, precio]
    );

    await conn.commit();
    res.status(201).json({ message: "Cita creada correctamente", id_cita: cita.insertId });
  } catch (e) {
    await conn.rollback();
    console.error("Error POST /barbero/citas:", e.message);
    res.status(500).json({ error: "Error al crear la cita" });
  } finally {
    conn.release();
  }
});

// ═══════════════════════════════════════════════════════════════
// BLOQUEOS DE AGENDA
// ═══════════════════════════════════════════════════════════════

// GET /barbero/bloqueos — listar mis bloqueos futuros y activos
router.get("/bloqueos", verificarBarbero, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, fecha_inicio, fecha_fin, motivo, created_at
       FROM bloqueos_barbero
       WHERE id_barbero = ?
         AND fecha_fin >= NOW()
       ORDER BY fecha_inicio ASC`,
      [req.barbero.id]
    );
    res.json(rows);
  } catch (e) {
    console.error("Error GET /barbero/bloqueos:", e);
    res.status(500).json({ error: "Error al obtener bloqueos" });
  }
});

// POST /barbero/bloqueos — crear un bloqueo
// Body: { fecha_inicio: "2025-05-10T09:00", fecha_fin: "2025-05-10T17:00", motivo: "..." }
// Query ?forzar=true para cancelar citas en conflicto automáticamente
router.post("/bloqueos", verificarBarbero, async (req, res) => {
  const { fecha_inicio, fecha_fin, motivo } = req.body;
  const forzar = req.query.forzar === "true";

  if (!fecha_inicio || !fecha_fin)
    return res.status(400).json({ error: "Fechas requeridas" });

  const inicio = new Date(fecha_inicio);
  const fin    = new Date(fecha_fin);

  if (isNaN(inicio.getTime()) || isNaN(fin.getTime()))
    return res.status(400).json({ error: "Fechas inválidas" });
  if (fin <= inicio)
    return res.status(400).json({ error: "La fecha de fin debe ser posterior al inicio" });
  if (inicio < new Date(Date.now() - 60000)) // tolerancia de 1 min
    return res.status(400).json({ error: "No puedes bloquear fechas pasadas" });
  if (motivo && motivo.length > 100)
    return res.status(400).json({ error: "El motivo no puede exceder 100 caracteres" });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Buscar citas en conflicto (no canceladas)
    const [citasConflicto] = await conn.query(
      `SELECT id, fechaInicio FROM citas
       WHERE id_barbero = ?
         AND estado NOT IN ('cancelada')
         AND fechaInicio < ? AND fechaFin > ?`,
      [req.barbero.id, fin, inicio]
    );

    // Si hay citas y no pidió forzar, devolver info para que confirme
    if (citasConflicto.length > 0 && !forzar) {
      await conn.rollback();
      return res.status(409).json({
        error: "Hay citas en ese rango",
        citasEnConflicto: citasConflicto.length,
        requiereConfirmacion: true,
      });
    }

    // Si forzó, cancelar las citas en conflicto
    if (citasConflicto.length > 0 && forzar) {
      await conn.query(
        `UPDATE citas SET estado = 'cancelada'
         WHERE id_barbero = ?
           AND estado NOT IN ('cancelada')
           AND fechaInicio < ? AND fechaFin > ?`,
        [req.barbero.id, fin, inicio]
      );
    }

    // Crear el bloqueo
    const [result] = await conn.query(
      `INSERT INTO bloqueos_barbero (id_barbero, fecha_inicio, fecha_fin, motivo)
       VALUES (?, ?, ?, ?)`,
      [req.barbero.id, inicio, fin, motivo?.trim() || null]
    );

    await conn.commit();
    res.status(201).json({
      message: "Bloqueo creado",
      id: result.insertId,
      citasCanceladas: citasConflicto.length,
    });
  } catch (e) {
    await conn.rollback();
    console.error("Error POST /barbero/bloqueos:", e);
    res.status(500).json({ error: "Error al crear bloqueo" });
  } finally {
    conn.release();
  }
});

// DELETE /barbero/bloqueos/:id — eliminar un bloqueo
router.delete("/bloqueos/:id", verificarBarbero, async (req, res) => {
  try {
    const [result] = await db.query(
      "DELETE FROM bloqueos_barbero WHERE id = ? AND id_barbero = ?",
      [req.params.id, req.barbero.id]
    );
    if (result.affectedRows === 0)
      return res.status(404).json({ error: "Bloqueo no encontrado" });
    res.json({ message: "Bloqueo eliminado" });
  } catch (e) {
    console.error("Error DELETE /barbero/bloqueos:", e);
    res.status(500).json({ error: "Error del servidor" });
  }
});


module.exports = router;