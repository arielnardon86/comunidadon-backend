import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import sql from "mssql";
import * as dotenv from "dotenv";
import bcrypt from "bcrypt";
import NodeCache from "node-cache";

dotenv.config();

// Validar variables de entorno
const requiredEnvVars = [
  "DB_HOST",
  "DB_USER",
  "DB_PASSWORD",
  "DB_NAME",
  "SECRET_KEY",
];
const missingVars = requiredEnvVars.filter((varName) => !process.env[varName]);

if (missingVars.length > 0) {
  console.error(
    `❌ Faltan las siguientes variables de entorno: ${missingVars.join(", ")}`
  );
  process.exit(1);
}

console.log("Valores de entorno cargados:");
console.log("DB_HOST:", process.env.DB_HOST);
console.log("DB_USER:", process.env.DB_USER);
console.log("DB_PASSWORD:", process.env.DB_PASSWORD ? "****" : "No definido");
console.log("DB_NAME:", process.env.DB_NAME);
console.log("DB_PORT:", process.env.DB_PORT);
console.log("SECRET_KEY:", process.env.SECRET_KEY ? "****" : "No definido");

// Inicializar el caché con un TTL de 10 minutos
const cache = new NodeCache({ stdTTL: 600 });

const app = express();

// Configurar CORS
const allowedOrigins = [
  "http://localhost:5173",
  "https://communityon.vercel.app",
];
app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Origen no permitido por CORS: ${origin}`));
      }
    },
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

app.use(express.json());

// Middleware para manejar errores de CORS
app.use((err, req, res, next) => {
  if (err.message.includes("CORS")) {
    console.error(`❌ Error de CORS: ${err.message}`);
    return res.status(403).json({ error: "Acceso denegado por política CORS" });
  }
  next(err);
});

const SECRET_KEY = process.env.SECRET_KEY;

// Configuración del pool de conexiones a Azure SQL
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

// Conectar al pool al iniciar
pool
  .connect()
  .then(() => console.log("✅ Conectado a Azure SQL"))
  .catch((err) => {
    console.error("❌ Error al conectar al pool:", err);
    process.exit(1);
  });

// Función para obtener una conexión del pool
async function getDBConnection() {
  try {
    return await pool.connect();
  } catch (err) {
    console.error("❌ Error al obtener conexión a la BD:", err);
    throw err;
  }
}

// Middleware para verificar token
const verifyToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  if (!authHeader) {
    return res.status(403).json({ error: "Acceso denegado: Token no proporcionado" });
  }

  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(403).json({ error: "Acceso denegado: Token mal formado" });
  }

  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    req.user = decoded;
    next();
  } catch (err) {
    console.error("❌ Error al verificar token:", err.message);
    return res.status(401).json({ error: "Token inválido o expirado" });
  }
};

// Middleware para verificar si el usuario es admin
const verifyAdmin = (req, res, next) => {
  if (req.user.username !== "admin") {
    return res.status(403).json({ error: "Acceso denegado: Solo el admin puede realizar esta acción" });
  }
  next();
};

// Ruta de registro de nuevos usuarios (restringida a admin)
app.post("/api/register", verifyToken, verifyAdmin, async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "Username y password son obligatorios" });
  }

  let connection;
  try {
    connection = await getDBConnection();

    // Verificar si el username ya existe
    const existingUser = await connection
      .request()
      .input("username", sql.NVarChar, username)
      .query("SELECT * FROM users WHERE username = @username");

    if (existingUser.recordset.length > 0) {
      return res.status(400).json({ error: "El username ya está en uso" });
    }

    // Hashear la contraseña con bcrypt
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Insertar nuevo usuario
    await connection
      .request()
      .input("username", sql.NVarChar, username)
      .input("password", sql.NVarChar, hashedPassword)
      .query("INSERT INTO users (username, password) VALUES (@username, @password)");

    res.status(201).json({ message: "Usuario registrado con éxito" });
  } catch (error) {
    console.error("❌ Error al registrar usuario:", error);
    res.status(500).json({ error: "No se pudo registrar el usuario", details: error.message });
  } finally {
    if (connection) connection.close();
  }
});

// Ruta de login
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "Username y password son obligatorios" });
  }

  let connection;
  try {
    connection = await getDBConnection();

    const result = await connection
      .request()
      .input("username", sql.NVarChar, username)
      .query("SELECT * FROM users WHERE username = @username");

    if (result.recordset.length === 0) {
      return res.status(401).json({ error: "Usuario no encontrado" });
    }

    const user = result.recordset[0];
    const match = await bcrypt.compare(password, user.password);

    if (!match) {
      return res.status(401).json({ error: "Contraseña incorrecta" });
    }

    const token = jwt.sign({ username: user.username }, SECRET_KEY, { expiresIn: "1h" });
    res.status(200).json({ message: "Login exitoso", token });
  } catch (error) {
    console.error("❌ Error al iniciar sesión:", error);
    res.status(500).json({ error: "Error al iniciar sesión", details: error.message });
  } finally {
    if (connection) connection.close();
  }
});

// Ruta de prueba para verificar conexión a Azure SQL
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

// Ruta para obtener las mesas
app.get("/api/tables", verifyToken, async (req, res) => {
  let connection;
  try {
    connection = await getDBConnection();
    const result = await connection.request().query("SELECT * FROM tables");
    res.status(200).json(result.recordset);
  } catch (error) {
    console.error("❌ Error al obtener mesas:", error);
    res.status(500).json({ error: "No se pudieron obtener las mesas", details: error.message });
  } finally {
    if (connection) connection.close();
  }
});

// Ruta para obtener las reservas (con caché)
app.get("/api/reservations", verifyToken, async (req, res) => {
  let connection;
  try {
    const cacheKey = "reservations";
    const cachedReservations = cache.get(cacheKey);
    if (cachedReservations) {
      console.log("✅ Devolviendo reservas desde caché");
      return res.status(200).json(cachedReservations);
    }

    connection = await getDBConnection();
    const result = await connection
      .request()
      .query("SELECT id, table_id, turno, date, username FROM reservations");
    const formattedReservations = result.recordset.map((res) => ({
      id: res.id,
      tableId: res.table_id,
      turno: res.turno,
      date: res.date.toISOString().split("T")[0],
      username: res.username,
    }));
    cache.set(cacheKey, formattedReservations);
    console.log("✅ Reservas obtenidas de la BD y guardadas en caché");
    res.status(200).json(formattedReservations);
  } catch (error) {
    console.error("❌ Error al obtener reservas:", error);
    res.status(500).json({ error: "No se pudieron obtener las reservas", details: error.message });
  } finally {
    if (connection) connection.close();
  }
});

// Ruta para crear una nueva reserva
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
      .query(
        "SELECT * FROM reservations WHERE table_id = @tableId AND turno = @turno AND date = @date"
      );

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

    const newReservation = {
      id: result.recordset[0].id,
      tableId,
      turno,
      date: new Date(date).toISOString().split("T")[0],
      username: req.user.username,
    };

    // Invalidar el caché después de crear una reserva
    cache.del("reservations");
    console.log("✅ Caché de reservas invalidado después de crear una nueva reserva");

    res.status(201).json(newReservation);
  } catch (error) {
    console.error("❌ Error al realizar reserva:", error);
    res.status(500).json({ error: "No se pudo realizar la reserva", details: error.message });
  } finally {
    if (connection) connection.close();
  }
});

// Middleware para manejar errores generales
app.use((err, req, res, next) => {
  console.error("❌ Error en el servidor:", err);
  res.status(500).json({ error: "Error interno del servidor", details: err.message });
});

// Iniciar el servidor con puerto dinámico para Render
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});