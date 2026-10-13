# KINETIC · Reconocimiento de ejercicio (PWA)

PWA en React que usa la cámara y **MediaPipe Pose (33 puntos)** para reconocer el ejercicio,
medir ángulos articulares, contar **repeticiones y series**, estimar velocidad, fatiga, técnica,
inclinación del torso y mostrar un **mapa de calor muscular** sobre el cuerpo.

- Sin login: el cliente escribe su **número de 4 dígitos** y todo se registra en ese código.
- El cliente elige ejercicios / arma su rutina, o el **coach** la asigna desde el panel.
- **Panel oculto del coach**: toca 5 veces el logo (o abre `#admin`) → PIN.
  Analítica semanal, grupos musculares, historial y edición de rutinas.
- Todos los datos (ejercicios, grupos musculares, textos) vienen de **Supabase**; nada fijo en el `index.html`.

## Infraestructura
- `supabase/schema.sql` — tablas `ej_*`, RLS, funciones RPC (el PIN se guarda hasheado con bcrypt).
- Despliegue automático a **GitHub Pages** con GitHub Actions (`.github/workflows/deploy.yml`).
- Credenciales vía *secrets* del repositorio: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

## Añadir ejercicios
Inserta una fila en `ej_exercises` indicando los landmarks A-B-C (índices MediaPipe) de cada lado,
el ángulo de reposo (`rest_angle`) y el de máxima contracción (`peak_angle`). La app lo detecta sin cambiar código.
