const express = require("express");
const router  = express.Router();
const bcrypt  = require("bcryptjs");
const db      = require("../config/db");
const { verificarToken } = require("../middlewares/auth.middleware");

function esOwner(req, res) {
  if (String(req.barberia.id) !== String(req.params.id_barberia)) {
    res.status(403).json({ error: "No tienes permiso" });
    return false;
  }
  return true;
}

// GET /barberos/:id_barberia — listar barberos
router.get("/:id_barberia", verificarToken, async (req, res) => {
  if (!esOwner(req, res)) return;
  try {
    const [rows] = await db.query(
      `SELECT id, nombre, correo, foto, activo, creado_en
       FROM barberos WHERE id_barberia = ? ORDER BY nombre ASC`,
      [req.params.id_barberia]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: "Error al obtener barberos" });
  }
});

// POST /barberos/:id_barberia — crear barbero
router.post("/:id_barberia", verificarToken, async (req, res) => {
  if (!esOwner(req, res)) return;
  const { nombre, correo, password } = req.body;
  if (!nombre || !correo || !password)
    return res.status(400).json({ error: "Nombre, correo y contraseña son requeridos" });
  if (password.length < 6)
    return res.status(400).json({ error: "La contraseña debe tener mínimo 6 caracteres" });
  try {
    // Verificar que el correo no esté en uso
    const [existe] = await db.query(
      "SELECT id FROM barberos WHERE correo = ?", [correo.trim().toLowerCase()]
    );
    if (existe.length > 0)
      return res.status(409).json({ error: "Este correo ya está registrado" });

    const hash = await bcrypt.hash(password, 14);
    const [result] = await db.query(
      "INSERT INTO barberos (id_barberia, nombre, correo, password) VALUES (?,?,?,?)",
      [req.params.id_barberia, nombre.trim(), correo.trim().toLowerCase(), hash]
    );
    res.status(201).json({ message: "Barbero creado correctamente", id: result.insertId });
  } catch (e) {
    res.status(500).json({ error: "Error al crear barbero" });
  }
});

// PUT /barberos/:id_barberia/:id — editar barbero
router.put("/:id_barberia/:id", verificarToken, async (req, res) => {
  if (!esOwner(req, res)) return;
  const { nombre, correo, password } = req.body;
  if (!nombre || !correo)
    return res.status(400).json({ error: "Nombre y correo son requeridos" });
  try {
    // Verificar correo no duplicado en otro barbero
    const [existe] = await db.query(
      "SELECT id FROM barberos WHERE correo = ? AND id != ?",
      [correo.trim().toLowerCase(), req.params.id]
    );
    if (existe.length > 0)
      return res.status(409).json({ error: "Este correo ya está en uso" });

    if (password && password.length > 0) {
      // Actualizar con nueva contraseña
      if (password.length < 6)
        return res.status(400).json({ error: "La contraseña debe tener mínimo 6 caracteres" });
      const hash = await bcrypt.hash(password, 14);
      await db.query(
        "UPDATE barberos SET nombre=?, correo=?, password=? WHERE id=? AND id_barberia=?",
        [nombre.trim(), correo.trim().toLowerCase(), hash, req.params.id, req.params.id_barberia]
      );
    } else {
      // Actualizar sin cambiar contraseña
      await db.query(
        "UPDATE barberos SET nombre=?, correo=? WHERE id=? AND id_barberia=?",
        [nombre.trim(), correo.trim().toLowerCase(), req.params.id, req.params.id_barberia]
      );
    }
    res.json({ message: "Barbero actualizado correctamente" });
  } catch (e) {
    res.status(500).json({ error: "Error al actualizar barbero" });
  }
});

// PATCH /barberos/:id_barberia/:id/toggle — activar/desactivar
router.patch("/:id_barberia/:id/toggle", verificarToken, async (req, res) => {
  if (!esOwner(req, res)) return;
  try {
    const [rows] = await db.query(
      "SELECT activo FROM barberos WHERE id=? AND id_barberia=?",
      [req.params.id, req.params.id_barberia]
    );
    if (!rows.length) return res.status(404).json({ error: "Barbero no encontrado" });
    const nuevoEstado = rows[0].activo ? 0 : 1;
    await db.query("UPDATE barberos SET activo=? WHERE id=?", [nuevoEstado, req.params.id]);
    res.json({ message: nuevoEstado ? "Activado" : "Desactivado", activo: nuevoEstado });
  } catch (e) {
    res.status(500).json({ error: "Error al cambiar estado" });
  }
});

// DELETE /barberos/:id_barberia/:id — eliminar barbero
router.delete("/:id_barberia/:id", verificarToken, async (req, res) => {
  if (!esOwner(req, res)) return;
  try {
    // Desasignar citas del barbero antes de eliminar
    await db.query("UPDATE citas SET id_barbero=NULL WHERE id_barbero=?", [req.params.id]);
    const [result] = await db.query(
      "DELETE FROM barberos WHERE id=? AND id_barberia=?",
      [req.params.id, req.params.id_barberia]
    );
    if (result.affectedRows === 0)
      return res.status(404).json({ error: "Barbero no encontrado" });
    res.json({ message: "Barbero eliminado correctamente" });
  } catch (e) {
    res.status(500).json({ error: "Error al eliminar barbero" });
  }
});

module.exports = router;