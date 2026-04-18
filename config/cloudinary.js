const cloudinary = require("cloudinary").v2;
const streamifier = require("streamifier");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Sube un buffer a Cloudinary.
 * @param {Buffer} buffer
 * @param {string} publicId  - ID público sin carpeta (ej: "barberia_3")
 * @param {string} [folder]  - Carpeta dentro de mybarber (ej: "productos")
 */
function subirACloudinary(buffer, publicId, folder = "") {
  const folderPath = folder ? `mybarber/${folder}` : "mybarber";
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { public_id: publicId, folder: folderPath, overwrite: true, resource_type: "image" },
      (error, result) => (error ? reject(error) : resolve(result))
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });
}

/**
 * Elimina una imagen de Cloudinary por su URL segura.
 * @param {string} secureUrl
 * @param {string} [folder]
 */
async function eliminarDeCloudinary(secureUrl, folder = "") {
  try {
    const parts     = secureUrl.split("/");
    const filename  = parts[parts.length - 1].split(".")[0];
    const folderPath = folder ? `mybarber/${folder}` : "mybarber";
    await cloudinary.uploader.destroy(`${folderPath}/${filename}`);
  } catch (_) {}
}

module.exports = { cloudinary, subirACloudinary, eliminarDeCloudinary };