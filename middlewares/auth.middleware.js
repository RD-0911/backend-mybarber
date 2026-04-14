const jwt = require("jsonwebtoken");

// ── Middleware: verifica JWT obligatorio ──────────────────────────
function verificarToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  if (!token)
    return res.status(401).json({ error: "Acceso no autorizado. Inicia sesión." });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.barberia = payload; // { id, correo }
    next();
  } catch (e) {
    if (e.name === "TokenExpiredError")
      return res.status(401).json({ error: "Tu sesión expiró. Inicia sesión de nuevo." });
    return res.status(401).json({ error: "Token inválido." });
  }
}

// ── Middleware: verifica JWT si existe, no lo exige ───────────────
function verificarTokenOpcional(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  if (token) {
    try {
      req.barberia = jwt.verify(token, process.env.JWT_SECRET);
    } catch (_) {
      req.barberia = null;
    }
  }
  next();
}

module.exports = { verificarToken, verificarTokenOpcional };