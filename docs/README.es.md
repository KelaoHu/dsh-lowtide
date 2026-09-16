<div align="center">

# dsh-lowtide

**Encola tareas en hora punta. Se ejecutan solas en hora valle.**

<sub>Modo semiautomático o automático, esquivando las horas punta y los precios punta de los modelos. Un plugin imprescindible para DeepSeek Harness.</sub>

**Español** | [English](../README.md) | [简体中文](../README.zh-CN.md) | [繁體中文](../README.zh-HK.md) | [العربية](./README.ar.md) | [Deutsch](./README.de.md) | [Français](./README.fr.md) | [Italiano](./README.it.md) | [한국어](./README.ko.md)

<img src="../assets/overview.png" alt="lowtide overview" width="100%">

</div>

> **Nota sobre el idioma de la interfaz:** en la versión actual, la interfaz (UI) del plugin lowtide solo está disponible en **chino simplificado** e **inglés**; no existe soporte de interfaz en otros idiomas. Este README es una traducción al español del documento original en inglés, preparada únicamente para facilitar la lectura. El plugin en sí funciona igual independientemente del idioma de este documento.

---

![hero](../assets/screenshots/hero.png)

<p align="center"><i>Tres tareas esperando en la cola, el indicador de precio brillando en la cabecera de la sesión, ejecución automática cuando se abre tu ventana</i></p>

## Introducción

lowtide es un plugin para [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/dsh). El problema que resuelve es sencillo y completamente natural:

Normalmente, cuando quieres que un agente haga algo, te sientas frente al ordenador, envías una instrucción al agente, esperas la respuesta y la revisas a mano. Pero este flujo de trabajo parece olvidar que tienes mucho tiempo ocioso — y una oportunidad de esquivar los precios punta/valle que cobran algunos modelos.

Con lowtide instalado, el día transcurre así: cada vez que durante el día se te ocurre un trabajo, lo lanzas a la cola, le echas un vistazo y lo liberas. Las tareas se acumulan hasta la hora que tú fijas (por ejemplo, después de las 19:00 — cuando DeepSeek aplica el precio valle), y entonces se ejecutan solas. A la mañana siguiente abres el informe: conserva lo que salió bien, devuelve lo que no.

Eso es todo. Pero úsalo durante una semana y tu ritmo de trabajo se ralentiza de verdad — y no olvides que "el tiempo es oro, la eficiencia es vida"……

Algunas capacidades destacadas:

- Cuatro estrategias de ejecución: única, iterativa, muestreo, revisión — desde "una pasada basta" hasta "ejecuta cinco candidatos y yo elijo"
- 168 pruebas unitarias + 10 especificaciones e2e, CI en verde en ubuntu / windows × node 22 / 24
- Un único artefacto de compilación sirve tanto para escritorio como para web — instala una vez, funciona en ambos
- La ejecución fuera de horas punta aterriza en los valles de DeepSeek: el mismo lote cuesta aproximadamente la mitad que en horas punta

## Un día normal con un agente podría ser así…

**Diez minutos antes de salir del trabajo.** Has terminado de revisar código, así que presentas tres tickets para mañana: una refactorización (iterativa, 3 rondas), un informe semanal (única) y un diseño sobre el que tienes dudas (muestreo, 4 candidatos). Libera todos, apaga el ordenador y vete. Mañana, en tu escritorio, el informe matutino dice: la refactorización está hecha, el informe está redactado y cuatro diseños candidatos están uno al lado del otro, cada uno con su coste escrito.

**Viernes por la noche.** Pon en cola las tareas de toda la semana de una vez: limpieza de dependencias, tests que faltan, scripts de datos. Los fines de semana el precio valle está activo las 24 horas. Tú sales; el plugin trabaja desde casa. El lunes revisas el informe — reintenta lo que falló, fusiona lo que está bien.

**Una idea a las 10 de la mañana.** Estás a mitad de una conversación con el agente sobre un bug urgente cuando piensas "oye, actualiza también la documentación". Aparece la tarjeta de interceptación: ejecutarlo ahora cuesta el precio punta, esta noche aproximadamente la mitad — la diferencia está explicada. Haz clic en "poner en cola para fuera de horas punta"; tu borrador sobrevive intacto y vuelves al bug.

**Un servidor siempre encendido.** Tienes una máquina ejecutando dsh 24/7. Cambia al modo L3 totalmente automático y presenta tareas desde cualquier lugar a través de la API (`POST /ds-lowtide/tasks`). Las ejecuta según el horario y escribe el informe. Nadie está vigilando, pero la sandbox, el presupuesto diario y los bloqueos de archivos siguen ahí.

**Algo que va a un cliente.** Usa la estrategia de revisión: ejecuta una vez y, a continuación, abre automáticamente una sesión independiente que desmenuza el resultado según tu foco elegido (por ejemplo, "busca errores en las fuentes de datos"). Por la mañana no obtienes un resultado desnudo — obtienes un resultado más una revisión crítica.

**Viviendo en el extranjero.** Estás en San Francisco; las horas punta de DeepSeek son en hora de Pekín, que para ti son la tarde y la noche del día anterior. La configuración convierte el horario oficial a tu reloj local, con un clic para adoptarlo. Defines las ventanas según tu propio horario y los libros siempre se mantienen alineados con la tabla oficial.

## Cómo funciona lowtide

```
① Entrada             ② Adjudicación         ③ Ejecución             ④ Aceptación
Siempre que tengas    El dock de la cola     Cuando se abre la        Cuando vuelves:
un momento: un clic   agrupa las tareas por  ventana de valle:        abre el informe —
desde la tarjeta de   espacio de trabajo;    pasan cinco compuertas   resultados + diff
interceptación, o     haz el triaje línea    de preflight, luego →    + gasto real
presenta un ticket →  por línea:         →   ejecuciones en sandbox   + dinero ahorrado
(4 estrategias)       ✓aprobar ⏸posponer     un lote por ventana
                      ✕descartar / aprobar-todo
```

La vida de una tarea: `pending-review → queued → preflight → running → done / failed / stale / timeout`, más `deferred` (pospuesta) y `dropped` (eliminación suave, restaurable).

El paso dos es donde lowtide se diferencia de un "script totalmente automatizado": **cada tarea debe ser liberada por tu mano antes de ejecutarse** (en L2, liberas todo el lote de una vez, 30 minutos antes de la ventana). La máquina no puede colarse sola en la cola de ejecución. La ejecución está automatizada; las decisiones no. Por eso puedes permitirte estar ausente con seguridad.

## Un recorrido por la interfaz de lowtide

**El modal de nueva tarea.** Cuatro estrategias una al lado de la otra, cada una con una pista en lenguaje llano; rondas, prioridad y modo de ejecución viajan con cada tarea — sin volver a la configuración. Las tareas aterrizan como "pending review". Nada entra en la cola sin pasar por ti.

![new-task-modal](../assets/screenshots/new-task-modal.png)

**Opciones avanzadas.** Modelo, esfuerzo de razonamiento, prioridad de 0 a 9, sesión nueva o continuar la anterior, y la lista de archivos bloqueados — todo en un pequeño panel. Archivos bloqueados, en resumen: cualquier cosa de la lista recibe una comprobación sha256 antes de la ejecución y, si no coincide con lo que presentaste, la tarea queda obsoleta (`stale`) y se niega a ejecutarse. De lo contrario, el archivo contra el que pusiste la tarea en cola podría ser reescrito por otra tarea mientras espera, y esta lo pisotearía a ciegas.

![advanced-options](../assets/screenshots/advanced-options.png)

**Elige cualquier modelo.** La ejecución por lotes usa por defecto el oficial `deepseek-flash`, pero cada tarea puede elegir su propio modelo — cualquier cosa conectada a tu Harness aparece en el desplegable, agrupada por proveedor. Los proveedores privados también funcionan. Los modelos no oficiales no tienen tabla de precios pública, así que el libro de cuentas dice honestamente "precio desconocido"; añade una anulación de precio en la configuración si quieres que la contabilidad sea exacta.

![model-picker](../assets/screenshots/model-picker.png)

**El editor de ventanas.** De varios segmentos, nocturnas, por día de la semana — todo funciona. Debajo hay una banda de precios de 24 horas en vivo: rojo para punta, verde para valle, y un marcador que muestra dónde estás ahora mismo. Fuera de UTC+8, un clic en "adoptar horas punta oficiales" convierte la hora de Pekín a tu reloj local.

![window-editor](../assets/screenshots/window-editor.png)

**La página de configuración.** Horas de ventana, tareas por lote, límite de duración por tarea, concurrencia, presupuesto diario, historial de informes, nivel de autonomía, anulaciones de precio — todo gráfico, sin archivos de configuración. Las reglas de precios oficiales (incluido el nuevo valle de todo el fin de semana) se explican en lenguaje humano en la misma página.

![settings](../assets/screenshots/settings.png)

Tres superficies más se esconden en el flujo diario: la **píldora de precio** (cabecera de sesión — ocupado/inactivo, tamaño de la cola; haz clic para editar ventanas), la **tarjeta de interceptación en horas punta** (escribe en hora punta y aparece; la diferencia de precio está explicada; tu borrador sobrevive) y el **informe de ejecución** (el resumen matutino: ahorros primero, anomalías fijadas, candidatos esperando tu elección, copia en Markdown con un clic).

## Sobre los espacios de trabajo de lowtide

Cada tarea se ejecuta dentro de un espacio de trabajo. Ese único desplegable decide tres cosas.

**Qué archivos puede tocar.** Las tareas se ejecutan en una sandbox cuyo límite es el directorio del espacio de trabajo. Elige mal y en el mejor caso no encuentra los archivos; en el peor, edita algo que no debería.

**Con quién se encola.** Las tareas del mismo espacio de trabajo se ejecutan en serie (dos tareas nunca se pelean por un repositorio); los espacios de trabajo distintos se ejecutan en paralelo (límite por defecto 3, ajustable). ¿Quieres rendimiento? Reparte el trabajo no relacionado entre espacios de trabajo. ¿Quieres orden? Mantenlo en uno.

**Cómo se agrupan los informes.** Tanto el dock como el informe matutino se organizan por espacio de trabajo — una vez que tienes volumen real, esta agrupación compensa.

El desplegable de Espacio de trabajo en el modal de tickets tiene tres fuentes: **Usar el espacio de trabajo actual** (aquel en el que vive tu sesión — el caso habitual), **un espacio de trabajo existente de la lista** (cada uno con su ruta absoluta, para que siempre sepas de qué proyecto se trata), o **Ruta personalizada…** (escríbela a mano). Si elegiste "Continuar anterior" como modo de sesión, también elegirás el espacio de trabajo y la conversación exacta — la tarea reanuda con el contexto de esa conversación.

Mi consejo: **un proyecto, un espacio de trabajo — no los mezcles.** La instantánea git y los bloqueos de archivos del preflight están limitados al espacio de trabajo; mezclar proyectos en un mismo espacio de trabajo es una buena manera de confundirte.

## Cuatro estrategias, y cuándo usar cada una

| Estrategia | Qué hace | Cuándo recurrir a ella | Coste |
|---|---|---|---|
| **Única** | Una pasada, terminado | Trabajos simples y bien definidos | 1× |
| **Iterativa** | 2–5 rondas en una sesión, cada una mejorando la anterior a través de tu "lente de iteración"; termina pronto cuando dos rondas se parecen lo suficiente | Trabajo que necesita pulido: redacción, planes, código | ~N× |
| **Muestreo** | 2–5 sesiones aisladas producen cada una un candidato completo, mostrados lado a lado con sus costes — **tú** eliges; la máquina no hace juicios estéticos | Títulos, ideas, diseños: quieres opciones, no una respuesta | ~N× |
| **Revisión** | Tras la ejecución, una sesión independiente desmenuza el resultado según tu "foco de revisión" y escribe sus hallazgos | Entregables importantes, una pasada más antes de enviar | ~2× |

## Tres niveles de autonomía

- **L1 por tarea**: cada tarea necesita tu ✓ individual. Úsalo al principio, o cuando el repositorio sea valioso.
- **L2 por lote** (por defecto): las tareas esperan en revisión; una tarjeta de compuerta aparece 30 minutos antes del lote y lo libera todo de una vez; sin liberación, sin ejecución. El modo del día a día.
- **L3 totalmente automático**: las tareas presentadas se ponen en cola inmediatamente y se ejecutan en la sandbox fuera de horas punta, con cero confirmaciones (el cambio pide confirmación dos veces). Pensado para servidores siempre encendidos.

Las tareas individuales pueden anular el nivel global en el modal de tickets.

## Arquitectura: cómo funciona mientras no estás

Dejar que un agente ejecute trabajos por lotes mientras duermes es mucho pedir. Cuatro capas debajo lo hacen seguro.

**El microkernel Cordis.** dsh se ejecuta sobre el ecosistema de plugins del microkernel Cordis: cada capacidad es un plugin, y los plugins se comunican mediante inyección de servicios en lugar de dependencias directas. La mitad anfitriona de lowtide es un conjunto de servicios Cordis bien comportados — rutas, planificador, máquina de estados — cada uno haciendo su trabajo, registrados en el kernel, arrancando con el harness, desinstalándose limpiamente. En palabras llanas: no es una piel pegada a dsh; es un órgano que crece dentro del kernel.

**Dos caras, un artefacto.** La mitad anfitriona (Node.js) posee la planificación, la ejecución y el libro de cuentas; la mitad de navegador (React) posee cada píxel. Una compilación produce ambas — y como la GUI de dsh Desktop se renderiza con web, escritorio y web no necesitan ramas separadas. Mismos bytes, mismo comportamiento.

**Un núcleo independiente de la plataforma.** `lowtide-core` contiene el modelo de ventanas, las tablas de precios, la fórmula de facturación, el resumen de la cola, el libro de cuentas y las matemáticas de las ventanas de lote — todas funciones puras que no tocan ninguna API de dsh, publicadas como paquete propio con sus propias pruebas. El beneficio práctico: el núcleo ha sido martilleado por 44 pruebas unitarias de funciones puras, y si algún día portas lowtide a otro framework de agentes, este paquete se extrae intacto.

**Defensa en profundidad.** Cinco compuertas de preflight (¿sigue ahí el espacio de trabajo?, ¿se ha movido el HEAD de git?, ¿coinciden los sha256 de los archivos bloqueados?, ¿cabe la ventana?, ¿queda presupuesto?) — si falla cualquiera, la tarea queda obsoleta o se difiere; nunca una ejecución a ciegas. Tres presets de sandbox con aprobación en "never" — desatendido significa que no hay nadie para hacer clic en "permitir", así que lo permitido se decide antes de que empiece la ejecución. El archivo de estado se escribe atómicamente y se revierte a una copia de seguridad si se corrompe. Las rutas HTTP solo aceptan peticiones del mismo origen en esta máquina.

La sincronización de estado usa SSE con respaldo de sondeo de 4 segundos — la cola se mueve, la interfaz se mueve con ella.

## Instalación

**Instalación con un comando (precompilado):** `dsh plugin --profile web add https://github.com/KelaoHu/dsh-lowtide/releases/latest/download/dsh-lowtide.tgz` — o compila desde el código fuente más abajo.

Requisitos previos: Node `^22.19 || >=24`, pnpm `11.7`. Todo está en el registro público de npm — no se necesita registro privado.

Primero instala dsh (elige uno): Desktop desde los canales oficiales de DeepSeek, o `npm install -g @deepseek-ai/dsh` para la CLI. Después configura un modelo funcional en los ajustes de dsh (por ejemplo, una API key oficial de DeepSeek) — lowtide nunca toca tus credenciales.

Después, clona, compila e instala:

```powershell
git clone https://github.com/KelaoHu/dsh-lowtide
cd dsh-lowtide
pnpm install

# Compila primero la capa del núcleo (las pruebas del plugin resuelven su salida)
pnpm --filter lowtide-core bundle
# Después el plugin: mitad anfitriona + mitad de navegador en una pasada
pnpm --filter dsh-lowtide bundle

# Instala en un perfil — un artefacto sirve para escritorio y web
npx @deepseek-ai/dsh@0.1.5-rc.1 plugin --profile desktop add ./packages/dsh-lowtide   # Desktop
npx @deepseek-ai/dsh@0.1.5-rc.1 plugin --profile web add ./packages/dsh-lowtide       # Web

# Inicia la instancia de desarrollo (puerto 3080)
pnpm --filter dsh-lowtide dev
```

Abre dsh después: deberías ver la píldora de precio en la cabecera de la sesión y el dock de la cola junto al área de entrada. Si no, consulta el FAQ más abajo.

## Uso diario

**Tres formas de presentar una tarea.** La tarjeta de interceptación (escribe en hora punta, un clic, tu borrador se convierte en el ticket sin cambios); el modal de tickets ("Nueva" junto al área de entrada — prompt, estrategia, rondas, prioridad); o la API (`POST /ds-lowtide/tasks`, conéctala a tu propia automatización).

**La vida en el dock de la cola.** Agrupada por espacio de trabajo en pendientes / terminadas / descartadas. En línea por tarea: ✓ aprobar, ⏸ posponer, ✕ descartar (eliminación suave, restaurable). "Aprobar todo" libera todo; "limpiar terminadas" lo mantiene ordenado (los libros no se ven afectados); "Ejecutar ahora" se salta la espera y lanza un lote de inmediato — así se depura.

**Semántica del tiempo.** Las horas punta oficiales se determinan en **hora de Pekín** (DeepSeek factura en hora de Pekín, así que los libros se mantienen alineados; los fines de semana son valle todo el día). Tus ventanas personalizadas y la ventana de ejecución se determinan en **tu hora local**, con rangos nocturnos y reglas por día de la semana. El final de la ventana detiene los nuevos lanzamientos; las tareas en ejecución nunca se interrumpen.

**El libro de cuentas.** `ledger[YYYY-MM-DD] = { yuan, savedYuan }` — gasto y ahorro, acumulados a diario. El precio mostrado es el precio facturado: una fórmula, auditable hasta el último dígito.

## Referencia de configuración

`GET /ds-lowtide/config` lee; `PUT` actualiza parcialmente (los campos no listados se rechazan):

| Campo | Tipo | Por defecto | Notas |
|---|---|---|---|
| `autonomy` | `'l1'\|'l2'\|'l3'` | `l2` | Nivel de autonomía; anulación por tarea en el modal de tickets |
| `batch.window` | `"HH:MM-HH:MM"` | `19:00-23:30` | Ventana de ejecución fuera de horas punta (zona horaria local) |
| `batch.windows` | `"HH:MM-HH:MM"`[] | — | Varias ventanas de ejecución (1–6); cada una ejecuta un lote al día. Ausente = la única `batch.window` |
| `batch.tz` | zona IANA | sistema | Zona horaria de la ventana de ejecución (vacío = local) |
| `batch.gateLeadMin` | minutos | `30` | Antelación de la compuerta del lote |
| `batch.maxTasksPerNight` | número | `10` | Límite de tareas por lote |
| `batch.maxDurationMin` | minutos | `240` | Límite de duración por tarea (cancelar + un reintento al agotarse) |
| `batch.maxConcurrency` | número | `3` | Concurrencia máxima 1–8 (serie por espacio de trabajo, paralelo entre ellos) |
| `batch.paused` | booleano | `false` | Pausar el procesamiento automático por lotes |
| `budgetDailyYuan` | ¥ | `0` | Presupuesto diario (0 = ilimitado) |
| `windows[]` | array | `[]` | Ventanas personalizadas; vacío = punta oficial (hora de Pekín) |
| `windows[].level` | `peak\|off\|custom` | — | Punta / valle / personalizada (precio valle × multiplicador) |
| `windows[].start/end` | `"HH:MM"` | — | Reloj local, nocturnas admitidas |
| `windows[].days` | array `1..7` | todos los días | Días de la semana ISO (1 = lun … 7 = dom) |
| `windows[].tz` | zona IANA | sistema | Zona horaria por ventana |
| `windows[].multiplier` | número | `1` | Multiplicador de precio valle para ventanas personalizadas |
| `prices[model].{peak,off}.{input,inputCached,output}` | ¥/1M | oficial | Anulaciones de la tabla de precios |

## API HTTP

Prefijo `/ds-lowtide/`, detrás de la barrera de confianza de mismo origen + loopback:

| Método | Ruta | Propósito |
|---|---|---|
| GET | `/state` | Estado agregado (precios/cuenta atrás/cola/último informe) |
| GET | `/events` | Push incremental SSE (el cliente cae en sondeo de 4s) |
| GET/PUT | `/config` | Leer/escribir configuración |
| POST | `/tasks` | Presentar un ticket |
| POST | `/tasks/:id/approve \| defer \| drop \| cancel \| retry \| restore \| delete \| choose-candidate` | Adjudicación y gestión |
| POST | `/tasks/approve-all` | Aprobar todo |
| POST | `/estimate` | Estimación: punta vs valle |
| POST | `/batch/run-now` | Ejecutar el lote ahora |
| POST | `/dismiss` | Sin interceptación el resto del día |
| GET | `/health` | Latido |

## Presets de permisos

| preset | sandbox | aprobación |
|---|---|---|
| `lt-readonly` | read-only | never |
| `lt-standard` | workspace-write | never |
| `lt-trusted` | danger-full-access | never |

La interfaz de entrada no ofrece elección — todas las tareas se ejecutan bajo `lt-standard`; las otras dos quedan para quienes llaman a la API (`permissionPreset` en `POST /tasks`). Nada se ejecuta sin preflight.

## Datos y estado

- Todo persiste en `$DSH_HOME/lowtide.json` (escrituras atómicas, reversión automática ante corrupción); con `DSH_PROFILE` definido, el estado se aísla por perfil. **Un solo escritor por archivo a la vez** — no ejecutes Desktop y Web a la vez sin aislamiento de perfil.
- Un lote por ventana, seguro con ventanas nocturnas; una cola vacía no produce un informe vacío.
- Recuperación de pospuestas: al abrir la ventana, las tareas diferidas por preflight se vuelven a poner en cola automáticamente (fallan tras ≥3); las pospuestas manualmente vuelven a pending-review.

## Pruebas y CI

```powershell
pnpm --filter lowtide-core test    # 44 pruebas de núcleo de funciones puras
pnpm --filter dsh-lowtide test     # 124 pruebas unitarias del plugin
pnpm --filter dsh-lowtide exec playwright test   # e2e (necesita dsh web en :3080)
```

Diez especificaciones e2e se ejecutan en serie, desde la prueba de humo de carga de doble cara hasta el bucle completo entrada→adjudicación→ejecución→informe contra la API real. El repositorio incluye un flujo de trabajo de GitHub Actions: cada push / PR ejecuta install → build → typecheck → la suite unitaria completa en cuatro entornos.

## Seguridad

- Las rutas solo aceptan loopback + mismo origen; **no expongas el puerto 3080 a internet pública** — usa un túnel SSH o un proxy inverso autenticado.
- La sandbox de Windows es de grado mitigación; Linux/macOS imponen totalmente. Para uso desatendido, apila la lista blanca de archivos y el presupuesto diario.
- Cambiar a L3 totalmente automático pide confirmación dos veces.
- El archivo de estado contiene prompts completos y rutas; trata las copias de seguridad en consecuencia.
- Informa de vulnerabilidades de forma privada vía [SECURITY.md](../SECURITY.md).

## FAQ

**Llegó la ventana y no se ejecutó nada.**
Comprueba en orden: ¿tareas aprobadas? → ¿"pausar lote fuera de horas punta" marcado? → ¿compuerta liberada? → ¿presupuesto agotado? → ¿preflight fallido (la tarea queda `stale`, motivo en la vista de detalle)?

**¿Por qué el muestreo no elige automáticamente al ganador?**
A propósito. La máquina no hace juicios estéticos — los candidatos y los costes están uno al lado del otro, y tú haces clic en "elige este".

**Estoy en el extranjero y las horas punta no coinciden con mi horario.**
La configuración muestra cómo se ven las horas oficiales localmente; define ventanas personalizadas para tu propio ritmo, o haz clic en "adoptar horas punta oficiales (convertidas a mi zona horaria)".

**¿La estimación y el gasto real no coinciden?**
Las estimaciones usan un límite superior aproximado de tokens de entrada; el gasto real usa el uso real (salida y aciertos de caché incluidos). Ambos números están en el informe.

**¿Una tarea quedó obsoleta (`stale`)?**
Falló el preflight: el espacio de trabajo desapareció, la instantánea git se movió, un archivo bloqueado cambió, faltó presupuesto o la ventana no cabía. Lee `lastError` en los detalles, corrige, `retry`.

## Limitaciones conocidas y hoja de ruta

- Candidato a lanzamiento (v0.2.2), instalado desde el código fuente; e2e necesita una instancia viva de dsh web.
- El modelo de lote por defecto es `deepseek-flash`; los modelos no oficiales no tienen tabla de precios pública — el libro los marca como "precio desconocido", rellenable en la configuración.
- El límite por tarea es de 240 minutos; el tiempo agotado cancela y reintenta una vez.
- Candidatos de hoja de ruta: múltiples ventanas y lotes, grafos de dependencia de tareas, división automática de presupuesto, envío de informes (email/Webhook), alertas de cambio de precio.

## Estructura del repositorio

```
dsh-lowtide/
├── README.md                  English
├── README.zh-CN.md            Versión en chino simplificado
├── README.zh-HK.md            Versión en chino tradicional
├── assets/screenshots/        Capturas del README
├── docs/                      README multilingües (ar, de, es, fr, it, ko)
├── LICENSE                    MIT
├── CHANGELOG.md               Historial de versiones
├── CONTRIBUTING.md            Guía de contribución
├── CODE_OF_CONDUCT.md         Código de conducta
├── SECURITY.md                Política de seguridad
├── .github/                   Flujo de trabajo CI + plantillas de issue/PR
├── package.json               Raíz del espacio de trabajo pnpm
└── packages/
    ├── core/                  Núcleo independiente de la plataforma (lowtide-core)
    │   ├── src/               windows / pricing / model / digest / ledger / scheduler
    │   └── test/              Pruebas unitarias de funciones puras
    └── dsh-lowtide/           El plugin (dsh-lowtide)
        ├── src/               Mitad anfitriona: routes / runner / scheduler / intake / store / state-machine
        ├── client/            Mitad de navegador: components / hooks / i18n / store
        ├── test/              Pruebas unitarias + e2e (Playwright)
        ├── cordis.patch.yml   Línea del plugin + presets de permisos lt-*
        └── README.md          README a nivel de paquete
```

## Unas palabras honestas

Que este plugin de Harness sea del pueblo, por el pueblo y para el pueblo. Que la sabiduría de la comunidad de código abierto, y la voluntad de colaborar, nunca desaparezcan de la Tierra.

## Licencia y agradecimientos

Licencia MIT (ver [LICENSE](../LICENSE)).

- Construido sobre [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/dsh) · el ecosistema de plugins Cordis
- [Anuncio de precios de DeepSeek (2026-09-10)](https://api-docs.deepseek.com/quick_start/pricing) · [cobertura de la fecha de vigencia (2026-09-10)](https://api-docs.deepseek.com/updates) · [news](https://api-docs.deepseek.com/news)

---

> **Recordatorio final:** la interfaz del plugin lowtide solo admite **chino simplificado** e **inglés** en esta versión. Este README en español es una traducción de cortesía; si encuentras discrepancias, prevalece el documento original en inglés (`README.md`).
