const express     = require("express");
const transporter = require("../config/mailer");
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

// ── Almacén temporal de códigos OTP (en memoria) ─────────────────
// { correo: { codigo, expira } }
const otpStore = new Map();

// ── POST /admin/request-code — solicitar código por correo ────────
router.post("/request-code", adminLoginLimiter, async (req, res) => {
  const { correo } = req.body;
  const adminEmail = process.env.ADMIN_EMAIL;

  if (!correo)
    return res.status(400).json({ error: "Correo requerido" });

  // Siempre responder igual para no revelar si el correo es válido
  if (correo.trim().toLowerCase() !== adminEmail?.toLowerCase())
    return res.json({ message: "Si el correo es correcto, recibirás un código" });

  // Generar código de 6 dígitos, expira en 5 minutos
  const codigo = Math.floor(100000 + Math.random() * 900000).toString();
  const expira = Date.now() + 5 * 60 * 1000;
  otpStore.set(adminEmail.toLowerCase(), { codigo, expira });

  try {
    await transporter.sendMail({
      from: '"MyBarber Admin 🔐" <mybarber564@gmail.com>',
      to: adminEmail,
      subject: "Código de acceso - Panel Admin MyBarber",
      html: `
        <div style="font-family:'Segoe UI',sans-serif;max-width:480px;margin:0 auto;background:#0d0d0d;border-radius:16px;overflow:hidden;border:1px solid #2a0050;">
          <div style="background:linear-gradient(135deg,#1a0030,#4a0080);padding:32px;text-align:center;">
            <h1 style="color:#fff;font-size:24px;margin:0;letter-spacing:2px;">✂ MyBarber</h1>
            <p style="color:rgba(255,255,255,0.7);margin:8px 0 0;font-size:13px;">Panel de Administración</p>
          </div>
          <div style="padding:32px;">
            <p style="color:#ccc;font-size:15px;margin:0 0 8px;">Tu código de acceso es:</p>
            <div style="background:#1a0030;border-radius:12px;padding:28px;text-align:center;margin:20px 0;border:2px solid #7b00ff;">
              <div style="font-size:48px;font-weight:900;letter-spacing:14px;color:#c060ff;font-family:monospace;">${codigo}</div>
            </div>
            <p style="color:#888;font-size:13px;">⏱ Expira en <strong style="color:#c060ff;">5 minutos</strong>.</p>
            <p style="color:#888;font-size:13px;">🔒 Si no solicitaste este acceso, ignora este correo.</p>
            <p style="color:#555;font-size:12px;margin-top:24px;border-top:1px solid #222;padding-top:16px;">Este código es de un solo uso y expira automáticamente.</p>
          </div>
        </div>
      `,
    });
  } catch (e) {
    console.error("Error enviando código admin:", e.message);
    return res.status(500).json({ error: "Error al enviar el código. Intenta de nuevo." });
  }

  res.json({ message: "Si el correo es correcto, recibirás un código" });
});

// ── POST /admin/login — verificar código OTP ──────────────────────
router.post("/login", adminLoginLimiter, async (req, res) => {
  const { correo, codigo } = req.body;
  const adminEmail = process.env.ADMIN_EMAIL;

  if (!correo || !codigo)
    return res.status(400).json({ error: "Correo y código requeridos" });

  if (correo.trim().toLowerCase() !== adminEmail?.toLowerCase())
    return res.status(401).json({ error: "Código inválido o expirado" });

  const otp = otpStore.get(adminEmail.toLowerCase());

  if (!otp || otp.codigo !== codigo.trim() || Date.now() > otp.expira) {
    otpStore.delete(adminEmail.toLowerCase());
    return res.status(401).json({ error: "Código inválido o expirado" });
  }

  // Código correcto — eliminar para que sea de un solo uso
  otpStore.delete(adminEmail.toLowerCase());

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