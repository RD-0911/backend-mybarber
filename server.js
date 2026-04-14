require("dotenv").config();
const app = require("./app");

const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () =>
  console.log(`Servidor corriendo en http://10.186.21.181:${PORT}`)
);