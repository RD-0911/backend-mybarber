const validarTexto    = (t) => /^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+$/.test(t.trim());
const validarTelefono = (t) => /^\d{10}$/.test(t.trim());

// ── Sanitizar: elimina etiquetas HTML y caracteres peligrosos ─────
function sanitizar(valor) {
  if (!valor || typeof valor !== "string") return valor;
  return valor
    .replace(/</g, "")      // quita <
    .replace(/>/g, "")      // quita >
    .replace(/&/g, "")      // quita &
    .replace(/"/g, "")      // quita "
    .replace(/'/g, "")      // quita '
    .replace(/\//g, "")     // quita /
    .replace(/\\/g, "")     // quita \
    .replace(/`/g, "")      // quita backtick
    .trim();
}

// ── Sanitizar solo el campo Facebook (permite @, puntos, guiones) ─
function sanitizarFacebook(valor) {
  if (!valor || typeof valor !== "string") return valor;
  // Solo permite letras, números, puntos, guiones, guion bajo y @
  return valor.replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ@._\-\s]/g, "").trim();
}

const validarDatosCitaPublica = (datos) => {
  const errores = [];

  // Nombre
  if (!datos.nombre || datos.nombre.trim() === "")
    errores.push("El nombre es obligatorio");
  else if (datos.nombre.trim().length < 2)
    errores.push("El nombre debe tener al menos 2 letras");
  else if (!validarTexto(datos.nombre))
    errores.push("El nombre solo debe contener letras, sin números ni símbolos");

  // Apellido
  if (!datos.primerAp || datos.primerAp.trim() === "")
    errores.push("El apellido es obligatorio");
  else if (datos.primerAp.trim().length < 2)
    errores.push("El apellido debe tener al menos 2 letras");
  else if (!validarTexto(datos.primerAp))
    errores.push("El apellido solo debe contener letras, sin números ni símbolos");

  // Teléfono
  if (!datos.telefono || datos.telefono.trim() === "")
    errores.push("El teléfono es obligatorio");
  else if (!validarTelefono(datos.telefono))
    errores.push("El teléfono debe contener exactamente 10 dígitos numéricos");

  // Facebook
  if (!datos.usuarioFacebook || datos.usuarioFacebook.trim() === "")
    errores.push("El usuario de Facebook es obligatorio");
  else if (datos.usuarioFacebook.trim().length < 3)
    errores.push("El usuario de Facebook debe tener al menos 3 caracteres");
  else if (/<|>|script|javascript|onerror|onload/i.test(datos.usuarioFacebook))
    errores.push("El usuario de Facebook contiene caracteres no permitidos");

  return errores;
};

module.exports = { validarDatosCitaPublica, sanitizar, sanitizarFacebook };