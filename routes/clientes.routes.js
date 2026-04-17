const express  = require("express");
const router   = express.Router();
const db       = require("../config/db");
const { validarDatosCliente } = require("../validators/clientes.validator");
const { verificarToken }      = require("../middlewares/auth.middleware");

// ─────────────────────────────────────────────────────────────────
// GET /clientes  →  Listar clientes de la barbería autenticada
// ─────────────────────────────────────────────────────────────────
router.get("/", verificarToken, async (req, res) => {
  try {
    // Solo devuelve los clientes vinculados a la barbería del token
    const [results] = await db.query(
      `SELECT c.id, c.nombre, c.primerAp, c.segundoAp, c.telefono,
              c.usuarioFacebook, c.usuarioInstagram
       FROM clientes c
       INNER JOIN cliente_barberia cb ON cb.id_cliente = c.id
       WHERE cb.id_barberia = ?
       ORDER BY c.nombre ASC`,
      [req.barberia.id]
    );
    res.json(results);
  } catch (error) {
    console.error("Error en GET /clientes:", error);
    res.status(500).json({ error: "Error al obtener clientes" });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /clientes/:id  →  Obtener un cliente (verificando pertenencia)
// ─────────────────────────────────────────────────────────────────
router.get("/:id", verificarToken, async (req, res) => {
  try {
    const [results] = await db.query(
      `SELECT c.id, c.nombre, c.primerAp, c.segundoAp, c.telefono,
              c.usuarioFacebook, c.usuarioInstagram
       FROM clientes c
       INNER JOIN cliente_barberia cb ON cb.id_cliente = c.id
       WHERE c.id = ? AND cb.id_barberia = ?`,
      [req.params.id, req.barberia.id]
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
// POST /clientes  →  Crear cliente  [JWT]
// ─────────────────────────────────────────────────────────────────
router.post("/", verificarToken, async (req, res) => {
  const errores = validarDatosCliente(req.body);
  if (errores.length > 0)
    return res.status(400).json({ error: "Errores de validación", detalles: errores });

  const { nombre, primerAp, segundoAp, telefono, usuarioFacebook, usuarioInstagram } = req.body;

  try {
    const [result] = await db.query(
      "INSERT INTO clientes (nombre, primerAp, segundoAp, telefono, usuarioFacebook, usuarioInstagram) VALUES (?,?,?,?,?,?)",
      [nombre, primerAp, segundoAp || null, telefono, usuarioFacebook || null, usuarioInstagram || null]
    );

    // Vincular el cliente a la barbería autenticada
    await db.query(
      "INSERT IGNORE INTO cliente_barberia (id_cliente, id_barberia) VALUES (?,?)",
      [result.insertId, req.barberia.id]
    ).catch(() => {});

    res.status(201).json({ message: "Cliente agregado correctamente", id: result.insertId });
  } catch (error) {
    console.error("Error en POST /clientes:", error);
    res.status(500).json({ error: "Error al agregar cliente" });
  }
});

// ─────────────────────────────────────────────────────────────────
// PUT /clientes/:id  →  Actualizar cliente  [JWT + pertenencia]
// ─────────────────────────────────────────────────────────────────
router.put("/:id", verificarToken, async (req, res) => {
  // Verificar que el cliente pertenece a esta barbería
  const [pertenece] = await db.query(
    "SELECT 1 FROM cliente_barberia WHERE id_cliente=? AND id_barberia=?",
    [req.params.id, req.barberia.id]
  ).catch(() => [[]]);
  if (!pertenece.length)
    return res.status(403).json({ error: "No tienes permiso para editar este cliente" });

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
// DELETE /clientes/:id  →  Eliminar cliente  [JWT + pertenencia]
// ─────────────────────────────────────────────────────────────────
router.delete("/:id", verificarToken, async (req, res) => {
  // Verificar que el cliente pertenece a esta barbería
  const [pertenece] = await db.query(
    "SELECT 1 FROM cliente_barberia WHERE id_cliente=? AND id_barberia=?",
    [req.params.id, req.barberia.id]
  ).catch(() => [[]]);
  if (!pertenece.length)
    return res.status(403).json({ error: "No tienes permiso para eliminar este cliente" });

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