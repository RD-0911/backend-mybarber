// backend/middlewares/csrf.middleware.js
const crypto = require("crypto");

const CSRF_SECRET = process.env.CSRF_SECRET || crypto.randomBytes(32).toString("hex");

// Métodos que mutan estado — requieren validación CSRF
const UNSAFE_METHODS = ["POST", "PUT", "PATCH", "DELETE"];

// Genera un token CSRF firmado: valor|hmac
function generarCsrfToken() {
  const valor  = crypto.randomBytes(32).toString("hex");
  const hmac   = crypto.createHmac("sha256", CSRF_SECRET).update(valor).digest("hex");
  return `${valor}|${hmac}`;
}

// Verifica que el token no fue manipulado
function verificarCsrfToken(token) {
  if (!token || !token.includes("|")) return false;
  const [valor, hmac] = token.split("|");
  const hmacEsperado  = crypto.createHmac("sha256", CSRF_SECRET).update(valor).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(hmacEsperado));
}

// GET /auth/csrf-token — emite token y lo pone en cookie
function emitirCsrfToken(req, res) {
  const token = generarCsrfToken();

  res.cookie("csrf_token", token, {
    httpOnly: false,        // el frontend JS necesita leerla
    secure:   process.env.NODE_ENV === "production",
    sameSite: "Strict",
    maxAge:   4 * 60 * 60 * 1000, // 4 horas
  });

  res.json({ csrfToken: token });
}

// Middleware de validación — se aplica a rutas que mutan estado
function validarCsrf(req, res, next) {
  if (!UNSAFE_METHODS.includes(req.method)) return next();

  // Rutas excluidas (OAuth callbacks, refresh y login de admin no necesitan CSRF)
  const EXCLUIDAS = [
    "/auth/google",
    "/auth/google-token",
    "/auth/google/complete-register",
    "/auth/refresh",
    "/auth/logout",
    "/public/citas",
    "/admin/request-code",
    "/admin/login",
  ];

  const esPublica = req.path.startsWith("/public/");
  if (esPublica || EXCLUIDAS.some(ruta => req.path === ruta || req.originalUrl.endsWith(ruta))) {
    return next();
  }


  const tokenHeader = req.headers["x-csrf-token"];

  if (!tokenHeader) {
    return res.status(403).json({ error: "Token CSRF inválido o ausente" });
  }

  if (!verificarCsrfToken(tokenHeader)) {
    return res.status(403).json({ error: "Token CSRF corrupto" });
  }

  next();
}

module.exports = { emitirCsrfToken, validarCsrf };