const express = require("express");
const router  = express.Router();
const db      = require("../config/db");
const { verificarBarbero } = require("../middlewares/barberoAuth.middleware");

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
    // Verificar que la cita le pertenece a este barbero
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

module.exports = router;