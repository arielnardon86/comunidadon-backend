import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import sql from "mssql";
import * as dotenv from "dotenv";

dotenv.config();

// Validar variables de entorno
const requiredEnvVars = ["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"];
const missingVars = requiredEnvVars.filter((varName) => !process.env[varName]);

if (missingVars.length > 0) {
  console.error(`❌ Faltan las siguientes variables de entorno: ${missingVars.join(", ")}`);
  process.exit(1);
}

console.log("Valores de entorno cargados:");
console.log("DB_HOST:", process.env.DB_HOST);
console.log("DB_USER:", process.env.DB_USER);
console.log("DB_PASSWORD:", process.env.DB_PASSWORD);
console.log("DB_NAME:", process.env.DB_NAME);
console.log("DB_PORT:", process.env.DB_PORT);

const app = express();

app.use(
  cors({
    origin: ["http://localhost:3001", "http://localhost:5173"],
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());

const SECRET_KEY = process.env.SECRET_KEY || "super_secreto";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "1234";

// ✅ Configuración del pool de conexiones a Azure SQL
const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_HOST,
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT) || 1433,
  options: {
    encrypt: true,
    trustServerCertificate: false,
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
  requestTimeout: 30000,
  connectionTimeout: 30000,
};

const pool = new sql.ConnectionPool(dbConfig);

// ✅ Conectar al pool al iniciar
pool
  .connect()
  .then(() => console.log("✅ Conectado a Azure SQL"))
  .catch((err) => console.error("❌ Error al conectar al pool:", err));

// ✅ Función para obtener una conexión del pool
async function getDBConnection() {
  try {
    return await pool.connect();
  } catch (err) {
    console.error("❌ Error al obtener conexión a la BD:", err);
    throw err;
  }
}

// ✅ Middleware para verificar token
const verifyToken = (req, res, next) => {
  const token = req.headers["authorization"];
  if (!token) {
    return res.status(403).json({ error: "Acceso denegado" });
  }

  try {
    const decoded = jwt.verify(token.split(" ")[1], SECRET_KEY);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Token inválido" });
  }
};

// ✅ Ruta de login
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "Username y password son obligatorios" });
  }

  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    const token = jwt.sign({ username }, SECRET_KEY, { expiresIn: "1h" });
    return res.status(200).json({ message: "Login exitoso", token });
  } else {
    return res.status(401).json({ error: "Usuario o contraseña incorrectos" });
  }
});

// ✅ Ruta de prueba para verificar conexión a Azure SQL
app.get("/api/test-db", async (req, res) => {
  let connection;
  try {
    connection = await getDBConnection();
    const result = await connection.request().query("SELECT 1 + 1 AS result");
    res.json({ success: true, result: result.recordset[0].result });
  } catch (error) {
    console.error("❌ Error al conectar con la BD:", error);
    res.status(500).json({ error: "Error al conectar con la base de datos", details: error.message });
  } finally {
    if (connection) connection.close();
  }
});

// ✅ Ruta para obtener las mesas
app.get("/api/tables", verifyToken, async (req, res) => {
  let connection;
  try {
    connection = await getDBConnection();
    const result = await connection.request().query("SELECT * FROM tables");
    res.status(200).json(result.recordset);
  } catch (error) {
    console.error("❌ Error al obtener mesas:", error);
    res.status(500).json({ error: "No se pudieron obtener las mesas" });
  } finally {
    if (connection) connection.close();
  }
});

// ✅ Ruta para obtener las reservas
app.get("/api/reservations", verifyToken, async (req, res) => {
  let connection;
  try {
    connection = await getDBConnection();
    const result = await connection.request().query("SELECT * FROM reservations");
    res.status(200).json(result.recordset);
  } catch (error) {
    console.error("❌ Error al obtener reservas:", error);
    res.status(500).json({ error: "No se pudieron obtener las reservas" });
  } finally {
    if (connection) connection.close();
  }
});

// ✅ Ruta para crear una nueva reserva
app.post("/api/reservations", verifyToken, async (req, res) => {
  const { tableId, turno, date } = req.body;

  if (!tableId || !turno || !date) {
    return res.status(400).json({ error: "Todos los campos son obligatorios" });
  }

  let connection;
  try {
    connection = await getDBConnection();

    // Verificar si la mesa ya está reservada
    const existing = await connection
      .request()
      .input("tableId", sql.Int, tableId)
      .input("turno", sql.NVarChar, turno)
      .input("date", sql.Date, date)
      .query("SELECT * FROM reservations WHERE table_id = @tableId AND turno = @turno AND date = @date");

    if (existing.recordset.length > 0) {
      return res.status(400).json({ error: "Mesa ya reservada en ese turno" });
    }

    // Insertar la reserva
    const result = await connection
      .request()
      .input("tableId", sql.Int, tableId)
      .input("turno", sql.NVarChar, turno)
      .input("date", sql.Date, date)
      .input("username", sql.NVarChar, req.user.username)
      .query(
        "INSERT INTO reservations (table_id, turno, date, username) VALUES (@tableId, @turno, @date, @username); SELECT SCOPE_IDENTITY() as id"
      );

    res.status(201).json({
      id: result.recordset[0].id,
      tableId,
      turno,
      date,
      username: req.user.username,
    });
  } catch (error) {
    console.error("❌ Error al realizar reserva:", error);
    res.status(500).json({ error: "No se pudo realizar la reserva", details: error.message });
  } finally {
    if (connection) connection.close();
  }
});

// ✅ Iniciar el servidor
app.listen(3001, () => {
  console.log("🚀 Servidor corriendo en http://localhost:3001");
});