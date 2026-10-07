/**
 * Lee una imagen elegida por el usuario (PNG, JPG…) y la devuelve como data
 * URL achicada a `maxSide` px de lado, para guardarla dentro de la biblioteca
 * sin que pese de más (cada edición de la biblioteca guarda una copia en el
 * historial de deshacer).
 */
export async function readImageAsDataUrl(file: File, maxSide = 800): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Can't process the image");
  // Fondo blanco: un PNG con transparencia no queda negro al pasar a WebP con pérdida.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/webp", 0.9);
}
