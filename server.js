import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import sql from "mssql";
import * as dotenv from "dotenv";
import bcrypt from "bcrypt";
import NodeCache from "node-cache";
import initializeModels from "./models/Index.js";

dotenv.config();

// Depuración: Mostrar todas las variables de entorno cargadas
console.log("=== Depuración: Variables de entorno cargadas ===");
console.log("SECRET_KEY:", process.env.SECRET_KEY || "No definido");
console.log("VOW_DB_USER:", process.env.VOW_DB_USER || "No definido");
console.log("VOW_DB_PASSWORD:", process.env.VOW_DB_PASSWORD || "No definido");
console.log("VOW_DB_HOST:", process.env.VOW_DB_HOST || "No definido");
console.log("VOW_DB_NAME:", process.env.VOW_DB_NAME || "No definido");
console.log("Torre_x_DB_USER:", process.env.Torre_x_DB_USER || "No definido");
console.log("Torre_x_DB_PASSWORD:", process.env.Torre_x_DB_PASSWORD || "No definido");
console.log("Torre_x_DB_HOST:", process.env.Torre_x_DB_HOST || "No definido");
console.log("Torre_x_DB_NAME:", process.env.Torre_x_DB_NAME || "No definido");
console.log("==============================================");

// Validar variables de entorno requeridas globalmente
const requiredGlobalEnvVars = ["SECRET_KEY"];
const missingGlobalVars = requiredGlobalEnvVars.filter((varName) => !process.env[varName]);

if (missingGlobalVars.length > 0) {
  console.error(
    `❌ Faltan las siguientes variables de entorno globales: ${missingGlobalVars.join(", ")}`
  );
  process.exit(1);
}

// Función para obtener las configuraciones de todos los edificios dinámicamente
const getBuildingConfigs = () => {
  const dbConfigs = {};
  const buildingPrefixPattern = /^(.+)_DB_(USER|PASSWORD|HOST|NAME|PORT)$/i; // Insensible a mayúsculas

  // Obtener todas las variables de entorno
  const envVars = process.env;
  const envKeys = Object.keys(envVars);

  // Agrupar las variables por edificio
  const buildings = new Set();
  for (const key of envKeys) {
    const match = key.match(buildingPrefixPattern);
    if (match) {
      const building = match[1]; // Mantener el prefijo original (VOW, Torre_x)
      buildings.add(building);
    }
  }

  console.log("Edificios detectados:", Array.from(buildings));

  // Crear configuraciones para cada edificio
  for (const building of buildings) {
    const user = envVars[`${building}_DB_USER`];
    const password = envVars[`${building}_DB_PASSWORD`];
    const host = envVars[`${building}_DB_HOST`];
    const database = envVars[`${building}_DB_NAME`];
    const port = Number(envVars[`${building}_DB_PORT`]) || 1433;

    // Validar que todas las variables requeridas estén presentes
    const missingConfigVars = [];
    if (!user) missingConfigVars.push(`${building}_DB_USER`);
    if (!password) missingConfigVars.push(`${building}_DB_PASSWORD`);
    if (!host) missingConfigVars.push(`${building}_DB_HOST`);
    if (!database) missingConfigVars.push(`${building}_DB_NAME`);

    if (missingConfigVars.length > 0) {
      console.error(
        `❌ Faltan las siguientes configuraciones para el edificio ${building}: ${missingConfigVars.join(", ")}`
      );
      process.exit(1);
    }

    // Normalizar la clave del edificio a minúsculas para dbConfigs
    const buildingKey = building.toLowerCase().replace(/_/g, "-"); // Convertir Torre_x a torre-x
    dbConfigs[buildingKey] = {
      user,
      password,
      server: host,
      database,
      port,
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

    console.log(`✅ Configuración válida para ${buildingKey}:`, {
      user: "****",
      password: "****",
      server: host,
      database,
      port,
    });
  }

  if (Object.keys(dbConfigs).length === 0) {
    console.error("❌ No se encontraron configuraciones de bases de datos para ningún edificio.");
    process.exit(1);
  }

  return dbConfigs;
};

// Obtener las configuraciones de los edificios
const dbConfigs = getBuildingConfigs();

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

// Inicializar los modelos con los pools de conexión
const models = initializeModels(pools);

// Inicializar el caché con un TTL de 10 minutos
const cache = new NodeCache({ stdTTL: 600 });

// Configuración de información de los edificios para /api/club-info
const clubInfoConfig = {
  vow: {
    title: "Información del Club Vow",
    backgroundImage: null,
    textColor: "#2d3748",
    regulation: {
      rules: ["Respetar los horarios establecidos", "No hacer ruidos molestos", "Mantener el espacio limpio"],
    },
    horarios: {
      mediodia: "Todos los días: 12:00 a 16:00",
      noche: [
        "Domingo a Jueves: 20:00 a 01:00",
        "Viernes y Sábados: 20:00 a 02:00",
      ],
    },
    servicios: [
      { icon: "faWifi", text: "Wifi" },
      { icon: "faTv", text: "TV" },
      { icon: "faToilet", text: "Baños" },
      { icon: "faParking", text: "Estacionamiento" },
      { icon: "faMedkit", text: "Seguro Médico" },
      { icon: "faBanSmoking", text: "Prohibido fumar" },
      { icon: "faBirthdayCake", text: "Cumpleaños" },
      { icon: "faUtensils", text: "Parrilla" },
    ],
  },
  "torre-x": {
    title: "Información del Club Torre X",
    backgroundImage: null,
    textColor: "#4a5568",
    regulation: {
      rules: ["Prohibido traer bebidas alcohólicas", "No se permiten mascotas", "Respetar el aforo máximo"],
    },
    horarios: {
      mediodia: "Lunes a Viernes: 11:00 a 15:00",
      noche: [
        "Domingo a Jueves: 19:00 a 23:00",
        "Viernes y Sábados: 19:00 a 00:00",
      ],
    },
    servicios: [
      { icon: "faWifi", text: "Wifi" },
      { icon: "faTv", text: "TV" },
      { icon: "faToilet", text: "Baños" },
      { icon: "faParking", text: "Estacionamiento" },
      { icon: "faGlassCheers", text: "Eventos sociales" },
      { icon: "faHome", text: "Espacios familiares" },
    ],
  },
  "miraflores-i": {
    title: "Información del Club Miraflores I",
    backgroundImage: null,
    textColor: "#1a202c",
    regulation: {
      rules: [
        "Prohibido el ingreso de alimentos externos",
        "Respetar el horario de cierre",
        "No se permiten eventos sin autorización previa",
      ],
    },
    horarios: {
      mediodia: "Todos los días: 11:30 a 15:30",
      noche: [
        "Domingo a Jueves: 18:30 a 22:30",
        "Viernes y Sábados: 18:30 a 23:30",
      ],
    },
    servicios: [
      { icon: "faWifi", text: "Wifi" },
      { icon: "faTv", text: "TV" },
      { icon: "faToilet", text: "Baños" },
      { icon: "faParking", text: "Estacionamiento" },
      { icon: "faUtensils", text: "Cocina equipada" },
      { icon: "faBirthdayCake", text: "Eventos y cumpleaños" },
    ],
  },
  default: {
    title: "Información del Club",
    backgroundImage: null,
    textColor: "#718096",
    regulation: {
      rules: ["Reglamento no disponible", "Contacta al administrador"],
    },
    horarios: {
      mediodia: "No disponible",
      noche: ["No disponible"],
    },
    servicios: [],
  },
};

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

// Rutas estáticas (definidas ANTES del middleware dinámico /:building)
app.get("/", (req, res) => {
  res.status(200).json({ message: "Bienvenido al backend de ComunidadOn" });
});

// Nueva ruta para obtener la lista de edificios disponibles
app.get("/api/buildings", (req, res) => {
  const buildings = Object.keys(dbConfigs);
  res.status(200).json(buildings);
});

// Crear un router para las rutas que dependen de :building
const buildingRouter = express.Router();

// Middleware para determinar el edificio desde la URL
app.use("/:building", (req, res, next) => {
  const building = req.params.building.toLowerCase(); // Normalizar a minúsculas

  console.log(`Ruta completa: ${req.originalUrl}`);
  console.log(`Building desde URL: ${building}`);

  if (!dbConfigs[building]) {
    console.error(`❌ Configuración de base de datos no encontrada para building: ${building}`);
    return res.status(400).json({ error: `Edificio no encontrado: ${building}` });
  }

  req.building = building;
  next();
}, buildingRouter);

// Función para obtener una conexión del pool según el edificio
async function getDBConnection(req) {
  try {
    return await pools[req.building].connect();
  } catch (err) {
    console.error(`❌ Error al obtener conexión a la BD para ${req.building}:`, err);
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

// Rutas dentro del router (se aplican después de /:building)

// Nueva ruta para obtener la información del club
buildingRouter.get("/api/club-info", verifyToken, (req, res) => {
  const building = req.building;
  const clubInfo = clubInfoConfig[building] || clubInfoConfig.default;
  res.status(200).json(clubInfo);
});

buildingRouter.get("/api/login", (req, res) => {
  res.status(405).json({ error: "Método no permitido. Usa POST para iniciar sesión." });
});

buildingRouter.post("/api/register", verifyToken, verifyAdmin, async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "Username y password son obligatorios" });
  }

  let connection;
  try {
    connection = await getDBConnection(req);

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
    console.error(`❌ Error al registrar usuario en ${req.building}:`, error);
    res.status(500).json({ error: "No se pudo registrar el usuario", details: error.message });
  } finally {
    if (connection) connection.close();
  }
});

buildingRouter.post("/api/login", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "Username y password son obligatorios" });
  }

  let connection;
  try {
    connection = await getDBConnection(req);

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

    const token = jwt.sign({ username: user.username, building: req.building }, SECRET_KEY, {
      expiresIn: "1h",
    });
    res.status(200).json({ message: "Login exitoso", token });
  } catch (error) {
    console.error(`❌ Error al iniciar sesión en ${req.building}:`, error);
    res.status(500).json({ error: "Error al iniciar sesión", details: error.message });
  } finally {
    if (connection) connection.close();
  }
});

buildingRouter.get("/api/test-db", async (req, res) => {
  let connection;
  try {
    connection = await getDBConnection(req);
    const result = await connection.request().query("SELECT 1 + 1 AS result");
    res.json({ success: true, result: result.recordset[0].result });
  } catch (error) {
    console.error(`❌ Error al conectar con la BD de ${req.building}:`, error);
    res.status(500).json({ error: "Error al conectar con la base de datos", details: error.message });
  } finally {
    if (connection) connection.close();
  }
});

buildingRouter.get("/api/tables", verifyToken, async (req, res) => {
  try {
    const tables = await models[req.building].Table.getAllTables();
    res.status(200).json(tables);
  } catch (error) {
    console.error(`❌ Error al obtener mesas de ${req.building}:`, error);
    res.status(500).json({ error: "No se pudieron obtener las mesas", details: error.message });
  }
});

buildingRouter.get("/api/reservations", verifyToken, async (req, res) => {
  try {
    const cacheKey = `reservations_${req.building}`;
    const cachedReservations = cache.get(cacheKey);
    if (cachedReservations) {
      console.log(`✅ Devolviendo reservas desde caché para ${req.building}`);
      return res.status(200).json(cachedReservations);
    }

    const reservations = await models[req.building].Reservation.getAllReservations();
    cache.set(cacheKey, reservations);
    console.log(`✅ Reservas obtenidas de la BD y guardadas en caché para ${req.building}`);
    res.status(200).json(reservations);
  } catch (error) {
    console.error(`❌ Error al obtener reservas de ${req.building}:`, error);
    res.status(500).json({ error: "No se pudieron obtener las reservas", details: error.message });
  }
});

buildingRouter.post("/api/reservations", verifyToken, async (req, res) => {
  const { tableId, turno, date } = req.body;

  if (!tableId || !turno || !date) {
    return res.status(400).json({ error: "Todos los campos son obligatorios" });
  }

  try {
    const newReservation = await models[req.building].Reservation.createReservation({
      tableId,
      turno,
      date,
      username: req.user.username,
    });

    // Invalidar el caché después de crear una reserva
    cache.del(`reservations_${req.building}`);
    console.log(
      `✅ Caché de reservas invalidado después de crear una nueva reserva en ${req.building}`
    );

    res.status(201).json(newReservation);
  } catch (error) {
    console.error(`❌ Error al realizar reserva en ${req.building}:`, error);
    res.status(500).json({ error: "No se pudo realizar la reserva", details: error.message });
  }
});

buildingRouter.delete("/api/reservations/:id", verifyToken, verifyAdmin, async (req, res) => {
  const reservationId = req.params.id;

  try {
    const result = await models[req.building].Reservation.deleteReservation(reservationId);

    // Invalidar el caché después de cancelar una reserva
    cache.del(`reservations_${req.building}`);
    console.log(
      `✅ Caché de reservas invalidado después de cancelar una reserva en ${req.building}`
    );

    res.json(result);
  } catch (error) {
    console.error(`❌ Error al cancelar la reserva en ${req.building}:`, error);
    res.status(500).json({ error: "Error al cancelar la reserva", details: error.message });
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