const express    = require("express");
const bcrypt     = require("bcryptjs");
const jwt        = require("jsonwebtoken");
const rateLimit  = require("express-rate-limit");
const router     = express.Router();
const db         = require("../config/db");
const { verificarAdmin } = require("../middlewares/adminAuth.middleware");

// ── Rate limiter: máx 5 intentos de login admin cada 15 min ──────
const adminLoginLimiter = rateLimit({
  windowMs:  15 * 60 * 1000,
  max:       5,
  standardHeaders: true,
  legacyHeaders:   false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const correo = req.body?.correo?.trim().toLowerCase() || "unknown";
    return `admin_login:${correo}`;
  },
  handler: (_req, res) => {
    const resetEn = new Date(Date.now() + 15 * 60 * 1000)
      .toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
    res.status(429).json({
      error: `Demasiados intentos fallidos. Intenta de nuevo a las ${resetEn}.`
    });
  }
});

// ── POST /admin/login ─────────────────────────────────────────────
router.post("/login", adminLoginLimiter, async (req, res) => {
  const { correo, password } = req.body;
  if (!correo || !password)
    return res.status(400).json({ error: "Correo y contraseña requeridos" });

  const adminEmail    = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword)
    return res.status(500).json({ error: "Panel admin no configurado" });

  if (correo.trim().toLowerCase() !== adminEmail.toLowerCase())
    return res.status(401).json({ error: "Credenciales incorrectas" });

  // Solo bcrypt — sin fallback de texto plano
  // Si ADMIN_PASSWORD aún no está hasheada, cámbiala con:
  //   node -e "const b=require('bcryptjs');b.hash('tuPassword',14).then(console.log)"
  const valida = await bcrypt.compare(password, adminPassword).catch(() => false);

  if (!valida)
    return res.status(401).json({ error: "Credenciales incorrectas" });

  const token = jwt.sign(
    { role: "admin", correo: adminEmail },
    process.env.JWT_SECRET,
    { expiresIn: "8h" }
  );

  res.json({ token, admin: { correo: adminEmail, nombre: "Administrador" } });
});

// ── GET /admin/stats ──────────────────────────────────────────────
router.get("/stats", verificarAdmin, async (req, res) => {
  try {
    const [[{ total }]]    = await db.query("SELECT COUNT(*) AS total FROM barberia");
    const [[{ activas }]]  = await db.query("SELECT COUNT(*) AS activas FROM barberia WHERE IFNULL(estado,'activa') = 'activa'");
    const [[{ pausadas }]] = await db.query("SELECT COUNT(*) AS pausadas FROM barberia WHERE estado = 'pausada'");
    const [[{ citas }]]    = await db.query("SELECT COUNT(*) AS citas FROM citas");

    res.json({ total, activas, pausadas, citas });
  } catch (e) {
    res.status(500).json({ error: "Error al obtener estadísticas" });
  }
});

// ── GET /admin/barberias ──────────────────────────────────────────
router.get("/barberias", verificarAdmin, async (req, res) => {
  const { buscar, estado } = req.query;
  try {
    let sql = `
      SELECT b.id, b.nombre, b.nombre_encargado, b.telefono, b.correo,
             IFNULL(b.estado, 'activa') AS estado,
             b.foto_perfil,
             COUNT(c.id) AS total_citas
      FROM barberia b
      LEFT JOIN citas c ON c.id_barberia = b.id
    `;
    const params = [];
    const where  = [];

    if (buscar) {
      where.push("(b.nombre LIKE ? OR b.nombre_encargado LIKE ? OR b.correo LIKE ?)");
      const like = `%${buscar}%`;
      params.push(like, like, like);
    }
    if (estado && estado !== "todas") {
      if (estado === "activa") {
        where.push("IFNULL(b.estado,'activa') = 'activa'");
      } else {
        where.push("b.estado = ?");
        params.push(estado);
      }
    }

    if (where.length) sql += " WHERE " + where.join(" AND ");
    sql += " GROUP BY b.id ORDER BY b.id DESC";

    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: "Error al obtener barberías" });
  }
});

// ── GET /admin/barberias/:id ──────────────────────────────────────
router.get("/barberias/:id", verificarAdmin, async (req, res) => {
  try {
    const [[b]] = await db.query(
      `SELECT id, nombre, direccion, nombre_encargado, telefono, correo,
              IFNULL(estado,'activa') AS estado, foto_perfil
       FROM barberia WHERE id = ?`, [req.params.id]
    );
    if (!b) return res.status(404).json({ error: "Barbería no encontrada" });

    const [servicios] = await db.query(
      "SELECT id, descripcion, precio, hora_estimada FROM servicios WHERE id_barberia = ?",
      [req.params.id]
    );
    const [citas] = await db.query(
      `SELECT COUNT(*) AS total,
              SUM(estado='pendiente')   AS pendientes,
              SUM(estado='confirmada')  AS confirmadas,
              SUM(estado='cancelada')   AS canceladas
       FROM citas WHERE id_barberia = ?`, [req.params.id]
    );

    res.json({ ...b, servicios, estadoCitas: citas[0] });
  } catch (e) {
    res.status(500).json({ error: "Error al obtener detalle" });
  }
});

// ── PUT /admin/barberias/:id ──────────────────────────────────────
router.put("/barberias/:id", verificarAdmin, async (req, res) => {
  const { nombre, direccion, nombre_encargado, telefono, correo } = req.body;
  if (!nombre || !nombre_encargado || !correo)
    return res.status(400).json({ error: "Faltan campos requeridos" });
  try {
    await db.query(
      "UPDATE barberia SET nombre=?, direccion=?, nombre_encargado=?, telefono=?, correo=? WHERE id=?",
      [nombre.trim(), direccion?.trim() || "", nombre_encargado.trim(), telefono?.trim() || "", correo.trim().toLowerCase(), req.params.id]
    );
    res.json({ message: "Barbería actualizada" });
  } catch (e) {
    res.status(500).json({ error: "Error al actualizar" });
  }
});

// ── PUT /admin/barberias/:id/estado ──────────────────────────────
router.put("/barberias/:id/estado", verificarAdmin, async (req, res) => {
  const { estado } = req.body;
  if (!["activa", "pausada"].includes(estado))
    return res.status(400).json({ error: "Estado inválido" });
  try {
    await db.query("UPDATE barberia SET estado=? WHERE id=?", [estado, req.params.id]);
    res.json({ message: `Barbería ${estado}` });
  } catch (e) {
    res.status(500).json({ error: "Error al actualizar estado" });
  }
});

// ── DELETE /admin/barberias/:id ───────────────────────────────────
router.delete("/barberias/:id", verificarAdmin, async (req, res) => {
  try {
    const [[b]] = await db.query("SELECT id FROM barberia WHERE id=?", [req.params.id]);
    if (!b) return res.status(404).json({ error: "Barbería no encontrada" });

    // Eliminar en cascada — detalle_citas primero para respetar FK
    await db.query(
      "DELETE dc FROM detalle_citas dc INNER JOIN citas c ON dc.id_cita = c.id WHERE c.id_barberia=?",
      [req.params.id]
    );
    await db.query("DELETE FROM citas WHERE id_barberia=?",              [req.params.id]);
    await db.query("DELETE FROM servicios WHERE id_barberia=?",          [req.params.id]);
    await db.query("DELETE FROM productos_barberia WHERE id_barberia=?", [req.params.id]);
    await db.query("DELETE FROM configuracion_barberia WHERE id_barberia=?", [req.params.id]);
    await db.query("DELETE FROM barberia WHERE id=?",                    [req.params.id]);

    res.json({ message: "Barbería eliminada" });
  } catch (e) {
    res.status(500).json({ error: "Error al eliminar" });
  }
});

module.exports = router;