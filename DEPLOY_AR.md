# AR-COMBAT · Puesta en marcha

Esta copia está pensada para conectarse a **otra base de datos** (no toca la de KINETIC).
La página principal funciona sin base de datos con el contenido por defecto; todo lo demás
(suscripciones, panel, clientes, correos) se activa al conectarla.

## 1. Base de datos (Supabase nuevo)

Aplica en el SQL Editor, en este orden (todas son idempotentes):

1. `supabase/schema.sql`
2. `supabase/migration_002.sql` … `migration_012.sql` (sin saltarse ninguna; 003–005 y 006 incluyen el alta y retiro del reconocimiento facial, que es normal)
3. `supabase/migration_013_ar_combat.sql` (boxeo, clientes con estado, pagos, sitio web, correos)

> `schema.sql` crea el PIN inicial del administrador **1234**. Cámbialo antes de publicar:
> `update ej_admin_secret set pin_hash = crypt('TU_PIN_LARGO', gen_salt('bf')) where id = 1;`

Para la IA con Gemini: `migration_010/011/012` y la clave en `ej_ai_config` (ver README).

## 2. Variables de la web (GitHub → Settings → Secrets and variables → Actions)

| Secreto | Valor |
|---|---|
| `VITE_SUPABASE_URL` | URL del proyecto, `https://xxxx.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | clave pública *anon* |

Luego vuelve a ejecutar el flujo «Deploy PWA a GitHub Pages».

## 3. Correos (Gmail + Edge Function `ar-mailer`)

Los correos de bienvenida y de pago aprobado salen por Gmail con una **contraseña de aplicación**.
**La contraseña nunca va en el código ni en el repositorio**: se guarda como secreto de la función.

1. En Supabase → Edge Functions → Secrets (o `supabase secrets set …`):
   - `GMAIL_USER` = la cuenta de Gmail que envía
   - `GMAIL_APP_PASSWORD` = la contraseña de aplicación de 16 caracteres
   - `MAILER_SECRET` = un texto largo aleatorio (inventa uno)
2. Despliega la función sin verificación JWT:
   `supabase functions deploy ar-mailer --no-verify-jwt`
3. Dile a la base dónde está la función (SQL Editor):

```sql
insert into ej_mail_config(id, function_url, secret, app_url)
values (1, 'https://TU-PROYECTO.supabase.co/functions/v1/ar-mailer', 'EL_MISMO_MAILER_SECRET',
        'https://cashlessmot2026.github.io/reconocimiento-ejercicio-v2/')
on conflict (id) do update set function_url = excluded.function_url, secret = excluded.secret, app_url = excluded.app_url;
```

4. Panel del administrador → **🌐 Sitio web → ▦ Pago → Enviar prueba** para comprobarlo.

## 4. Flujo de una suscripción

1. El visitante elige un plan → ve el **QR de pago** (lo sube el admin en *Sitio web → Pago*) y adjunta el comprobante.
2. Se crea el cliente en estado **pendiente** con un código automático y le llega el correo de bienvenida con su código.
   Con estado pendiente **no puede entrar ni registrar entrenamientos**.
3. El admin abre **👥 Miembros y pagos → 💳 Pagos**, revisa el comprobante y pulsa **Aprobar**.
4. El cliente pasa a **activo** y recibe el correo de aprobación con el botón que lo lleva a escribir su código.
5. Si rechaza el pago, el cliente recibe un aviso y puede volver a intentarlo.

El administrador también puede **crear clientes** directamente (código automático o elegido) desde *Miembros y pagos → Crear cliente*.

## 5. Contenido editable

Todo el texto, las imágenes, los planes y precios, el QR y los datos de contacto se editan en el panel
(**🌐 Sitio web**) y se ven al instante en la página principal.
