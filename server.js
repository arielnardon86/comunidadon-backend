import express from 'express';
import sql from 'mssql';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import cors from 'cors';
import 'dotenv/config';

const app = express();
app.use(cors());
app.use(express.json());

// Configuración de la única base de datos
const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_HOST,
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT) || 1433,
  options: {
    encrypt: true,
    trustServerCertificate: false,
    enableArithAbort: true,
  },
  pool: {
    max: 10,
    min: 2,
    idleTimeoutMillis: 60000,
    acquireTimeoutMillis: 60000,
    createTimeoutMillis: 60000,
    destroyTimeoutMillis: 60000,
  },
  requestTimeout: 60000,
  connectionTimeout: 60000,
};

// Pool de conexión único para la base de datos communityon
let poolPromise;

const initializePool = async () => {
  try {
    console.log("Inicializando pool de conexión a la base de datos...");
    console.log("Configuración de la base de datos:", {
      user: "****",
      password: "****",
      server: dbConfig.server,
      database: dbConfig.database,
      port: dbConfig.port,
    });
    poolPromise = new sql.ConnectionPool(dbConfig).connect();
    const pool = await poolPromise;
    console.log("✅ Pool de conexión inicializado correctamente");
    return pool;
  } catch (error) {
    console.error("❌ Error al inicializar el pool de conexión:", error);
    process.exit(1);
  }
};

// Middleware para verificar el token
const verifyToken = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Token no proporcionado" });

  try {
    const decoded = jwt.verify(token, process.env.SECRET_KEY || "secret");
    req.user = decoded;
    next();
  } catch (error) {
    console.error("Error al verificar el token:", error);
    res.status(401).json({ error: "Token inválido" });
  }
};

// Middleware para verificar que el usuario es admin y pertenece al edificio
const verifyAdminForBuilding = (req, res, next) => {
  if (req.user.username !== "admin") {
    return res.status(403).json({ error: "Acceso denegado: No eres administrador" });
  }
  if (req.user.building !== req.building) {
    return res.status(403).json({ error: "Acceso denegado: No perteneces a este edificio" });
  }
  next();
};

// Middleware para asignar el building desde la URL
app.use("/:building", (req, res, next) => {
  const building = req.params.building.toLowerCase();
  req.building = building;
  next();
});

// Rutas
const buildingRouter = express.Router();

// Nueva ruta para obtener la lista de edificios
buildingRouter.get("/api/buildings", verifyToken, async (req, res) => {
  try {
    const pool = await poolPromise;
    const request = pool.request();
    // Consulta para obtener edificios únicos desde la tabla users
    const result = await request.query(
      "SELECT DISTINCT building FROM users"
    );
    const buildings = result.recordset.map(row => row.building);
    res.json(buildings);
  } catch (error) {
    console.error("Error al obtener los edificios:", error);
    res.status(500).json({ error: "Error al obtener los edificios" });
  }
});

// Nueva ruta temporal para background
buildingRouter.get("/api/background", (req, res) => { // Sin autenticación por ahora
  res.json({ backgroundImage: "/images/default-portada.jpg" });
});

// Login
buildingRouter.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  const building = req.building;

  try {
    const pool = await poolPromise;
    const request = pool.request();
    request.input("username", sql.NVarChar, username);
    request.input("building", sql.NVarChar, building);
    const result = await request.query(
      "SELECT * FROM users WHERE username = @username AND building = @building"
    );

    const user = result.recordset[0];
    if (!user) {
      return res.status(401).json({ error: "Usuario no encontrado" });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ error: "Contraseña incorrecta" });
    }

    const token = jwt.sign(
      { username: user.username, building: user.building },
      process.env.SECRET_KEY || "secret",
      { expiresIn: "1h" }
    );
    res.json({ token });
  } catch (error) {
    console.error(`Error al iniciar sesión en ${building}:`, error);
    res.status(500).json({ error: "Error al iniciar sesión" });
  }
});

// Registro (solo para admins)
buildingRouter.post("/api/register", verifyToken, verifyAdminForBuilding, async (req, res) => {
  const { username, password, phone_number, email } = req.body;
  const building = req.building;

  try {
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    const pool = await poolPromise;
    const request = pool.request();
    request.input("username", sql.NVarChar, username);
    request.input("password", sql.NVarChar, hashedPassword);
    request.input("phone_number", sql.NVarChar, phone_number);
    request.input("email", sql.NVarChar, email);
    request.input("building", sql.NVarChar, building);

    await request.query(
      `INSERT INTO users (username, password, phone_number, email, building)
       VALUES (@username, @password, @phone_number, @email, @building)`
    );

    res.status(201).json({ message: "Usuario registrado correctamente" });
  } catch (error) {
    console.error(`Error al registrar usuario en ${building}:`, error);
    if (error.number === 2627) { // Violación de clave única (username)
      res.status(400).json({ error: "El username ya está en uso" });
    } else {
      res.status(500).json({ error: "Error al registrar usuario" });
    }
  }
});

// Obtener mesas
buildingRouter.get("/api/tables", verifyToken, async (req, res) => {
  const building = req.building;
  try {
    const pool = await poolPromise;
    const request = pool.request();
    request.input("building", sql.NVarChar, building);
    const result = await request.query(
      "SELECT * FROM tables WHERE building = @building"
    );
    res.json(result.recordset);
  } catch (error) {
    console.error(`Error al obtener mesas para ${building}:`, error);
    res.status(500).json({ error: "Error al obtener las mesas" });
  }
});

// Obtener turnos disponibles
buildingRouter.get("/api/turns", verifyToken, async (req, res) => {
  const building = req.building;
  try {
    const pool = await poolPromise;
    const request = pool.request();
    request.input("building", sql.NVarChar, building);
    const result = await request.query(
      "SELECT * FROM turns WHERE building = @building"
    );
    res.json(result.recordset);
  } catch (error) {
    console.error(`Error al obtener turnos para ${building}:`, error);
    res.status(500).json({ error: "Error al obtener los turnos" });
  }
});

// Obtener reservas (incluye el phone_number del usuario)
buildingRouter.get("/api/reservations", verifyToken, async (req, res) => {
  const building = req.building;
  try {
    const pool = await poolPromise;
    const request = pool.request();
    request.input("building", sql.NVarChar, building);
    const result = await request.query(`
      SELECT r.*, t.name AS turnName, u.phone_number
      FROM reservations r
      JOIN turns t ON r.turnId = t.id
      JOIN users u ON r.username = u.username
      WHERE r.building = @building
    `);
    res.json(result.recordset);
  } catch (error) {
    console.error(`Error al obtener reservas para ${building}:`, error);
    res.status(500).json({ error: "Error al obtener las reservas" });
  }
});

// Crear una reserva
buildingRouter.post("/api/reservations", verifyToken, async (req, res) => {
  const { tableId, turnId, date } = req.body;
  const building = req.building;
  const username = req.user.username;

  try {
    const pool = await poolPromise;
    const request = pool.request();
    request.input("tableId", sql.Int, tableId);
    request.input("turnId", sql.Int, turnId);
    request.input("date", sql.Date, date);
    request.input("username", sql.NVarChar, username);
    request.input("building", sql.NVarChar, building);

    // Verificar que la mesa y el turno pertenezcan al edificio
    const tableCheck = await pool.request()
      .input("tableId", sql.Int, tableId)
      .input("building", sql.NVarChar, building)
      .query("SELECT * FROM tables WHERE id = @tableId AND building = @building");
    if (tableCheck.recordset.length === 0) {
      return res.status(400).json({ error: "Mesa no encontrada para este edificio" });
    }

    const turnCheck = await pool.request()
      .input("turnId", sql.Int, turnId)
      .input("building", sql.NVarChar, building)
      .query("SELECT * FROM turns WHERE id = @turnId AND building = @building");
    if (turnCheck.recordset.length === 0) {
      return res.status(400).json({ error: "Turno no encontrado para este edificio" });
    }

    await request.query(
      `INSERT INTO reservations (tableId, turnId, date, username, building)
       VALUES (@tableId, @turnId, @date, @username, @building)`
    );

    res.status(201).json({ message: "Reserva creada correctamente" });
  } catch (error) {
    console.error(`Error al crear reserva en ${building}:`, error);
    if (error.number === 2627) { // Violación de clave única (reserva duplicada)
      res.status(400).json({ error: "Ya existe una reserva para esta mesa, turno y fecha" });
    } else {
      res.status(500).json({ error: "Error al crear la reserva" });
    }
  }
});

// Eliminar una reserva (solo para admins)
buildingRouter.delete("/api/reservations/:id", verifyToken, verifyAdminForBuilding, async (req, res) => {
  const reservationId = req.params.id;
  const building = req.building;

  try {
    const pool = await poolPromise;
    const request = pool.request();
    request.input("id", sql.Int, reservationId);
    request.input("building", sql.NVarChar, building);

    const result = await request.query(
      "DELETE FROM reservations WHERE id = @id AND building = @building"
    );

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: "Reserva no encontrada" });
    }

    res.json({ message: "Reserva eliminada correctamente" });
  } catch (error) {
    console.error(`Error al eliminar reserva en ${building}:`, error);
    res.status(500).json({ error: "Error al eliminar la reserva" });
  }
});

// Aplicar las rutas al app
app.use("/:building", buildingRouter);

// Ruta raíz
app.get("/", (req, res) => {
  res.send("Backend de ComunidadOn");
});

// Iniciar el servidor
const PORT = process.env.PORT || 3001;
initializePool().then(() => {
  app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
  });
});