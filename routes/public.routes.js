const express = require("express");
const router  = express.Router();
const db      = require("../config/db");

const { validarDatosCitaPublica, sanitizar, sanitizarFacebook } = require("../validators/citas.validator");
const { verificarToken, verificarTokenOpcional } = require("../middlewares/auth.middleware");

const esEnteroPositivo = (v) => Number.isInteger(Number(v)) && Number(v) > 0;
const esFechaValida    = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v));

function minutosBloqueo(duracionMin) {
  return Math.ceil(duracionMin / 60) * 60;
}

// ─────────────────────────────────────────────────────────────────
// GET /public/barberia/:id
// ─────────────────────────────────────────────────────────────────
router.get("/barberia/:id", async (req, res) => {
  if (!esEnteroPositivo(req.params.id))
    return res.status(400).json({ error: "ID inválido" });
  try {
    const [rows] = await db.query(
      "SELECT id, nombre, direccion, telefono, correo FROM barberia WHERE id = ?",
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Barbería no encontrada" });
    res.json(rows[0]);
  } catch (_) { res.status(500).json({ error: "Error del servidor" }); }
});

// ─────────────────────────────────────────────────────────────────
// GET /public/servicios/:id_barberia
// ─────────────────────────────────────────────────────────────────
router.get("/servicios/:id_barberia", async (req, res) => {
  if (!esEnteroPositivo(req.params.id_barberia))
    return res.status(400).json({ error: "ID inválido" });
  try {
    let rows;
    try {
      [rows] = await db.query(
        `SELECT id, descripcion, IFNULL(tipo,'servicio') AS tipo,
                IFNULL(contenido,'') AS contenido, precio, hora_estimada
         FROM servicios WHERE id_barberia = ? AND IFNULL(activo,1) = 1`,
        [req.params.id_barberia]
      );
    } catch (_) {
      [rows] = await db.query(
        "SELECT id, descripcion, 'servicio' AS tipo, '' AS contenido, precio, hora_estimada FROM servicios WHERE id_barberia = ?",
        [req.params.id_barberia]
      );
    }
    res.json(rows);
  } catch (_) { res.status(500).json({ error: "Error del servidor" }); }
});

// ─────────────────────────────────────────────────────────────────
// GET /public/barberos/:id_barberia
// ─────────────────────────────────────────────────────────────────
router.get("/barberos/:id_barberia", async (req, res) => {
  if (!esEnteroPositivo(req.params.id_barberia))
    return res.status(400).json({ error: "ID inválido" });
  try {
    const [rows] = await db.query(
      "SELECT id, nombre, foto FROM barberos WHERE id_barberia = ? AND activo = 1 ORDER BY nombre ASC",
      [req.params.id_barberia]
    );
    res.json(rows);
  } catch (_) { res.status(500).json({ error: "Error del servidor" }); }
});

// ─────────────────────────────────────────────────────────────────
// GET /public/citas-barberia/:id_barberia  — requiere JWT
// ─────────────────────────────────────────────────────────────────
router.get("/citas-barberia/:id_barberia", verificarToken, async (req, res) => {
  if (!esEnteroPositivo(req.params.id_barberia))
    return res.status(400).json({ error: "ID inválido" });
  if (String(req.barberia.id) !== String(req.params.id_barberia))
    return res.status(403).json({ error: "No tienes permiso para ver estas citas" });
  try {
    const [rows] = await db.query(
      `SELECT
        c.id, c.fechaInicio, c.fechaFin, c.estado, c.precio,
        c.id_barbero,
        CONCAT(cl.nombre, ' ', cl.primerAp) AS cliente_nombre,
        cl.telefono,
        s.descripcion  AS servicio_desc,
        IFNULL(s.tipo,'servicio') AS servicio_tipo,
        s.hora_estimada,
        b.nombre AS barbero_nombre
       FROM citas c
       LEFT JOIN clientes cl    ON cl.id = c.id_cliente
       LEFT JOIN detalle_citas dc ON dc.id_cita = c.id
       LEFT JOIN servicios s    ON s.id = dc.id_servicio
       LEFT JOIN barberos b     ON b.id = c.id_barbero
       WHERE c.id_barberia = ?
       ORDER BY c.fechaInicio DESC`,
      [req.params.id_barberia]
    );
    res.json(rows);
  } catch (_) { res.status(500).json({ error: "Error del servidor" }); }
});

// ─────────────────────────────────────────────────────────────────
// GET /public/disponibilidad/:id_barberia
// ─────────────────────────────────────────────────────────────────
router.get("/disponibilidad/:id_barberia", async (req, res) => {
  if (!esEnteroPositivo(req.params.id_barberia))
    return res.status(400).json({ error: "ID inválido" });
  const { fecha, id_barbero } = req.query;
  if (!fecha) return res.status(400).json({ error: "Parámetro fecha requerido" });
  if (!esFechaValida(fecha)) return res.status(400).json({ error: "Formato de fecha inválido" });

  try {
    let rows;
    if (id_barbero && esEnteroPositivo(id_barbero)) {
      [rows] = await db.query(
        `SELECT c.fechaInicio, c.fechaFin, s.hora_estimada
         FROM citas c
         LEFT JOIN detalle_citas dc ON dc.id_cita = c.id
         LEFT JOIN servicios s ON s.id = dc.id_servicio
         WHERE c.id_barberia = ?
           AND c.id_barbero = ?
           AND DATE(c.fechaInicio) = ?
           AND c.estado NOT IN ('cancelada')
         ORDER BY c.fechaInicio ASC`,
        [req.params.id_barberia, id_barbero, fecha]
      );
    } else {
      [rows] = await db.query(
        `SELECT c.fechaInicio, c.fechaFin, s.hora_estimada
         FROM citas c
         LEFT JOIN detalle_citas dc ON dc.id_cita = c.id
         LEFT JOIN servicios s ON s.id = dc.id_servicio
         WHERE c.id_barberia = ?
           AND DATE(c.fechaInicio) = ?
           AND c.estado NOT IN ('cancelada')
         ORDER BY c.fechaInicio ASC`,
        [req.params.id_barberia, fecha]
      );
    }
    res.json(rows);
  } catch (_) { res.status(500).json({ error: "Error del servidor" }); }
});

// ─────────────────────────────────────────────────────────────────
// POST /public/citas  — con transacción para atomicidad
// ─────────────────────────────────────────────────────────────────
router.post("/citas", verificarTokenOpcional, async (req, res) => {
  const {
    id_barberia, id_servicio, fechaInicio,
    nombre, primerAp, telefono, usuarioFacebook,
    id_cliente: id_cliente_param,
    id_barbero: id_barbero_param,
  } = req.body;

  const esAdmin = !!req.barberia && String(req.barberia.id) === String(id_barberia);

  if (!esEnteroPositivo(id_barberia) || !esEnteroPositivo(id_servicio) || !fechaInicio)
    return res.status(400).json({ error: "Faltan datos obligatorios o son inválidos" });

  const inicioDate = new Date(fechaInicio);
  if (isNaN(inicioDate.getTime()))
    return res.status(400).json({ error: "Fecha de inicio inválida" });
  if (inicioDate < new Date())
    return res.status(400).json({ error: "No puedes agendar una cita en una hora que ya pasó." });

  if (!esAdmin) {
    const erroresValidacion = validarDatosCitaPublica(req.body);
    if (erroresValidacion.length > 0)
      return res.status(400).json({ error: erroresValidacion[0], detalles: erroresValidacion });
  }

  // ── Usar transacción para que cita + detalle_cita sean atómicos ──
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // ── Resolver id_cliente ──────────────────────────────────────
    let id_cliente = esAdmin ? id_cliente_param : null;

    if (!esAdmin) {
      const [existe] = await conn.query(
        "SELECT id FROM clientes WHERE telefono = ?", [telefono.trim()]
      );
      if (existe.length > 0) {
        id_cliente = existe[0].id;
      } else {
        const [nuevo] = await conn.query(
          "INSERT INTO clientes (nombre, primerAp, telefono, usuarioFacebook) VALUES (?,?,?,?)",
          [sanitizar(nombre), sanitizar(primerAp), telefono.trim(),
           usuarioFacebook ? sanitizarFacebook(usuarioFacebook) : null]
        );
        id_cliente = nuevo.insertId;
      }
      await conn.query(
        "INSERT IGNORE INTO cliente_barberia (id_cliente, id_barberia) VALUES (?,?)",
        [id_cliente, id_barberia]
      ).catch(() => {});
    }

    if (!id_cliente || !esEnteroPositivo(id_cliente)) {
      await conn.rollback();
      return res.status(400).json({ error: "Cliente no especificado o inválido" });
    }

    // ── Verificar servicio ───────────────────────────────────────
    const [servicios] = await conn.query(
      "SELECT precio, hora_estimada FROM servicios WHERE id = ? AND id_barberia = ?",
      [id_servicio, id_barberia]
    );
    if (!servicios.length) {
      await conn.rollback();
      return res.status(400).json({ error: "Servicio no válido para esta barbería" });
    }

    const { precio, hora_estimada } = servicios[0];
    const inicio     = inicioDate;
    const bloqueoMin = minutosBloqueo(hora_estimada);
    const fin        = new Date(inicio.getTime() + bloqueoMin * 60000);

    // ── Determinar id_barbero ────────────────────────────────────
    let id_barbero = null;

    const [barberosActivos] = await conn.query(
      "SELECT id FROM barberos WHERE id_barberia = ? AND activo = 1", [id_barberia]
    );
    const hayBarberos = barberosActivos.length > 0;

    if (hayBarberos) {
      if (id_barbero_param && esEnteroPositivo(id_barbero_param)) {
        const [bVerif] = await conn.query(
          "SELECT id FROM barberos WHERE id = ? AND id_barberia = ? AND activo = 1",
          [id_barbero_param, id_barberia]
        );
        if (!bVerif.length) {
          await conn.rollback();
          return res.status(400).json({ error: "El barbero seleccionado no está disponible" });
        }
        id_barbero = id_barbero_param;
      } else {
        for (const b of barberosActivos) {
          const [conf] = await conn.query(
            `SELECT id FROM citas
             WHERE id_barbero = ?
               AND estado NOT IN ('cancelada')
               AND fechaFin IS NOT NULL
               AND fechaInicio < ? AND fechaFin > ?`,
            [b.id, fin.toISOString(), inicio.toISOString()]
          );
          if (conf.length === 0) { id_barbero = b.id; break; }
        }
        if (!id_barbero) {
          await conn.rollback();
          return res.status(409).json({ error: "No hay barberos disponibles en este horario. Por favor elige otra hora." });
        }
      }

      const [conflictos] = await conn.query(
        `SELECT id FROM citas
         WHERE id_barbero = ?
           AND estado NOT IN ('cancelada')
           AND fechaFin IS NOT NULL
           AND fechaInicio < ? AND fechaFin > ?`,
        [id_barbero, fin.toISOString(), inicio.toISOString()]
      );
      if (conflictos.length > 0) {
        await conn.rollback();
        return res.status(409).json({ error: "Este barbero ya tiene una cita en ese horario. Por favor elige otro." });
      }

    } else {
      const [conflictos] = await conn.query(
        `SELECT id FROM citas
         WHERE id_barberia = ?
           AND estado NOT IN ('cancelada')
           AND fechaFin IS NOT NULL
           AND fechaInicio < ? AND fechaFin > ?`,
        [id_barberia, fin.toISOString(), inicio.toISOString()]
      );
      if (conflictos.length > 0) {
        await conn.rollback();
        return res.status(409).json({ error: "Este horario ya está ocupado. Por favor elige otro." });
      }
    }

    // ── Crear la cita ────────────────────────────────────────────
    const [cita] = await conn.query(
      "INSERT INTO citas (fechaInicio, fechaFin, id_barberia, id_cliente, id_barbero, estado, precio) VALUES (?,?,?,?,?,'pendiente',?)",
      [inicio, fin, id_barberia, id_cliente, id_barbero, precio]
    );

    // ── Crear detalle (mismo commit) ─────────────────────────────
    await conn.query(
      "INSERT INTO detalle_citas (id_cita, id_servicio, cantidad, precio_unitario, precio_total) VALUES (?,?,1,?,?)",
      [cita.insertId, id_servicio, precio, precio]
    );

    await conn.commit();
    res.status(201).json({ message: "¡Cita creada exitosamente!", id_cita: cita.insertId });

  } catch (e) {
    await conn.rollback();
    console.error("Error POST /public/citas:", e.message);
    res.status(500).json({ error: "Error al crear la cita. Intenta de nuevo." });
  } finally {
    conn.release();
  }
});

// ─────────────────────────────────────────────────────────────────
// PUT /public/citas/:id/estado  — requiere JWT
// ─────────────────────────────────────────────────────────────────
router.put("/citas/:id/estado", verificarToken, async (req, res) => {
  if (!esEnteroPositivo(req.params.id))
    return res.status(400).json({ error: "ID inválido" });
  const { estado } = req.body;
  const ESTADOS_VALIDOS = ["pendiente", "confirmada", "cancelada", "completada"];
  if (!ESTADOS_VALIDOS.includes(estado))
    return res.status(400).json({ error: "Estado no válido" });
  try {
    const [citas] = await db.query("SELECT id_barberia FROM citas WHERE id = ?", [req.params.id]);
    if (!citas.length) return res.status(404).json({ error: "Cita no encontrada" });
    if (String(citas[0].id_barberia) !== String(req.barberia.id))
      return res.status(403).json({ error: "No tienes permiso para modificar esta cita" });
    await db.query("UPDATE citas SET estado = ? WHERE id = ?", [estado, req.params.id]);
    res.json({ message: "Estado actualizado", estado });
  } catch (_) { res.status(500).json({ error: "Error del servidor" }); }
});

module.exports = router;