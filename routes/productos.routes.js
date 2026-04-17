const express     = require("express");
const router      = express.Router();
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
    const allowed = ["image/jpeg","image/png","image/webp","image/gif"];
    allowed.includes(file.mimetype) ? cb(null,true) : cb(new Error("Solo imágenes"),false);
  },
  limits: { fileSize: 3 * 1024 * 1024 }
});

function subirCloudinary(buffer, publicId) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { public_id: publicId, folder: "mybarber/productos", overwrite: true, resource_type: "image" },
      (err, result) => err ? reject(err) : resolve(result)
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });
}

// ── Crear tabla si no existe ─────────────────────────────────────
async function initTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS productos_barberia (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      id_barberia INT NOT NULL,
      nombre      VARCHAR(100) NOT NULL,
      descripcion TEXT,
      precio      DECIMAL(10,2) NOT NULL DEFAULT 0,
      imagen_url  VARCHAR(500) DEFAULT NULL,
      stock       INT DEFAULT 0,
      estado      ENUM('disponible','agotado','oculto') DEFAULT 'disponible',
      creado_en   DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (id_barberia) REFERENCES barberia(id) ON DELETE CASCADE
    )
  `);
}
initTable().catch(() => {});

// ── Helper de ownership ───────────────────────────────────────────
function esOwner(req, res) {
  if (String(req.barberia.id) !== String(req.params.barberiaId)) {
    res.status(403).json({ error: "No tienes permiso para modificar estos productos" });
    return false;
  }
  return true;
}

// GET /productos/:barberiaId  — admin  [JWT + owner]
router.get("/:barberiaId", verificarToken, async (req, res) => {
  if (!esOwner(req, res)) return;
  try {
    const [rows] = await db.query(
      "SELECT id, nombre, descripcion, precio, imagen_url, stock, estado, creado_en FROM productos_barberia WHERE id_barberia=? ORDER BY id DESC",
      [req.params.barberiaId]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: "Error al obtener productos" }); }
});

// GET /productos/:barberiaId/publico  — catálogo público (sin JWT)
router.get("/:barberiaId/publico", async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT id, nombre, descripcion, precio, imagen_url, stock, estado FROM productos_barberia WHERE id_barberia=? AND estado != 'oculto' ORDER BY id DESC",
      [req.params.barberiaId]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: "Error al obtener catálogo" }); }
});

// POST /productos/:barberiaId  — crear producto  [JWT + owner]
router.post("/:barberiaId", verificarToken, upload.single("imagen"), async (req, res) => {
  if (!esOwner(req, res)) return;
  const { nombre, descripcion, precio, stock, estado } = req.body;
  if (!nombre || precio === undefined)
    return res.status(400).json({ error: "nombre y precio son requeridos" });
  try {
    let imagen_url = null;
    if (req.file) {
      const result = await subirCloudinary(req.file.buffer, `prod_${req.params.barberiaId}_${Date.now()}`);
      imagen_url = result.secure_url;
    }
    const [result] = await db.query(
      "INSERT INTO productos_barberia (id_barberia,nombre,descripcion,precio,imagen_url,stock,estado) VALUES (?,?,?,?,?,?,?)",
      [req.params.barberiaId, nombre.trim(), descripcion?.trim()||null, parseFloat(precio), imagen_url, parseInt(stock)||0, estado||"disponible"]
    );
    res.status(201).json({ message: "Producto creado", id: result.insertId, imagen_url });
  } catch (e) { console.error(e); res.status(500).json({ error: "Error al crear producto" }); }
});

// PUT /productos/:barberiaId/:id  — editar producto  [JWT + owner]
router.put("/:barberiaId/:id", verificarToken, upload.single("imagen"), async (req, res) => {
  if (!esOwner(req, res)) return;
  const { nombre, descripcion, precio, stock, estado } = req.body;
  if (!nombre || precio === undefined)
    return res.status(400).json({ error: "nombre y precio son requeridos" });
  try {
    let imagen_url = req.body.imagen_url_actual || null;
    if (req.file) {
      const result = await subirCloudinary(req.file.buffer, `prod_${req.params.barberiaId}_${req.params.id}`);
      imagen_url = result.secure_url;
    }
    const [result] = await db.query(
      "UPDATE productos_barberia SET nombre=?,descripcion=?,precio=?,imagen_url=?,stock=?,estado=? WHERE id=? AND id_barberia=?",
      [nombre.trim(), descripcion?.trim()||null, parseFloat(precio), imagen_url, parseInt(stock)||0, estado||"disponible", req.params.id, req.params.barberiaId]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: "Producto no encontrado" });
    res.json({ message: "Producto actualizado", imagen_url });
  } catch (e) { res.status(500).json({ error: "Error al actualizar producto" }); }
});

// DELETE /productos/:barberiaId/:id  [JWT + owner]
router.delete("/:barberiaId/:id", verificarToken, async (req, res) => {
  if (!esOwner(req, res)) return;
  try {
    const [rows] = await db.query("SELECT imagen_url FROM productos_barberia WHERE id=? AND id_barberia=?", [req.params.id, req.params.barberiaId]);
    if (rows.length && rows[0].imagen_url) {
      const parts = rows[0].imagen_url.split("/");
      const publicId = "mybarber/productos/" + parts[parts.length-1].split(".")[0];
      await cloudinary.uploader.destroy(publicId).catch(() => {});
    }
    await db.query("DELETE FROM productos_barberia WHERE id=? AND id_barberia=?", [req.params.id, req.params.barberiaId]);
    res.json({ message: "Producto eliminado" });
  } catch (e) { res.status(500).json({ error: "Error al eliminar producto" }); }
});

module.exports = router;