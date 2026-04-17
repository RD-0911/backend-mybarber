const jwt = require("jsonwebtoken");

function verificarBarbero(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  if (!token)
    return res.status(401).json({ error: "Acceso no autorizado. Inicia sesión." });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.tipo !== "barbero")
      return res.status(403).json({ error: "Acceso exclusivo para barberos." });
    req.barbero = payload; // { id, id_barberia, correo, tipo }
    next();
  } catch (e) {
    if (e.name === "TokenExpiredError")
      return res.status(401).json({ error: "Tu sesión expiró. Inicia sesión de nuevo." });
    return res.status(401).json({ error: "Token inválido." });
  }
}

module.exports = { verificarBarbero };