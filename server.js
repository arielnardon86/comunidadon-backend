import express from 'express';
import sql from 'mssql';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import cors from 'cors';
import 'dotenv/config';

const app = express();
app.use(cors());
app.use(express.json());
app.use('/images', express.static('public/images')); // Sirve archivos desde backend/public/images

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

let poolPromise;

const initializePool = async () => {
  try {
    console.log("Inicializando pool de conexión a la base de datos...");
    poolPromise = new sql.ConnectionPool(dbConfig).connect();
    const pool = await poolPromise;
    console.log("✅ Pool de conexión inicializado correctamente");
    return pool;
  } catch (error) {
    console.error("❌ Error al inicializar el pool de conexión:", error);
    throw error;
  }
};

const startServer = async () => {
  try {
    await initializePool();

    const verifyToken = async (req, res, next) => {
      const token = req.headers.authorization?.split(" ")[1];
      if (!token) return res.status(401).json({ error: "Token no proporcionado" });

      try {
        const decoded = jwt.verify(token, process.env.SECRET_KEY || "secret");
        req.user = decoded;
        console.log("Token decodificado:", decoded);
        next();
      } catch (error) {
        console.error("Error al verificar el token:", error);
        res.status(401).json({ error: "Token inválido" });
      }
    };

    const verifyAdminForBuilding = (req, res, next) => {
      if (req.user.username !== "admin") {
        return res.status(403).json({ error: "Acceso denegado: No eres administrador" });
      }
      console.log("Comparando building:", req.user.building, "con", req.building);
      if (req.user.building.toLowerCase() !== req.building.toLowerCase()) {
        return res.status(403).json({ error: "Acceso denegado: No perteneces a este edificio" });
      }
      next();
    };

    app.use("/:building", (req, res, next) => {
      const building = req.params.building.toLowerCase().replace(/\s+/g, "-");
      req.building = building;
      next();
    });

    const buildingRouter = express.Router();

    buildingRouter.post("/api/login", async (req, res) => {
      const { username, password } = req.body;
      const building = req.building;

      try {
        const pool = await poolPromise;
        const request = pool.request();
        request.input("username", sql.NVarChar, username);
        request.input("building", sql.NVarChar, building);
        // Normalizar mayúsculas/minúsculas y espacios/guiones en la comparación
        const result = await request.query(
          `SELECT * FROM users 
           WHERE username = @username 
           AND LOWER(REPLACE(building, ' ', '-')) = LOWER(REPLACE(@building, ' ', '-'))`
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
          { username: user.username, building: user.building.toLowerCase().replace(/\s+/g, "-") },
          process.env.SECRET_KEY || "secret",
          { expiresIn: "1h" }
        );
        res.json({ token });
      } catch (error) {
        console.error(`Error al iniciar sesión en ${building}:`, error);
        res.status(500).json({ error: "Error al iniciar sesión" });
      }
    });

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
        if (error.number === 2627) {
          res.status(400).json({ error: `El username '${username}' ya está en uso para el edificio '${building}'` });
        } else {
          res.status(500).json({ error: "Error al registrar usuario" });
        }
      }
    });

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
        if (error.number === 2627) {
          res.status(400).json({ error: "Ya existe una reserva para esta mesa, turno y fecha" });
        } else {
          res.status(500).json({ error: "Error al crear la reserva" });
        }
      }
    });

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

    app.get("/api/buildings", async (req, res) => {
      try {
        const pool = await poolPromise;
        const request = pool.request();
        const result = await request.query(
          "SELECT DISTINCT building FROM users"
        );
        const buildings = result.recordset.map(row => row.building.toLowerCase().replace(/\s+/g, "-"));
        res.json(buildings);
      } catch (error) {
        console.error("Error al obtener los edificios:", error);
        res.status(500).json({ error: "Error al obtener los edificios" });
      }
    });

    app.get("/api/background/:building", (req, res) => {
      const building = req.params.building.toLowerCase().replace(/\s+/g, "-");
      const backgroundImages = {
        'vow': '/images/vow-background.jpg',
        'torre-del-lago': '/images/torre-del-lago-background.jpg',
      };
      const imagePath = backgroundImages[building] || '/images/default-portada.jpg';
      res.json({ backgroundImage: imagePath });
    });

    app.use("/:building", buildingRouter);

    app.get("/", (req, res) => {
      res.send("Backend de ComunidadOn");
    });

    const PORT = process.env.PORT || 3001;
    app.listen(PORT, () => {
      console.log(`Servidor corriendo en el puerto ${PORT}`);
    });
  } catch (error) {
    console.error("Error al iniciar el servidor:", error);
    process.exit(1);
  }
};

startServer();