# STF · Superliga de Touch Football — versión web

Sitio público (cualquiera puede ver tablas, resultados, fixtures, equipos, squadsheets, estadísticas, palmarés,
reglamento y noticias) con un **panel de administración protegido** para la organización.

- Sin dependencias externas: solo **Node.js 22.13 o superior** (usa SQLite integrado).
- Datos en `DATA_DIR` (por defecto `./data`): `stf.db` y `uploads/` (escudos subidos).

## Probarlo en tu computador
```
node server.js
```
Abre http://localhost:3000 . Para ejecutar las pruebas automáticas: `STF_TEST_PASS=<contraseña> node tools/smoke-test.js`.

## Publicarlo para que todos lo vean
Necesitas un hosting que ejecute Node o Docker **y un disco persistente** (sin disco, los datos y los escudos subidos
se borran en cada reinicio). Opciones:

1. **Render** (más simple): sube esta carpeta a un repositorio de GitHub → *New → Blueprint* → elige el repo (usa `render.yaml`).
   Al crear el servicio te pedirá `ADMIN_PASSWORD`. El plan con disco es de pago.
2. **Fly.io / Railway / un VPS**: usa el `Dockerfile` y monta un volumen en `/data`.
   Variables: `ADMIN_USER`, `ADMIN_PASSWORD`, `DATA_DIR=/data`, `PORT` (lo suele poner la plataforma).
3. **VPS propio**: `node server.js` detrás de Nginx/Caddy con HTTPS (Caddy lo hace automático).

**Usa siempre HTTPS** (todas las plataformas anteriores lo dan gratis). El servidor marca la cookie como `Secure` y envía HSTS cuando detecta HTTPS.

## Administración
- Entra desde el menú **ADMINISTRACIÓN**. Usuario por defecto: `stf_director`.
- Si defines `ADMIN_PASSWORD` (mínimo 12 caracteres) y opcionalmente `ADMIN_USER` como variables de entorno, esa cuenta se (re)crea
  en cada arranque y prevalece sobre la contraseña inicial. **Recomendado**: usa una contraseña propia de 16+ caracteres.
- Desde el panel también puedes cambiar la contraseña (Ajustes y seguridad).
- Secciones: partidos y resultados, fixtures (generador automático y fechas por jornada), squadsheets, competiciones y copas
  (Libertadores y Sudamericana), equipos (con **subida de escudo desde tu computador**), jugadores y estadísticas, noticias,
  palmarés, reglamento, temporadas y ajustes de puntos.

## Seguridad incluida
- Contraseñas con scrypt (N=32768) y sal aleatoria; comparación en tiempo constante.
- Bloqueo progresivo tras 5 intentos fallidos por IP (hasta 1 hora) y retraso en cada fallo.
- Sesión en cookie `HttpOnly` + `SameSite=Strict` (+ `Secure` bajo HTTPS), caduca a las 8 h de inactividad; al cambiar la contraseña se cierran las demás sesiones.
- Protección CSRF (cabecera propia + verificación de `Origin`), CSP estricta (sin scripts de terceros), `X-Frame-Options`, `nosniff`, HSTS.
- Todo el contenido se escapa al mostrarse (anti-XSS); los enlaces de imagen solo admiten http(s) o archivos subidos.
- Subidas: solo PNG/JPG/GIF/WEBP verificados por su contenido, máx. 2 MB, nombre aleatorio (no se aceptan SVG).
- Solo el administrador puede escribir; el público solo puede leer.

## Copias de seguridad
Respalda periódicamente la carpeta de datos (`stf.db` y `uploads/`).
