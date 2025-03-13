import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import sql from "mssql";
import * as dotenv from "dotenv";
import bcrypt from "bcrypt";
import NodeCache from "node-cache";

dotenv.config();

// Validar variables de entorno
const requiredEnvVars = ["SECRET_KEY"];
const missingVars = requiredEnvVars.filter((varName) => !process.env[varName]);

if (missingVars.length > 0) {
  console.error(
    `❌ Faltan las siguientes variables de entorno: ${missingVars.join(", ")}`
  );
  process.exit(1);
}

console.log("Valores de entorno cargados:");
console.log("SECRET_KEY:", process.env.SECRET_KEY ? "****" : "No definido");
console.log("Torre_x_DB_USER:", process.env.Torre_x_DB_USER ? "****" : "No definido");
console.log("Torre_x_DB_PASSWORD:", process.env.Torre_x_DB_PASSWORD ? "****" : "No definido");
console.log("Torre_x_DB_HOST:", process.env.Torre_x_DB_HOST ? "****" : "No definido");
console.log("Torre_x_DB_NAME:", process.env.Torre_x_DB_NAME ? "****" : "No definido");
console.log("VOW_DB_USER:", process.env.VOW_DB_USER ? "****" : "No definido");
console.log("VOW_DB_PASSWORD:", process.env.VOW_DB_PASSWORD ? "****" : "No definido");
console.log("VOW_DB_HOST:", process.env.VOW_DB_HOST ? "****" : "No definido");
console.log("VOW_DB_NAME:", process.env.VOW_DB_NAME ? "****" : "No definido");

// Configuración de bases de datos por edificio
const dbConfigs = {
  vow: {
    user: process.env.VOW_DB_USER,
    password: process.env.VOW_DB_PASSWORD,
    server: process.env.VOW_DB_HOST,
    database: process.env.VOW_DB_NAME,
    port: Number(process.env.VOW_DB_PORT) || 1433,
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
  },
  Torre_x: {
    user: process.env.Torre_x_DB_USER,
    password: process.env.Torre_x_DB_PASSWORD,
    server: process.env.Torre_x_DB_HOST,
    database: process.env.Torre_x_DB_NAME,
    port: Number(process.env.Torre_x_DB_PORT) || 1433,
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
  },
};

// Validar configuraciones de bases de datos con más detalle
for (const [building, config] of Object.entries(dbConfigs)) {
  const missingConfigVars = ["user", "password", "server", "database"].filter(
    (key) => !config[key]
  );
  if (missingConfigVars.length > 0) {
    console.error(
      `❌ Faltan las siguientes configuraciones para el edificio ${building}: ${missingConfigVars.join(
        ", "
      )}`
    );
    process.exit(1);
  }
  console.log(`✅ Configuración válida para ${building}:`, config);
}

// Crear pools de conexión para cada edificio
const pools = {};
for (const [building, config] of Object.entries(dbConfigs)) {
  pools[building] = new sql.ConnectionPool(config);
  pools[building]
    .connect()
    .then(() => console.log(`✅ Conectado a Azure SQL para ${building}`))
    .catch((err) => {
      console.error(`❌ Error al conectar al pool de ${building}:`, err);
      process.exit(1);
    });
}

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

// Mapeo de nombres de edificios desde la URL a las claves en dbConfigs
const buildingMap = {
  "vow": "vow",
  "torre-x": "Torre_x",
};

// Middleware para determinar el edificio desde la URL
app.use("/:building", (req, res, next) => {
  const buildingFromUrl = req.params.building;
  const building = buildingMap[buildingFromUrl];

  console.log(`Ruta completa: ${req.originalUrl}`);
  console.log(`Building desde URL (req.params.building): ${buildingFromUrl}, mapeado a: ${building}`);
  console.log(`dbConfigs[${building}]:`, dbConfigs[building] ? "Definido" : "No definido");

  if (!building) {
    console.error(`❌ No se encontró mapeo para building: ${buildingFromUrl}`);
    return res.status(400).json({ error: "Building no mapeado correctamente" });
  }
  if (!dbConfigs[building]) {
    console.error(`❌ Configuración de base de datos no encontrada para building: ${building}`);
    return res.status(500).json({ error: "Configuración de base de datos no encontrada para el edificio" });
  }

  req.building = building;
  next();
});

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

// Ruta raíz para evitar el error "Cannot GET /"
app.get("/", (req, res) => {
  res.status(200).json({ message: "Bienvenido al backend de ComunidadOn" });
});

// Definir las rutas específicas
app.post("/:building/api/login", async (req, res) => {
  console.log(`📥 Solicitud recibida en /${req.params.building}/api/login`);
  const { username, password } = req.body;

  if (!username || !password) {
    console.log(`❌ Validación fallida: Username o password no proporcionados`);
    return res.status(400).json({ error: "Username y password son obligatorios" });
  }

  let connection;
  try {
    connection = await pools[req.building].connect();
    console.log(`✅ Conexión a la base de datos establecida para ${req.building}`);

    const result = await connection
      .request()
      .input("username", sql.NVarChar, username)
      .query("SELECT * FROM users WHERE username = @username");

    if (result.recordset.length === 0) {
      console.log(`❌ Usuario no encontrado: ${username}`);
      return res.status(401).json({ error: "Usuario no encontrado" });
    }

    const user = result.recordset[0];
    console.log(`✅ Usuario encontrado: ${username}`);
    const match = await bcrypt.compare(password, user.password);

    if (!match) {
      console.log(`❌ Contraseña incorrecta para usuario: ${username}`);
      return res.status(401).json({ error: "Contraseña incorrecta" });
    }

    const token = jwt.sign({ username: user.username, building: req.building }, SECRET_KEY, {
      expiresIn: "1h",
    });
    console.log(`✅ Login exitoso para ${username}, token generado`);
    res.status(200).json({ message: "Login exitoso", token });
  } catch (error) {
    console.error(`❌ Error al iniciar sesión en ${req.building}:`, error);
    res.status(500).json({ error: "Error al iniciar sesión", details: error.message });
  } finally {
    if (connection) connection.close();
    console.log(`🔚 Conexión cerrada para ${req.building}`);
  }
});

app.post("/:building/api/register", verifyToken, verifyAdmin, async (req, res) => {
  console.log(`📥 Solicitud recibida en /${req.params.building}/api/register`);
  const { username, password } = req.body;

  if (!username || !password) {
    console.log(`❌ Validación fallida: Username o password no proporcionados`);
    return res.status(400).json({ error: "Username y password son obligatorios" });
  }

  let connection;
  try {
    connection = await pools[req.building].connect();
    console.log(`✅ Conexión a la base de datos establecida para ${req.building}`);

    const existingUser = await connection
      .request()
      .input("username", sql.NVarChar, username)
      .query("SELECT * FROM users WHERE username = @username");

    if (existingUser.recordset.length > 0) {
      console.log(`❌ Usuario ya existe: ${username}`);
      return res.status(400).json({ error: "El username ya está en uso" });
    }

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    await connection
      .request()
      .input("username", sql.NVarChar, username)
      .input("password", sql.NVarChar, hashedPassword)
      .query("INSERT INTO users (username, password) VALUES (@username, @password)");

    console.log(`✅ Usuario registrado: ${username}`);
    res.status(201).json({ message: "Usuario registrado con éxito" });
  } catch (error) {
    console.error(`❌ Error al registrar usuario en ${req.building}:`, error);
    res.status(500).json({ error: "No se pudo registrar el usuario", details: error.message });
  } finally {
    if (connection) connection.close();
    console.log(`🔚 Conexión cerrada para ${req.building}`);
  }
});

app.get("/:building/api/test-db", async (req, res) => {
  console.log(`📥 Solicitud recibida en /${req.params.building}/api/test-db`);
  let connection;
  try {
    connection = await pools[req.building].connect();
    const result = await connection.request().query("SELECT 1 + 1 AS result");
    res.json({ success: true, result: result.recordset[0].result });
  } catch (error) {
    console.error(`❌ Error al conectar con la BD de ${req.building}:`, error);
    res.status(500).json({ error: "Error al conectar con la base de datos", details: error.message });
  } finally {
    if (connection) connection.close();
  }
});

app.get("/:building/api/tables", verifyToken, async (req, res) => {
  console.log(`📥 Solicitud recibida en /${req.params.building}/api/tables`);
  let connection;
  try {
    connection = await pools[req.building].connect();
    const result = await connection.request().query("SELECT * FROM tables");
    res.status(200).json(result.recordset);
  } catch (error) {
    console.error(`❌ Error al obtener mesas de ${req.building}:`, error);
    res.status(500).json({ error: "No se pudieron obtener las mesas", details: error.message });
  } finally {
    if (connection) connection.close();
  }
});

app.get("/:building/api/reservations", verifyToken, async (req, res) => {
  console.log(`📥 Solicitud recibida en /${req.params.building}/api/reservations`);
  let connection;
  try {
    const cacheKey = `reservations_${req.building}`;
    const cachedReservations = cache.get(cacheKey);
    if (cachedReservations) {
      console.log(`✅ Devolviendo reservas desde caché para ${req.building}`);
      return res.status(200).json(cachedReservations);
    }

    connection = await pools[req.building].connect();
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
    console.log(`✅ Reservas obtenidas de la BD y guardadas en caché para ${req.building}`);
    res.status(200).json(formattedReservations);
  } catch (error) {
    console.error(`❌ Error al obtener reservas de ${req.building}:`, error);
    res.status(500).json({ error: "No se pudieron obtener las reservas", details: error.message });
  } finally {
    if (connection) connection.close();
  }
});

app.post("/:building/api/reservations", verifyToken, async (req, res) => {
  console.log(`📥 Solicitud recibida en /${req.params.building}/api/reservations`);
  const { tableId, turno, date } = req.body;

  if (!tableId || !turno || !date) {
    return res.status(400).json({ error: "Todos los campos son obligatorios" });
  }

  let connection;
  try {
    connection = await pools[req.building].connect();

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

    cache.del(`reservations_${req.building}`);
    console.log(
      `✅ Caché de reservas invalidado después de crear una nueva reserva en ${req.building}`
    );

    res.status(201).json(newReservation);
  } catch (error) {
    console.error(`❌ Error al realizar reserva en ${req.building}:`, error);
    res.status(500).json({ error: "No se pudo realizar la reserva", details: error.message });
  } finally {
    if (connection) connection.close();
  }
});

app.delete("/:building/api/reservations/:id", verifyToken, verifyAdmin, async (req, res) => {
  console.log(`📥 Solicitud recibida en /${req.params.building}/api/reservations/${req.params.id}`);
  const reservationId = req.params.id;

  let connection;
  try {
    connection = await pools[req.building].connect();

    const result = await connection
      .request()
      .input("id", sql.Int, reservationId)
      .query("DELETE FROM reservations WHERE id = @id");

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: "Reserva no encontrada" });
    }

    cache.del(`reservations_${req.building}`);
    console.log(
      `✅ Caché de reservas invalidado después de cancelar una reserva en ${req.building}`
    );

    res.json({ message: "Reserva cancelada con éxito" });
  } catch (err) {
    console.error(`❌ Error al cancelar la reserva en ${req.building}:`, err);
    res.status(500).json({ error: "Error al cancelar la reserva", details: err.message });
  } finally {
    if (connection) connection.close();
  }
});

// Middleware para manejar rutas no encontradas
app.use((req, res) => {
  console.error(`❌ Ruta no encontrada: ${req.originalUrl}`);
  res.status(404).json({ error: "Ruta no encontrada" });
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