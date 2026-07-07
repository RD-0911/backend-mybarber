const express = require("express");
const cors    = require("cors");
const helmet  = require("helmet");
const path    = require("path");
const cookieParser = require("cookie-parser");

const authRoutes      = require("./routes/auth.routes");
const barberiaRoutes  = require("./routes/barberia.routes");
const clientesRoutes  = require("./routes/clientes.routes");
const publicRoutes    = require("./routes/public.routes");
const productosRoutes = require("./routes/productos.routes");
const adminRoutes     = require("./routes/admin.routes");
const barberosRoutes  = require("./routes/barberos.routes");
const barberoRoutes   = require("./routes/barbero.routes");

const {emitirCsrfToken, validarCsrf} = require("./middlewares/csrf.middleware");

const app = express();

// IP real del cliente detrás del proxy de Render
app.set("trust proxy", 1);

// Seguridad: headers HTTP seguros automáticos
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginOpenerPolicy: false,
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc:      ["'self'"],
      scriptSrc:       ["'self'", "'unsafe-inline'", "accounts.google.com"],
      styleSrc:        ["'self'", "'unsafe-inline'", "fonts.googleapis.com"],
      fontSrc:         ["'self'", "fonts.gstatic.com"],
      imgSrc:          ["'self'", "data:", "blob:", process.env.BACKEND_URL || "http://localhost:3000"],
      connectSrc:      ["'self'", "accounts.google.com", "www.googleapis.com", process.env.BACKEND_URL || "http://localhost:3000"],
      frameSrc:        ["accounts.google.com"],
      objectSrc:       ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  frameguard:{
    action: "deny"
  },
  hsts: { maxAge: 31536000, includeSubDomains: true },
  referrerPolicy: { policy: "no-referrer" },
}));

app.use((req, res, next) => {
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});

const allowedOrigins = [
  process.env.FRONTEND_URL,
  "http://localhost:5173",
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) callback(null, true);
    else callback(new Error("CORS no permitido: " + origin));
  },
  methods: ["GET","POST","PUT","PATCH","DELETE"],
  allowedHeaders: ["Content-Type","Authorization","X-CSRF-Token"],
  credentials: true,
}));

app.use(cookieParser());
app.use(express.json());

//Ruta para obtener token CSRF
app.get("/auth/csrf-token", emitirCsrfToken);

//Validar CSRF
app.use(validarCsrf);

app.use("/uploads", (req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  next();
}, express.static(path.join(__dirname, "uploads")));

app.get("/", (_req, res) =>
  res.json({ message: "Servidor MyBarber funcionando correctamente" })
);

app.use("/auth",      authRoutes);
app.use("/barberia",  barberiaRoutes);
app.use("/clientes",  clientesRoutes);
app.use("/public",    publicRoutes);
app.use("/productos", productosRoutes);
app.use("/admin",     adminRoutes);
app.use("/barberos",  barberosRoutes);
app.use("/barbero",   barberoRoutes);

module.exports = app;