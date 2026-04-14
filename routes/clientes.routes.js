const express = require("express");
const router  = express.Router();
const db      = require("../config/db");
const { validarDatosCliente } = require("../validators/clientes.validator");

// ─────────────────────────────────────────────────────────────────
// GET /clientes  →  Listar todos los clientes
// ─────────────────────────────────────────────────────────────────
router.get("/", async (_req, res) => {
  try {
    const [results] = await db.query("SELECT * FROM clientes");
    res.json(results);
  } catch (error) {
    console.error("Error en GET /clientes:", error);
    res.status(500).json({ error: "Error al obtener clientes" });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /clientes/:id  →  Obtener un cliente
// ─────────────────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const [results] = await db.query(
      "SELECT * FROM clientes WHERE id = ?",
      [req.params.id]
    );

    if (results.length === 0)
      return res.status(404).json({ error: "Cliente no encontrado" });

    res.json(results[0]);
  } catch (error) {
    console.error("Error en GET /clientes/:id:", error);
    res.status(500).json({ error: "Error al obtener cliente" });
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /clientes  →  Crear cliente
// ─────────────────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  const errores = validarDatosCliente(req.body);
  if (errores.length > 0)
    return res.status(400).json({ error: "Errores de validación", detalles: errores });

  const { nombre, primerAp, segundoAp, telefono, usuarioFacebook, usuarioInstagram } = req.body;

  try {
    const [result] = await db.query(
      "INSERT INTO clientes (nombre, primerAp, segundoAp, telefono, usuarioFacebook, usuarioInstagram) VALUES (?,?,?,?,?,?)",
      [nombre, primerAp, segundoAp || null, telefono, usuarioFacebook || null, usuarioInstagram || null]
    );

    res.status(201).json({ message: "Cliente agregado correctamente", id: result.insertId });
  } catch (error) {
    console.error("Error en POST /clientes:", error);
    res.status(500).json({ error: "Error al agregar cliente" });
  }
});

// ─────────────────────────────────────────────────────────────────
// PUT /clientes/:id  →  Actualizar cliente
// ─────────────────────────────────────────────────────────────────
router.put("/:id", async (req, res) => {
  const errores = validarDatosCliente(req.body);
  if (errores.length > 0)
    return res.status(400).json({ error: "Errores de validación", detalles: errores });

  const { nombre, primerAp, segundoAp, telefono, usuarioFacebook, usuarioInstagram } = req.body;

  try {
    const [result] = await db.query(
      "UPDATE clientes SET nombre=?, primerAp=?, segundoAp=?, telefono=?, usuarioFacebook=?, usuarioInstagram=? WHERE id=?",
      [nombre, primerAp, segundoAp || null, telefono, usuarioFacebook || null, usuarioInstagram || null, req.params.id]
    );

    if (result.affectedRows === 0)
      return res.status(404).json({ error: "Cliente no encontrado" });

    res.json({ message: "Cliente actualizado correctamente" });
  } catch (error) {
    console.error("Error en PUT /clientes/:id:", error);
    res.status(500).json({ error: "Error al actualizar cliente" });
  }
});

// ─────────────────────────────────────────────────────────────────
// DELETE /clientes/:id  →  Eliminar cliente
// ─────────────────────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  try {
    const [result] = await db.query(
      "DELETE FROM clientes WHERE id = ?",
      [req.params.id]
    );

    if (result.affectedRows === 0)
      return res.status(404).json({ error: "Cliente no encontrado" });

    res.json({ message: "Cliente eliminado correctamente" });
  } catch (error) {
    console.error("Error en DELETE /clientes/:id:", error);
    res.status(500).json({ error: "Error al eliminar cliente" });
  }
});

module.exports = router;
