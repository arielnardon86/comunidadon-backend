// models/Reservation.js
import sql from "mssql";

class Reservation {
  constructor(pool) {
    this.pool = pool;
  }

  // Obtener todas las reservas
  async getAllReservations() {
    try {
      const connection = await this.pool.connect();
      const result = await connection
        .request()
        .query("SELECT id, table_id, turno, date, username FROM reservations");
      return result.recordset.map((res) => ({
        id: res.id,
        tableId: res.table_id,
        turno: res.turno,
        date: res.date.toISOString().split("T")[0],
        username: res.username,
      }));
    } catch (error) {
      throw new Error(`Error al obtener las reservas: ${error.message}`);
    }
  }

  // Crear una nueva reserva
  async createReservation({ tableId, turno, date, username }) {
    try {
      const connection = await this.pool.connect();
      const existing = await connection
        .request()
        .input("tableId", sql.Int, tableId)
        .input("turno", sql.NVarChar, turno)
        .input("date", sql.Date, date)
        .query(
          "SELECT * FROM reservations WHERE table_id = @tableId AND turno = @turno AND date = @date"
        );

      if (existing.recordset.length > 0) {
        throw new Error("Mesa ya reservada en ese turno");
      }

      const result = await connection
        .request()
        .input("tableId", sql.Int, tableId)
        .input("turno", sql.NVarChar, turno)
        .input("date", sql.Date, date)
        .input("username", sql.NVarChar, username)
        .query(
          "INSERT INTO reservations (table_id, turno, date, username) VALUES (@tableId, @turno, @date, @username); SELECT SCOPE_IDENTITY() as id"
        );

      return {
        id: result.recordset[0].id,
        tableId,
        turno,
        date: new Date(date).toISOString().split("T")[0],
        username,
      };
    } catch (error) {
      throw new Error(`Error al realizar la reserva: ${error.message}`);
    }
  }

  // Eliminar una reserva
  async deleteReservation(reservationId) {
    try {
      const connection = await this.pool.connect();
      const result = await connection
        .request()
        .input("id", sql.Int, reservationId)
        .query("DELETE FROM reservations WHERE id = @id");

      if (result.rowsAffected[0] === 0) {
        throw new Error("Reserva no encontrada");
      }
      return { message: "Reserva cancelada con éxito" };
    } catch (error) {
      throw new Error(`Error al cancelar la reserva: ${error.message}`);
    }
  }
}

export default Reservation;