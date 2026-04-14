const validarTexto    = (t) => /^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+$/.test(t);
const validarTelefono = (t) => /^\d{10}$/.test(t);

const validarDatosCliente = (datos) => {
  const errores = [];

  if (!datos.nombre || datos.nombre.trim() === "")
    errores.push("El nombre es obligatorio");
  else if (!validarTexto(datos.nombre))
    errores.push("El nombre solo debe contener letras");

  if (!datos.primerAp || datos.primerAp.trim() === "")
    errores.push("El primer apellido es obligatorio");
  else if (!validarTexto(datos.primerAp))
    errores.push("El primer apellido solo debe contener letras");

  if (datos.segundoAp && datos.segundoAp.trim() !== "" && !validarTexto(datos.segundoAp))
    errores.push("El segundo apellido solo debe contener letras");

  if (!datos.telefono || datos.telefono.trim() === "")
    errores.push("El teléfono es obligatorio");
  else if (!validarTelefono(datos.telefono))
    errores.push("El teléfono debe contener exactamente 10 dígitos numéricos");

  return errores;
};

module.exports = { validarDatosCliente };
