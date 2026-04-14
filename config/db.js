const mysql = require("mysql2");

const db = mysql.createPool({
  host:               process.env.DB_HOST,
  port:               parseInt(process.env.DB_PORT),
  user:               process.env.DB_USER,
  password:           process.env.DB_PASSWORD,
  database:           process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit:    10,
  ssl: {
    rejectUnauthorized: true,
  },
});

// Verificar conexión al iniciar
db.getConnection((err, connection) => {
  if (err) {
    console.error("Error al conectar con MySQL:", err.message);
  } else {
    console.log("Conectado a la base de datos:", process.env.DB_NAME);
    connection.release();
  }
});

module.exports = db.promise();