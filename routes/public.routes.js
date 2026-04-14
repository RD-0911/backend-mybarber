const express = require("express");
const router  = express.Router();
const db      = require("../config/db");

const { validarDatosCitaPublica, sanitizar, sanitizarFacebook } = require("../validators/citas.validator");
const { verificarToken, verificarTokenOpcional } = require("../middlewares/auth.middleware");

// ── Helpers de validación ─────────────────────────────────────────
const esEnteroPositivo = (v) => Number.isInteger(Number(v)) && Number(v) > 0;
const esFechaValida    = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v));

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
  } catch (_) {
    res.status(500).json({ error: "Error del servidor" });
  }
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
        "SELECT id, descripcion, precio, hora_estimada FROM servicios WHERE id_barberia = ? AND IFNULL(activo,1) = 1",
        [req.params.id_barberia]
      );
    } catch (_) {
      [rows] = await db.query(
        "SELECT id, descripcion, precio, hora_estimada FROM servicios WHERE id_barberia = ?",
        [req.params.id_barberia]
      );
    }
    res.json(rows);
  } catch (_) {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /public/citas-barberia/:id_barberia  — requiere JWT
// ─────────────────────────────────────────────────────────────────
router.get("/citas-barberia/:id_barberia", verificarToken, async (req, res) => {
  if (!esEnteroPositivo(req.params.id_barberia))
    return res.status(400).json({ error: "ID inválido" });

  // Solo puede ver sus propias citas
  if (String(req.barberia.id) !== String(req.params.id_barberia))
    return res.status(403).json({ error: "No tienes permiso para ver estas citas" });

  try {
    const [rows] = await db.query(
      `SELECT
        c.id, c.fechaInicio, c.fechaFin, c.estado, c.precio,
        CONCAT(cl.nombre, ' ', cl.primerAp) AS cliente_nombre,
        cl.telefono,
        s.descripcion AS servicio_desc,
        s.hora_estimada
       FROM citas c
       LEFT JOIN clientes cl ON cl.id = c.id_cliente
       LEFT JOIN detalle_citas dc ON dc.id_cita = c.id
       LEFT JOIN servicios s ON s.id = dc.id_servicio
       WHERE c.id_barberia = ?
       ORDER BY c.fechaInicio DESC`,
      [req.params.id_barberia]
    );
    res.json(rows);
  } catch (_) {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /public/disponibilidad/:id_barberia?fecha=YYYY-MM-DD
// ─────────────────────────────────────────────────────────────────
router.get("/disponibilidad/:id_barberia", async (req, res) => {
  if (!esEnteroPositivo(req.params.id_barberia))
    return res.status(400).json({ error: "ID inválido" });

  const { fecha } = req.query;
  if (!fecha) return res.status(400).json({ error: "Parámetro fecha requerido" });
  if (!esFechaValida(fecha)) return res.status(400).json({ error: "Formato de fecha inválido. Usa YYYY-MM-DD" });

  try {
    const [rows] = await db.query(
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
    res.json(rows);
  } catch (_) {
    res.status(500).json({ error: "Error del servidor" });
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /public/citas
// ─────────────────────────────────────────────────────────────────
router.post("/citas", verificarTokenOpcional, async (req, res) => {
  const {
    id_barberia, id_servicio, fechaInicio, fechaFin,
    nombre, primerAp, telefono, usuarioFacebook,
    id_cliente: id_cliente_param,
  } = req.body;

  // Determinar si viene del admin verificando el JWT — NO del body
  const esAdmin = !!req.barberia && String(req.barberia.id) === String(id_barberia);

  // Validar IDs obligatorios
  if (!esEnteroPositivo(id_barberia) || !esEnteroPositivo(id_servicio) || !fechaInicio)
    return res.status(400).json({ error: "Faltan datos obligatorios o son inválidos" });

  // Validar fecha
  const inicioDate = new Date(fechaInicio);
  if (isNaN(inicioDate.getTime()))
    return res.status(400).json({ error: "Fecha de inicio inválida" });

  // Validar datos del cliente solo en reservas públicas
  if (!esAdmin) {
    const erroresValidacion = validarDatosCitaPublica(req.body);
    if (erroresValidacion.length > 0)
      return res.status(400).json({ error: erroresValidacion[0], detalles: erroresValidacion });
  }

  try {
    let id_cliente = esAdmin ? id_cliente_param : null;

    if (!esAdmin) {
      // Buscar o crear cliente público
      const [existe] = await db.query(
        "SELECT id FROM clientes WHERE telefono = ?", [telefono.trim()]
      );
      if (existe.length > 0) {
        id_cliente = existe[0].id;
      } else {
        const [nuevo] = await db.query(
          "INSERT INTO clientes (nombre, primerAp, telefono, usuarioFacebook) VALUES (?,?,?,?)",
          [
            sanitizar(nombre),
            sanitizar(primerAp),
            telefono.trim(),
            usuarioFacebook ? sanitizarFacebook(usuarioFacebook) : null
          ]
        );
        id_cliente = nuevo.insertId;
      }
      try {
        await db.query(
          "INSERT IGNORE INTO cliente_barberia (id_cliente, id_barberia) VALUES (?,?)",
          [id_cliente, id_barberia]
        );
      } catch (_) {}
    }

    if (!id_cliente || !esEnteroPositivo(id_cliente))
      return res.status(400).json({ error: "Cliente no especificado o inválido" });

    // Verificar que el servicio pertenece a la barbería
    const [servicios] = await db.query(
      "SELECT precio, hora_estimada FROM servicios WHERE id = ? AND id_barberia = ?",
      [id_servicio, id_barberia]
    );
    if (!servicios.length)
      return res.status(400).json({ error: "Servicio no válido para esta barbería" });

    const { precio, hora_estimada } = servicios[0];
    const inicio = inicioDate;
    const fin = fechaFin
      ? new Date(fechaFin)
      : new Date(inicio.getTime() + hora_estimada * 60000);

    // Verificar conflicto de horario
    try {
      const [conflictos] = await db.query(
        `SELECT id FROM citas
         WHERE id_barberia = ?
           AND estado NOT IN ('cancelada')
           AND fechaFin IS NOT NULL
           AND fechaInicio < ? AND fechaFin > ?`,
        [id_barberia, fin.toISOString(), inicio.toISOString()]
      );
      if (conflictos.length > 0)
        return res.status(409).json({ error: "Este horario ya está ocupado. Por favor elige otro." });
    } catch (_) {}

    const [cita] = await db.query(
      "INSERT INTO citas (fechaInicio, fechaFin, id_barberia, id_cliente, estado, precio) VALUES (?,?,?,?,'pendiente',?)",
      [inicio, fin, id_barberia, id_cliente, precio]
    );

    await db.query(
      "INSERT INTO detalle_citas (id_cita, id_servicio, cantidad, precio_unitario, precio_total) VALUES (?,?,1,?,?)",
      [cita.insertId, id_servicio, precio, precio]
    );

    res.status(201).json({ message: "¡Cita creada exitosamente!", id_cita: cita.insertId });

  } catch (e) {
    console.error("Error POST /public/citas:", e.message);
    // No exponer detalles del error SQL al cliente
    res.status(500).json({ error: "Error al crear la cita. Intenta de nuevo." });
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
    // Verificar que la cita pertenece a la barbería del token
    const [citas] = await db.query(
      "SELECT id_barberia FROM citas WHERE id = ?", [req.params.id]
    );
    if (!citas.length)
      return res.status(404).json({ error: "Cita no encontrada" });

    if (String(citas[0].id_barberia) !== String(req.barberia.id))
      return res.status(403).json({ error: "No tienes permiso para modificar esta cita" });

    await db.query("UPDATE citas SET estado = ? WHERE id = ?", [estado, req.params.id]);
    res.json({ message: "Estado actualizado", estado });
  } catch (_) {
    res.status(500).json({ error: "Error del servidor" });
  }
});

module.exports = router;