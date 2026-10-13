# KINETIC · Reconocimiento de ejercicio (PWA)

PWA en React que usa la cámara y **MediaPipe Pose (33 puntos)** para reconocer el ejercicio,
medir ángulos articulares, contar **repeticiones y series**, estimar velocidad, fatiga, técnica,
inclinación del torso y mostrar un **mapa de calor muscular** sobre el cuerpo.

- Sin login: el cliente escribe su **número de 4 dígitos** y todo se registra en ese código.
- El cliente elige ejercicios / arma su rutina, o el **coach** la asigna desde el panel.
- **Panel oculto del coach**: toca 5 veces el logo (o abre `#admin`) → PIN.
  Analítica semanal, grupos musculares, historial y edición de rutinas.
- Todos los datos (ejercicios, grupos musculares, textos) vienen de **Supabase**; nada fijo en el `index.html`.

## Novedades v2
- **Captura más rápida**: `requestVideoFrameCallback` (cada fotograma de la cámara se procesa al llegar), cámara a 60 fps,
  sin máscara de segmentación (era el cuello de botella), filtro **One-Euro** (suaviza sin retraso) y modo ⚡ rápido / 🎯 preciso.
- **Lastre / carga** en dominadas, fondos, flexiones, sentadilla, zancada, peso muerto, curl, press…: carga efectiva
  (peso corporal × factor + lastre), volumen, **1RM estimado (Epley)** y potencia estimada, todo en la analítica semanal.
- **Boxeo**: sombra libre, combos guiados (numeración 1-6), dianas de precisión, velocidad 30 s y 1-2.
  Clasifica jab, directo, ganchos y uppercuts con landmarks 3D; mide velocidad del puño, aciertos, golpes limpios,
  % de guardia y ritmo.
- **Reconocimiento facial**: descriptores de 128 dimensiones (face-api / ResNet-34), prueba de vida (giro o parpadeo),
  3 muestras que deben coincidir y comparación en el servidor con **pgvector** (los rostros nunca se descargan al navegador;
  solo se guardan vectores, no fotos).

## Infraestructura
- `supabase/schema.sql` + `supabase/migration_002.sql` — tablas `ej_*`, RLS, funciones RPC (el PIN se guarda hasheado con bcrypt).
- Despliegue automático a **GitHub Pages** con GitHub Actions (`.github/workflows/deploy.yml`).
- Credenciales vía *secrets* del repositorio: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

## Añadir ejercicios
Inserta una fila en `ej_exercises` indicando los landmarks A-B-C (índices MediaPipe) de cada lado,
el ángulo de reposo (`rest_angle`) y el de máxima contracción (`peak_angle`). La app lo detecta sin cambiar código.
