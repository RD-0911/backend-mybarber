const express    = require("express");
const router     = express.Router();
const db         = require("../config/db");
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");

const { validarDatosCitaPublica, sanitizar, sanitizarFacebook } = require("../validators/citas.validator");
const { verificarToken, verificarTokenOpcional } = require("../middlewares/auth.middleware");
const {sign, verify, citaPayload} = require("../services/signature.service");
// ── Rate limiter para agendar citas públicas ──────────────────────
// Máx 3 citas por IP cada 24 horas — evita spam de citas falsas
const citasLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 horas
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // ipKeyGenerator maneja IPv4 e IPv6 correctamente (requerido por express-rate-limit v7+)
    return ipKeyGenerator(req.ip)
  },
  skip: (req) => {
    // Los admins autenticados (dueños de barbería) no tienen límite
    try {
      const auth = req.headers["authorization"]
      if (!auth) return false
      const jwt = require("jsonwebtoken")
      const payload = jwt.verify(auth.replace("Bearer ", ""), process.env.JWT_SECRET)
      return payload.tipo === "barberia" || payload.tipo === "barbero"
    } catch (_) { return false }
  },
  handler: (_req, res) => {
    res.status(429).json({
      error: "Has alcanzado el límite de 3 citas por día. Intenta mañana o contacta directamente a la barbería."
    })
  }
});

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
// GET /public/barberos/:id_barberia — barberos activos para reserva pública
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
        TRIM(CONCAT(IFNULL(cl.nombre, ''), ' ', IFNULL(cl.primerAp, ''))) AS cliente_nombre,
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
// GET /public/disponibilidad/:id_barberia?fecha=YYYY-MM-DD&id_barbero=X
// Si se pasa id_barbero → disponibilidad solo de ese barbero
// Si no → disponibilidad global (sin barberos registrados)
// ─────────────────────────────────────────────────────────────────
router.get("/disponibilidad/:id_barberia", async (req, res) => {
  if (!esEnteroPositivo(req.params.id_barberia))
    return res.status(400).json({ error: "ID inválido" });
  const { fecha, id_barbero } = req.query;
  if (!fecha) return res.status(400).json({ error: "Parámetro fecha requerido" });
  if (!esFechaValida(fecha)) return res.status(400).json({ error: "Formato de fecha inválido" });

  try {
    let citas;
    let bloqueos = [];

    if (id_barbero && esEnteroPositivo(id_barbero)) {
      [citas] = await db.query(
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
      // Usar comparación por timestamp para evitar overflow de zona horaria
      // El día (fecha) va de 00:00:00 a 23:59:59 en hora local del servidor
      [bloqueos] = await db.query(
        `SELECT fecha_inicio AS fechaInicio, fecha_fin AS fechaFin
         FROM bloqueos_barbero
         WHERE id_barbero = ?
           AND fecha_inicio < CONCAT(?, ' 23:59:59')
           AND fecha_fin    > CONCAT(?, ' 00:00:00')`,
        [id_barbero, fecha, fecha]
      );
    } else {
      [citas] = await db.query(
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
      [bloqueos] = await db.query(
        `SELECT bb.fecha_inicio AS fechaInicio, bb.fecha_fin AS fechaFin
         FROM bloqueos_barbero bb
         INNER JOIN barberos b ON b.id = bb.id_barbero
         WHERE b.id_barberia = ?
           AND bb.fecha_inicio < CONCAT(?, ' 23:59:59')
           AND bb.fecha_fin    > CONCAT(?, ' 00:00:00')`,
        [req.params.id_barberia, fecha, fecha]
      );
    }

    // Combinar citas + bloqueos para que el frontend los trate igual (ocupados)
    const ocupados = [
      ...citas,
      ...bloqueos.map(b => ({ fechaInicio: b.fechaInicio, fechaFin: b.fechaFin, hora_estimada: null }))
    ];
    res.json(ocupados);
  } catch (e) {
    console.error("Error GET /disponibilidad:", e);
    res.status(500).json({ error: "Error del servidor" });
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /public/citas
// ─────────────────────────────────────────────────────────────────
router.post("/citas", citasLimiter, verificarTokenOpcional, async (req, res) => {
  const {
    id_barberia, id_servicio, fechaInicio,
    nombre, telefono,
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

  try {
    let id_cliente = esAdmin ? id_cliente_param : null;

    if (!esAdmin) {
      const [existe] = await db.query(
        "SELECT id FROM clientes WHERE telefono = ?", [telefono.trim()]
      );
      if (existe.length > 0) {
        id_cliente = existe[0].id;
      } else {
        const [nuevo] = await db.query(
          "INSERT INTO clientes (nombre, telefono) VALUES (?,?)",
          [sanitizar(nombre), telefono.trim()]
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

    // Verificar servicio
    const [servicios] = await db.query(
      "SELECT precio, hora_estimada FROM servicios WHERE id = ? AND id_barberia = ?",
      [id_servicio, id_barberia]
    );
    if (!servicios.length)
      return res.status(400).json({ error: "Servicio no válido para esta barbería" });

    const { precio, hora_estimada } = servicios[0];
    const inicio     = inicioDate;
    const bloqueoMin = minutosBloqueo(hora_estimada);
    const fin        = new Date(inicio.getTime() + bloqueoMin * 60000);

    // ── Determinar id_barbero ────────────────────────────────────
    let id_barbero = null;

    // Verificar si hay barberos activos en la barbería
    const [barberosActivos] = await db.query(
      "SELECT id FROM barberos WHERE id_barberia = ? AND activo = 1", [id_barberia]
    );
    const hayBarberos = barberosActivos.length > 0;

    if (hayBarberos) {
      if (id_barbero_param && esEnteroPositivo(id_barbero_param)) {
        // Cliente eligió barbero específico — verificar que pertenece a esta barbería
        const [bVerif] = await db.query(
          "SELECT id FROM barberos WHERE id = ? AND id_barberia = ? AND activo = 1",
          [id_barbero_param, id_barberia]
        );
        if (!bVerif.length)
          return res.status(400).json({ error: "El barbero seleccionado no está disponible" });

        // Verificar que no tenga bloqueo en ese horario
        const [bloqueosBarbero] = await db.query(
          `SELECT id FROM bloqueos_barbero
           WHERE id_barbero = ?
             AND fecha_inicio < ? AND fecha_fin > ?`,
          [id_barbero_param, fin, inicio]
        );
        if (bloqueosBarbero.length > 0)
          return res.status(409).json({ error: "Este barbero tiene bloqueado ese horario. Por favor elige otro." });

        id_barbero = id_barbero_param;
      } else {
        // "Sin preferencia" — 1 sola query para citas + 1 para bloqueos (sin N+1)
        const bIds = barberosActivos.map(b => b.id);
        const placeholders = bIds.map(() => "?").join(",");

        const [ocupadosCitas] = await db.query(
          `SELECT DISTINCT id_barbero FROM citas
           WHERE id_barbero IN (${placeholders})
             AND estado NOT IN ('cancelada')
             AND fechaFin IS NOT NULL
             AND fechaInicio < ? AND fechaFin > ?`,
          [...bIds, fin.toISOString(), inicio.toISOString()]
        );
        const [ocupadosBloq] = await db.query(
          `SELECT DISTINCT id_barbero FROM bloqueos_barbero
           WHERE id_barbero IN (${placeholders})
             AND fecha_inicio < ? AND fecha_fin > ?`,
          [...bIds, fin, inicio]
        );
        const indispSet = new Set([
          ...ocupadosCitas.map(r => r.id_barbero),
          ...ocupadosBloq.map(r => r.id_barbero),
        ]);
        const libre = barberosActivos.find(b => !indispSet.has(b.id));
        if (!libre)
          return res.status(409).json({ error: "No hay barberos disponibles en este horario. Por favor elige otra hora." });
        id_barbero = libre.id;
      }

      // Verificar conflicto para ese barbero específico
      const [conflictos] = await db.query(
        `SELECT id FROM citas
         WHERE id_barbero = ?
           AND estado NOT IN ('cancelada')
           AND fechaFin IS NOT NULL
           AND fechaInicio < ? AND fechaFin > ?`,
        [id_barbero, fin.toISOString(), inicio.toISOString()]
      );
      if (conflictos.length > 0)
        return res.status(409).json({ error: "Este barbero ya tiene una cita en ese horario. Por favor elige otro." });

    } else {
      // Sin barberos — verificar conflicto global
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
    }

    // ── Obtener configuración de confirmaciones ─────────────────
    const [configRows] = await db.query(
      "SELECT confirmaciones_automaticas FROM configuracion_barberia WHERE id_barberia=?",
      [id_barberia]
    );
    const confirmacionesActivas = configRows.length > 0 ? configRows[0].confirmaciones_automaticas : true;
    const estadoInicial = confirmacionesActivas ? 'pendiente' : 'confirmada';

    // ── Crear la cita ────────────────────────────────────────────
    const [cita] = await db.query(
      "INSERT INTO citas (fechaInicio, fechaFin, id_barberia, id_cliente, id_barbero, estado, precio) VALUES (?,?,?,?,?,?,?)",
      [inicio, fin, id_barberia, id_cliente, id_barbero, estadoInicial, precio]
    );

    await db.query(
      "INSERT INTO detalle_citas (id_cita, id_servicio, cantidad, precio_unitario, precio_total) VALUES (?,?,1,?,?)",
      [cita.insertId, id_servicio, precio, precio]
    );

    // ── Firma digital de la cita ──────────────────────────────────
    // Se firma el payload canónico para poder verificar luego que
    // los datos no fueron alterados directamente en la BD.
    let firma = null;
    try {
      const payload = citaPayload({
        id_barberia, id_cliente, id_barbero,
        fecha: inicio, hora: inicio,
        servicios: String(id_servicio),
      });
      firma = sign(payload);
      await db.query("UPDATE citas SET firma_digital = ? WHERE id = ?", [firma, cita.insertId]);
    } catch (signErr) {
      // La firma es adicional — no bloquea la creación de la cita
      console.warn("[firma] No se pudo firmar la cita:", signErr.message);
    }

    res.status(201).json({ message: "¡Cita creada exitosamente!", id_cita: cita.insertId });

  } catch (e) {
    console.error("Error POST /public/citas:", e.message);
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
    const [citas] = await db.query("SELECT id_barberia FROM citas WHERE id = ?", [req.params.id]);
    if (!citas.length) return res.status(404).json({ error: "Cita no encontrada" });
    if (String(citas[0].id_barberia) !== String(req.barberia.id))
      return res.status(403).json({ error: "No tienes permiso para modificar esta cita" });
    await db.query("UPDATE citas SET estado = ? WHERE id = ?", [estado, req.params.id]);
    res.json({ message: "Estado actualizado", estado });
  } catch (_) { res.status(500).json({ error: "Error del servidor" }); }
});

// ─────────────────────────────────────────────────────────────────
// GET /public/citas/:id/verificar-firma
// Verifica que los datos de una cita no hayan sido alterados en BD.
// ─────────────────────────────────────────────────────────────────
router.get("/citas/:id/verificar-firma", verificarToken, async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT id, id_barberia, id_cliente, id_barbero, fechaInicio, firma_digital FROM citas WHERE id = ?",
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Cita no encontrada" });

    const cita = rows[0];
    if (String(cita.id_barberia) !== String(req.barberia.id))
      return res.status(403).json({ error: "No tienes permiso para verificar esta cita" });

    if (!cita.firma_digital)
      return res.json({ valida: false, razon: "La cita no tiene firma digital (fue creada antes de implementar firmas)" });

    const payload = citaPayload({
      id_barberia: cita.id_barberia,
      id_cliente:  cita.id_cliente,
      id_barbero:  cita.id_barbero,
      fecha:       cita.fechaInicio,
      hora:        cita.fechaInicio,
      servicios:   String(cita.id_servicio || ""),
    });

    const valida = verify(payload, cita.firma_digital);
    res.json({
      valida,
      razon: valida ? "Firma verificada correctamente" : "La firma no coincide — los datos pudieron ser alterados",
    });
  } catch (e) {
    console.error("Error GET /public/citas/:id/verificar-firma:", e);
    res.status(500).json({ error: "Error al verificar firma" });
  }
});



module.exports = router;