# KINETIC · Reconocimiento de ejercicio (PWA)

PWA en React que usa la cámara y **MediaPipe Pose (33 puntos)** para reconocer el ejercicio,
medir ángulos articulares, contar **repeticiones y series**, estimar velocidad, fatiga, técnica,
inclinación del torso y mostrar un **mapa de calor muscular** sobre el cuerpo.

- Sin login ni reconocimiento facial: el cliente escribe su **número de 4 dígitos** y todo se registra en ese código.
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

## Evaluación física y progreso
- **Formulario** (cliente desde su pantalla, o coach desde el panel): estatura, peso, edad / fecha de nacimiento, sexo,
  % de grasa, masa muscular, grasa visceral, agua, perímetros (cuello, pecho, cintura, cadera, brazo, muslo, pantorrilla),
  pulso y presión, objetivo, peso meta, nivel de actividad, experiencia y lesiones.
- **Cálculos automáticos** (en el servidor): IMC y su clasificación, relación cintura/cadera y cintura/estatura,
  metabolismo basal (Mifflin-St Jeor), gasto diario, % de grasa estimado (método Marina de EE. UU.), masa grasa y magra.
- **Progreso**: % de cambio entre evaluaciones, % por día, % acumulado y % de avance hacia el peso meta;
  entrenamiento por día con variación porcentual. El coach lo filtra por **rango de fechas**.

## Entrenar ejercicios (demostración del coach)
En el panel: **🎓 Ejercicios**. El coach graba una demostración (3 a 8 repeticiones) y el sistema aprende, sin enviar imágenes:
- la **articulación** que define el movimiento (rodilla, codo, cadera u hombro) y los ángulos de **reposo / contracción**,
- la **curva modelo** de una repetición y el **ritmo** (subida / bajada),
- un **esqueleto animado** («Así se hace») que ve el cliente antes y durante la serie.
Puede crear un ejercicio nuevo o grabar la demostración de uno existente. Durante la serie, cada repetición del cliente
se compara con la curva modelo (similitud 0-100) y esa similitud cuenta en la puntuación de técnica.
No se guarda video: solo los puntos del cuerpo (`ej_exercises.ghost`, `template`, `tempo`).

## Pantallas, TV y cámara
- **Adaptable**: teléfonos, tabletas, PC y televisores. En pantallas de 1700 px o más (y 2400 / 3200 px) la interfaz se agranda sola;
  «Modo TV» (📺) la agranda siempre. Foco visible para control remoto / teclado.
- **Pantalla completa** (⛶) y, en PC con otra pantalla conectada por HDMI, envío de la app a esa pantalla (Window Management API).
  La pantalla se mantiene encendida durante el ejercicio (Wake Lock).
- **Transmitir al TV**: guía en 📺 (Chromecast, Windows+K, AirPlay, Smart View). El navegador no puede iniciar la transmisión por sí mismo.
- **Cámara frontal / trasera**: botón 🤳/📷 en el ejercicio, lista de todas las cámaras en «⋯», y preferencia recordada
  (también en la tarjeta del cliente). Si el equipo solo tiene una cámara, el botón invierte la vista espejo.

## Infraestructura
- `supabase/schema.sql` + `supabase/migration_002.sql` — tablas `ej_*`, RLS, funciones RPC (el PIN se guarda hasheado con bcrypt).
- Despliegue automático a **GitHub Pages** con GitHub Actions (`.github/workflows/deploy.yml`).
- Credenciales vía *secrets* del repositorio: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

## Añadir ejercicios
Inserta una fila en `ej_exercises` indicando los landmarks A-B-C (índices MediaPipe) de cada lado,
el ángulo de reposo (`rest_angle`) y el de máxima contracción (`peak_angle`). La app lo detecta sin cambiar código.
