const jwt = require("jsonwebtoken");

function verificarAdmin(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  if (!token)
    return res.status(401).json({ error: "Acceso no autorizado." });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.role !== "admin")
      return res.status(403).json({ error: "No tienes permisos de administrador." });
    req.admin = payload;
    next();
  } catch (e) {
    if (e.name === "TokenExpiredError")
      return res.status(401).json({ error: "Sesión expirada. Inicia sesión de nuevo." });
    return res.status(401).json({ error: "Token inválido." });
  }
}

module.exports = { verificarAdmin };