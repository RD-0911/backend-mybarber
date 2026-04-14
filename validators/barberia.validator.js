const validarTexto    = (t) => /^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+$/.test(t);
const validarTelefono = (t) => /^\d{10}$/.test(t);
const validarEmail    = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const validarPassword = (p) =>
  p && p.length >= 8 && /[a-zA-Z]/.test(p) && /\d/.test(p);

const validarBarberia = (datos) => {
  const errores = [];

  if (!datos.nombre || datos.nombre.trim() === "")
    errores.push("El nombre de la barbería es obligatorio");
  else if (datos.nombre.trim().length < 3)
    errores.push("El nombre debe tener al menos 3 caracteres");
  else if (datos.nombre.trim().length > 100)
    errores.push("El nombre no puede superar 100 caracteres");

  if (!datos.direccion || datos.direccion.trim() === "")
    errores.push("La dirección es obligatoria");
  else if (datos.direccion.trim().length < 5)
    errores.push("La dirección debe tener al menos 5 caracteres");
  else if (datos.direccion.trim().length > 150)
    errores.push("La dirección no puede superar 150 caracteres");

  if (!datos.nombre_encargado || datos.nombre_encargado.trim() === "")
    errores.push("El nombre del encargado es obligatorio");
  else if (!validarTexto(datos.nombre_encargado))
    errores.push("El nombre del encargado solo debe contener letras");
  else if (datos.nombre_encargado.trim().length > 100)
    errores.push("El nombre del encargado no puede superar 100 caracteres");

  if (!datos.telefono || datos.telefono.trim() === "")
    errores.push("El teléfono es obligatorio");
  else if (!validarTelefono(datos.telefono.trim()))
    errores.push("El teléfono debe contener exactamente 10 dígitos numéricos");

  if (!datos.correo || datos.correo.trim() === "")
    errores.push("El correo electrónico es obligatorio");
  else if (!validarEmail(datos.correo.trim()))
    errores.push("El correo electrónico no tiene un formato válido");
  else if (datos.correo.trim().length > 100)
    errores.push("El correo no puede superar 100 caracteres");

  if (!datos.password || datos.password === "")
    errores.push("La contraseña es obligatoria");
  else if (!validarPassword(datos.password))
    errores.push("La contraseña debe tener mínimo 8 caracteres, incluir letras y números");

  return errores;
};

module.exports = { validarBarberia, validarEmail, validarPassword };
