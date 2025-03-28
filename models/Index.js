// models/Index.js
import Table from "./Table.js";
import Reservation from "./Reservation.js"; 

// Función para inicializar los modelos con los pools de conexión
const initializeModels = (pools) => {
  const models = {};

  // Inicializar modelos para cada edificio (vow, Torre_x)
  for (const [building, pool] of Object.entries(pools)) {
    models[building] = {
      Table: new Table(pool),
      Reservation: new Reservation(pool), // Lo crearemos después
    };
  }

  return models;
};

export default initializeModels;