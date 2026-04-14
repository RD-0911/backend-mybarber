const express = require("express");
const cors    = require("cors");
const path    = require("path");

const authRoutes     = require("./routes/auth.routes");
const barberiaRoutes = require("./routes/barberia.routes");
const clientesRoutes = require("./routes/clientes.routes");
const publicRoutes   = require("./routes/public.routes");

const app = express();

app.use(cors({
  origin:"*",
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
}));

app.use(express.json());

// ── Servir uploads con headers CORS para que el <img> cargue desde otro origen
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

module.exports = app;