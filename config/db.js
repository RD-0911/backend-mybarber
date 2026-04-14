const mysql = require("mysql2");

const db = mysql.createPool({
  host:               process.env.DB_HOST,
  user:               process.env.DB_USER,
  password:           process.env.DB_PASSWORD,
  database:           process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit:    10,
});

// Verificar conexión al iniciar
db.getConnection((err, connection) => {
  if (err) {
    console.error(" Error al conectar con MySQL:", err.message);
  } else {
    console.log("Conectado a la base de datos:", process.env.DB_NAME);
    connection.release();
  }
});

// Exportar versión con promesas para usar async/await
module.exports = db.promise();