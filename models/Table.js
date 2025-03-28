// models/Table.js
import sql from "mssql";

// Clase para manejar las operaciones relacionadas con las mesas
class Table {
  constructor(pool) {
    this.pool = pool; // El pool de conexión para el edificio (vow o Torre_x)
  }

  // Obtener todas las mesas
  async getAllTables() {
    try {
      const connection = await this.pool.connect();
      const result = await connection.request().query("SELECT * FROM tables");
      return result.recordset;
    } catch (error) {
      throw new Error(`Error al obtener las mesas: ${error.message}`);
    }
  }

  // Crear una nueva mesa (opcional, si necesitas esta funcionalidad)
  async createTable(tableData) {
    try {
      const connection = await this.pool.connect();
      const result = await connection
        .request()
        .input("tableNumber", sql.Int, tableData.tableNumber)
        .input("capacity", sql.Int, tableData.capacity)
        .query(
          "INSERT INTO tables (tableNumber, capacity) VALUES (@tableNumber, @capacity); SELECT SCOPE_IDENTITY() as id"
        );
      return { id: result.recordset[0].id, ...tableData };
    } catch (error) {
      throw new Error(`Error al crear la mesa: ${error.message}`);
    }
  }
}

export default Table;