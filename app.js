const express = require("express");
const cors    = require("cors");
const path    = require("path");

const authRoutes      = require("./routes/auth.routes");
const barberiaRoutes  = require("./routes/barberia.routes");
const clientesRoutes  = require("./routes/clientes.routes");
const publicRoutes    = require("./routes/public.routes");
const productosRoutes = require("./routes/productos.routes");
const adminRoutes     = require("./routes/admin.routes");

const app = express();

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
  allowedHeaders: ["Content-Type","Authorization"],
}));

app.use(express.json());

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