# Software de diseño de arneses — Plan del proyecto

Documento de referencia con las decisiones tomadas hasta ahora. Pensado para usarse como contexto del proyecto (por ejemplo como `CLAUDE.md` o `docs/PLAN.md`).

---

## 0. Principios de trabajo (leer primero)

- **Este plan es un documento vivo, no un contrato.** Se escribió antes de tener código; es esperable que cambie a medida que se diseña e implementa.
- **El proyecto todavía no tiene usuarios ni clientes reales.** No hay compatibilidad hacia atrás que mantener: ni archivos de proyecto, ni APIs, ni datos que preservar.
- **No se mantiene lo hecho a cualquier costo.** Si un diseño, una estructura de datos o una decisión de arquitectura resulta mala o mejorable, **se cambia ahora**, que es el momento más barato. Preferir rehacer limpio antes que parchear, agregar capas de compatibilidad o dejar código muerto "por las dudas".
- **Prolijidad sobre velocidad.** Código claro, bien separado y con tests en la lógica de cálculo (largos, nets, diámetros, costos). Nada de deuda técnica asumida a propósito en esta etapa.
- **Cuando algo cambie, se actualiza este documento** (qué cambió y por qué), para que el plan siempre refleje el estado real del diseño.
- **Decisiones técnicas vs. de dominio:** los cambios de arquitectura o implementación se pueden proponer y hacer con libertad, explicando el motivo. Lo que afecta cómo se trabaja en el taller (flujo de armado, qué datos se cargan, cómo se leen las hojas, criterios de corte o de terminación) se consulta con Martin antes de cambiarlo.
- El versionado del formato de archivo (sección 2) se mantiene como mecanismo, pero **no hace falta escribir migraciones** hasta que existan proyectos reales en uso.
- **Bitácora obligatoria: `docs/BITACORA.md`.** Desde el inicio del proyecto se lleva un registro del estado y de las decisiones:
  - **Estado actual**: etapa en curso, qué funciona, qué falta, próximos pasos. Se reescribe para reflejar siempre el presente.
  - **Registro de decisiones**: una entrada por decisión (fecha, qué se decidió, por qué, alternativas descartadas). Solo se agregan entradas; no se borran. Si una decisión se revierte, se agrega una nueva entrada que lo explique.
  - **Registro de sesiones**: al terminar cada sesión de trabajo, una entrada breve con fecha y qué se hizo.
  - Se actualiza **al final de cada sesión de trabajo** y cada vez que se toma o cambia una decisión.
  - Diferencia con este plan: el plan describe **el diseño vigente**; la bitácora cuenta **cómo se llegó ahí y dónde estamos**.

---

## 1. Objetivo

Aplicación de escritorio para diseñar arneses de cableado para autos de competición (TC2000, Rally, etc.). Permite modelar el arnés (conectores, cables, segmentos, ramas, splices, largos), calcular costos, largos de corte y diámetros de bundle, consultar la conectividad de cada pin y, opcionalmente, calcular la construcción concéntrica de cada segmento.

Uso inicial: personal. A futuro, posibilidad de venderlo, así que las decisiones de arquitectura deben dejar esa puerta abierta.

**Alcance de un proyecto: un arnés.** No se modela el auto completo. Los conectores de interconexión (entre arneses; se evita la palabra "interco" porque en TC2000 ya significa intercomunicador) se tratan como conectores del arnés con referencias externas (ver 4.2). El modelo deja la puerta abierta a proyectos multi-arnés en el futuro.

---

## 2. Decisiones de arquitectura

| Tema | Decisión |
|---|---|
| Tipo de aplicación | Instalable, 100% funcional offline. No es un proyecto web. |
| Plataforma | Windows primero. Mac/Linux más adelante. |
| Stack | Tauri (frontend web + núcleo Rust) con SQLite. |
| Portabilidad | No usar APIs exclusivas de Windows (rutas fijas, registro, etc.) para que el paso a Mac/Linux sea compilar y probar. |
| Archivos | Un archivo por proyecto (arnés), copiable y respaldable. El archivo guarda la **versión del formato** para poder migrar archivos viejos. |
| Biblioteca de partes | Separada de los proyectos. Exportable/importable. Incluye imágenes de conectores. Hay una **biblioteca base** de conectores estandarizados (DT/DTM/DTP, Superseal 1.5) que se suma con un botón; sus datos están marcados como no verificados hasta confirmarlos con el datasheet. |
| Configuración | Nada específico del taller en el código: moneda, markup, márgenes, unidades, valor hora, prefijos de nomenclatura, colores por tipo de señal, etc. van en configuración. |
| Moneda | Precios en USD, con fecha de actualización de cada precio. |
| Deshacer/rehacer | Contemplarlo desde el inicio en la arquitectura. |
| Licencia/activación | No se resuelve ahora. |

---

## 3. Etapas

1. **Modelo de datos**: biblioteca, instancias, cables, segmentos, splices y funciones, con formato de archivo versionado.
2. **Carga por tablas** (sin editor gráfico): consulta de pin (recorrido físico + net), consulta inversa por segmento, chequeos automáticos. Detalle en la sección 7.
3. **Costos y lista de corte**: partes, mano de obra, márgenes, markup.
4. **Diámetro estimado por segmento**: selección de termocontraíble y boots.
5. **Editor visual**: diagrama de armado (no escalado, con medidas) + vista esquemática pin a pin generada automáticamente. Detalle en la sección 10.
6. **Exportaciones e impresión**: PDF de lista de corte, hojas de pinout por conector (mismo formato que las hojas actuales del taller), etiquetas, **hoja de armado** (el diagrama con medidas, en A4/A3, para llevar a la mesa).
7. **Módulo de construcción concéntrica** (opcional), con y sin fillers.
8. **Futuro**: Mac/Linux, licencia, biblioteca distribuible, importación de pinouts desde CSV/Excel, revisiones, proyectos multi-arnés (vínculo real entre conectores de interconexión), inventario/stock (descontar del BOM lo que ya hay en el taller), **vista realista/3D o simulación del cableado** (requiere agregar coordenadas espaciales al modelo; se puede sumar sin romper lo existente).

La idea es que desde la etapa 3 el programa ya sea útil en el taller.

---

## 4. Modelo de datos

### 4.1 Biblioteca (catálogo reutilizable)

**Part** — base común de todo lo que se compra
- `part_number`, fabricante, descripción, categoría
- unidad de compra (unidad / metro), cantidad por pack
- precio (USD), fecha del precio

Cada tipo de parte extiende `Part`:

**ConnectorDef**
- **género** (macho/hembra)
- tamaño de carcasa, cantidad de vías
- lista de cavidades (la cantidad de vías es el largo de la lista, no un campo aparte): identificador tal cual el fabricante (1, 2… / A, B… / a, b…, **distinguiendo mayúsculas y minúsculas**) y tamaño de contacto que acepta
- **imágenes**: vista lateral, frontal y trasera, con numeración de pines. Cada ConnectorDef guarda su propia vista frontal (la numeración de macho y hembra está espejada; no se deriva de la contraparte). Se guardan **dentro del archivo de la biblioteca** (achicadas a 800 px, WebP), no como ruta a un archivo externo, para que la biblioteca se pueda copiar a otra máquina. Se ven en el Inspector al seleccionar un conector y (la frontal) en la hoja de pinout del doble click en el diagrama. Además, para las familias conocidas (Deutsch DT/DTM/DTP, Superseal, MIL-DTL-38999 por MIL-STD-1560) el programa **dibuja la cara** a partir de la serie y las vías: contorno, traba y número de cada vía, vista de acople o lado cables, con las vías usadas resaltadas; avisa cuando la numeración no está confirmada con el fabricante
- contraparte (opcional): el ConnectorDef con el que enchufa
- **parte trasera**, redonda (Ø) o rectangular (ancho × alto; se usa la diagonal): necesaria para dimensionar termo con adhesivo que pasa por encima del conector
- **terminación sugerida**: boot / termo con adhesivo / nada (ej. Amphenol de interconexión → boot; DTM → termo con adhesivo)
- los terminales sueltos (ej. AMP 6.3, ojales) se modelan como conector de una sola cavidad

**DeviceDef** — dispositivo con pinout conocido (ej. MoTeC PDM30, MoTeC C185, ECUs)
- lista de conectores del dispositivo (ej. PDM30: A 34 vías, B 26 vías, C perno M6), cada uno referenciando su ConnectorDef de acople
- por cada pin: **nombre** (ej. `OUT11`, `AV3`) y función (ej. "8 A Output 11")
- **pines en paralelo**: una misma salida en varios pines (ej. PDM30 OUT1 = A1 + A10)
- permite referenciar destinos por nombre ("PDM OUT11") y que el programa resuelva el pin (A6)
- se carga una vez desde el datasheet y sirve para todos los proyectos

**ContactDef**
- género, tamaño de contacto
- rango de calibre (mín./máx.) — se usa para validar la sección total cuando hay varios cables en un mismo contacto

**SealPlugDef** (tapón de cavidad)
- tamaño de contacto que cubre

**WireDef**
- calibre (mm² o AWG), norma/tipo (ej. M22759/32), color
- **diámetro exterior** (indispensable para diámetros y trenzado)
- margen de corte por defecto de este tipo de cable (opcional; ej. ethernet con más margen)
- conductores: 1 para cable simple; para multiconductor comprado (par trenzado, apantallado), lista de conductores internos + malla/drenaje

**SpliceDef**
- rango de calibre, cantidad máxima de cables

**ComponentDef** (resistencias, diodos)
- tipo, valor (ej. 100 Ω), encapsulado

**CoveringDef** (termocontraíble, sleeving — normalmente Raychem)
- diámetro suministrado, diámetro contraído, espesor de pared contraído
- con o sin adhesivo

**AccessoryDef** (moldes, backshells, etiquetas)
- **boot** (recto / 90°): lista de conectores compatibles (serie + tamaño de carcasa) y rango de diámetro del lado cable; largo de la pata
- **transición / molde en T**: tres patas, cada una con rango de diámetros y largo; va en nodos de breakout
- otros (backshells, etiquetas): tipo, rango de diámetros

**SignalType** (configuración) — tipos de señal con color por defecto
- ej.: 5V → violeta, 0V → negro, Señal → azul, 12V → rojo, GND → blanco, CAN, Ethernet…
- configurable por el usuario; no sigue ninguna norma

### 4.2 Proyecto (un arnés)

**Project** (= un arnés)
- nombre, **código del arnés** (ej. `MOT-01`), cliente, revisión, versión del formato de archivo
- **conector principal**: donde va la etiqueta del arnés (nombre + código)
- configuración: markup, margen de corte global (por defecto 10%), paso de trenzado por defecto
- mano de obra: horas estimadas × valor hora

**DeviceInstance** (opcional)
- dispositivo del arnés (ECU, PDM, sensor…), con o sin DeviceDef asociado

**Node** — punto de la topología
- tipo: extremo de conector / breakout / punto de splice / punto de masa
- en breakouts, **terminación**: molde en T / termo con adhesivo / nada

**Segment** — tramo físico entre dos nodos
- nodo A, nodo B, **largo**
- paso de trenzado (opcional; si no, usa el del proyecto)
- coberturas aplicadas (qué termocontraíble/sleeving y en qué largo)

**ConnectorInstance** (ej. "X4 · Damper FL")
- ID corto, **nombre descriptivo** (es la etiqueta del conector), ConnectorDef, device, nodo
- **terminación de salida**: boot (recto / 90°) / termo con adhesivo / nada — por defecto la sugerida por el ConnectorDef
- backshell (opcional)
- **estado**: completo / **pendiente** (ej. "falta pinout y conector, se envía después")
- **interconexión**: marca de conector de interconexión (entre arneses; no confundir con "interco" = intercomunicador en la jerga del taller), campo opcional "enchufa con" (hoy texto libre; a futuro vínculo real a otro arnés)

**CavityAssignment** — una por cavidad del conector
- contacto usado **o** tapón si la cavidad no se usa
- **puede tener más de un cable** (ej. 2 cables 22 AWG en un contacto DTM)
- **referencia externa** (texto, opcional): qué hay del otro lado cuando el pin sale del arnés (conectores de interconexión, destinos no modelados). Ej. "Comunicación motor", "Eng ECU 5V VREF4"

**GroundPoint** — punto de masa / ojal (ej. "G1 · Masa chasis", ojal Ø6)
- terminal usado, ubicación (nodo)

**SpliceInstance**
- SpliceDef
- ubicación: **en un nodo**, o **sobre un segmento a X mm de uno de sus extremos** (ej. unión de 5 cables a 2 cm del conector, de donde sale un cable corto al pin)

**ComponentInstance** (ej. "R1 · Terminación CAN 100Ω")
- ComponentDef, conectado entre dos extremos (pines/cables)

**WireInstance**
- ID, WireDef, color (sugerido por el tipo de señal, modificable)
- extremo A y extremo B: cavidad de conector, splice, punto de masa o componente
- **función**, en dos partes:
  - **tipo de señal** (SignalType): define el color sugerido
  - **nombre específico** (ej. "Damper FL", "Brake Press Rear")
- margen de corte manual (opcional)
- etiqueta individual (opcional)

**TwistGroup** — cables sueltos trenzados en el taller (ej. "twist I", "twist II")
- lista de cables, blindaje (sí/no), drenaje
- en el cálculo concéntrico cuenta como un solo elemento
- distinto de un cable multiconductor comprado (que es un WireDef)

**Revision**
- snapshot del proyecto, fecha, notas

### 4.3 Datos calculados (no se guardan)

- **Recorrido de cada cable**: como la topología es un árbol, entre dos nodos hay un único camino; se calcula automáticamente.
- **Nets**: se arman recorriendo la conectividad (cable → splice → cable…, cables que comparten cavidad, componentes). Se detienen en conectores de interconexión y referencias externas.
- **"Termina en"** de cada pin: destino final, aunque haya splices en el medio (ej. "X9 C185 · 5V · pin 28 (vía SP2)").
- **Cables por segmento**: base para diámetro, trenzado, concéntrico y consulta inversa.
- **Largo de corte** de cada cable (ver 5.1).
- **Diámetro estimado del bundle** por segmento.
- **BOM, lista de corte, costo total, lista de etiquetas.**

---

## 5. Reglas de cálculo

### 5.1 Largo de corte

```
largo_con_trenzado = Σ (largo_segmento × factor_trenzado_del_cable_en_ese_segmento)
largo_de_corte     = largo_con_trenzado × (1 + margen_de_seguridad)
```

**Margen de seguridad** — tres niveles, gana el más específico:
1. Margen manual del cable
2. Margen del tipo de cable (WireDef)
3. Margen global del proyecto (10% por defecto)

**Margen mínimo por trenzado**: un cable trenzado recorre una hélice, no una recta.

```
factor = √(1 + (π · D / P)²)
```
- `D`: diámetro de la hélice (diámetro de la capa donde va el cable; el cable central tiene factor 1)
- `P`: paso del trenzado (mm que avanza el bundle por vuelta completa)

Ejemplo: bundle de 10 mm, paso 120 mm, cable en capa exterior (D ≈ 9 mm) → factor ≈ 1,027 → 2,7% mínimo.

- Si se usa el módulo concéntrico, `D` sale de la capa real de cada cable.
- Si no, se estima con el peor caso (capa exterior del diámetro estimado del bundle): resultado conservador.
- Si el margen configurado es menor que el mínimo por trenzado, el programa avisa.

**Paso de trenzado por defecto**: en el taller se trenza a ojo, sin un paso fijo. Por eso el paso por defecto se expresa como **múltiplo del diámetro del bundle** (configurable), con un valor conservador (paso corto = más largo de cable):
- Referencia orientativa: paso entre 8 y 16 veces el diámetro del bundle.
- Valor por defecto: **8 × D_bundle** (conservador). Para la capa exterior da un factor ≈ 1,074 (7,4%); con 16 × D_bundle, ≈ 1,019 (1,9%).
- Expresado así, el factor no depende del tamaño del bundle. El 10% de margen habitual del taller cubre incluso el caso conservador.
- Se puede fijar un paso distinto por segmento si hace falta.

### 5.2 Diámetro estimado del bundle

Siempre disponible (aunque no se use el módulo concéntrico).

```
D_bundle = √( Σ dᵢ² / f )
```
- `dᵢ`: diámetro exterior de cada elemento del segmento (cables sueltos; grupos de trenzado y multiconductores como un solo elemento con su propio diámetro)
- `f`: factor de llenado, configurable. **Valor inicial 0,75**, pendiente de calibrar midiendo bundles reales.
- Diámetro final del segmento = D_bundle + 2 × espesor de pared contraído por cada capa de cobertura.
- Donde hay un splice sobre el segmento, el diámetro crece localmente: se marca como el punto más grueso del tramo.

Detalle de selección de coberturas y moldes en la sección 9.

### 5.3 Construcción concéntrica (módulo opcional)

Si el usuario no lo usa, trenza como prefiera. Si lo usa, el programa recomienda:

- **Con fillers**: se toma el calibre dominante del segmento como referencia, se arman capas estándar (1-6-12-18…) y los huecos se completan con fillers del mismo diámetro. Indica cuántos fillers, de qué diámetro y en qué capa.
- **Sin fillers**: acomoda los cables reales (calibres mezclados) con una heurística (más gruesos al centro, minimizar huecos). Muestra el acomodamiento sugerido y el diámetro resultante.
- En ambos casos: sentido de trenzado alternado por capa y diámetro final por segmento.
- Los cables multiconductor y los TwistGroup cuentan como un solo elemento.
- Se calcula por segmento, porque la composición cambia en cada breakout.

### 5.4 Costos

- Materiales: **sobre lo usado** por defecto; opción de calcular sobre lo comprado (packs completos).
- Repuesto configurable por categoría (sobre todo contactos, por fallas al crimpear).
- Mano de obra: horas estimadas × valor hora.
- **Markup** (porcentaje de ganancia sobre el costo): opcional, **0% por defecto**. El programa muestra el costo real; quien vende agrega su margen. A futuro, refinable por categoría.
- Todo en **USD**, sin conversión a pesos.
- Detalle en la sección 8.

---

## 6. Nomenclatura

Cada elemento tiene un **ID corto automático** + un **nombre descriptivo**. Prefijos configurables.

| Elemento | ID | Ejemplo |
|---|---|---|
| Arnés | código libre | `MOT-01` · "Cableado Motor" |
| Conector | X1, X2… | X4 · "Damper FL" |
| Cable | W001… | W023 · "5V" |
| Splice | SP1… | SP2 |
| Punto de masa / ojal | G1… | G1 · "Masa chasis" |
| Componente | R1, D1… | R1 · "Terminación CAN 100Ω" |
| Segmento | S01… | (interno) |

- Se usa X (norma IEC) y no C, para no confundir con nombres como "C185" ni con capacitores.
- **El género no forma parte del ID** (si se cambia un conector por su contraparte, el ID no cambia). Se muestra siempre al lado: distintivo "H"/"M" en tablas y pinouts, y texto completo en la ficha ("DTM 3 vías hembra"). Opción de visualización "X4-H" / "X4-M", calculada, no guardada.
- **Pines**: identificador tal cual el fabricante, distinguiendo mayúsculas y minúsculas (en el Amphenol MS3476L20-41P, "N" y "n" son pines distintos).

## 7. Etapa 2 — Pantallas (carga por tablas)

### 7.1 Flujo sugerido
1. Biblioteca (partes y dispositivos necesarios)
2. Topología (nodos y segmentos con largos)
3. Conectores (ubicarlos en nodos)
4. Cables (desde, hasta, tipo, función)
5. Splices, masas y componentes
6. Revisar chequeos

El orden no es obligatorio: un cable hacia un conector inexistente queda marcado como incompleto.

### 7.2 Estructura de la ventana
- **Barra lateral izquierda**: Biblioteca · Topología · Conectores · Cables · Splices · Chequeos
- **Área central**: tabla de la sección elegida
- **Panel derecho (inspector)**: detalle de lo seleccionado en cualquier pantalla (acá vive la consulta de pin)
- **Barra inferior**: contador de errores/advertencias siempre visible

### 7.3 Pantallas
- **Biblioteca**: una pestaña por tipo de parte y una para dispositivos. Conectores: lista compacta (buscador, filtro por serie y por datos faltantes) + ficha del elegido (parte, contraparte en los dos sentidos, terminación, vías con la cara dibujada, imágenes, dónde se usa en el proyecto abierto). Generador de cavidades ("1 a 35, contacto tamaño 22") con edición individual. Carga de imágenes de vistas. Carga de pinout de dispositivo (nombre y función de cada pin, pines en paralelo).
- **Topología**: tabla de segmentos (segmento, nodo desde, nodo hasta, largo, paso de trenzado, coberturas) + vista de árbol en texto (ramas indentadas). Rechaza lazos.
- **Conectores**: lista de conectores (ID, nombre, parte, género, device, nodo, estado). Al elegir uno, **hoja de pinout con el mismo formato que las hojas actuales del taller**: Pin · Función · Termina en (calculado) · AWG · Color · Largo · Conector · Vistas.
- **Cables (wire list / TO-FROM)**: tabla global editable estilo planilla (ID, desde, hasta, tipo de señal, nombre, WireDef, color, recorrido calculado, largo con trenzado, margen, largo de corte). Extremos por texto con autocompletado: `X1:12`, `SP3`, `G1`, o por nombre de pin de dispositivo (`PDM OUT11`).
- **Splices**: lista con tipo, ubicación y cables que une. Incluye masas y componentes.
- **Inspector**: muestra **y edita** lo seleccionado (nodo, segmento, conector, masa, splice, cable) con los mismos campos que las tablas; como edita el mismo proyecto, el resto de las vistas se actualiza solo. Las vías de un conector (contacto, tapón, referencia externa) se siguen editando en la pantalla de Conectores.
  - pin seleccionado → función, cable(s), extremo opuesto, recorrido por segmentos, **net completa**, referencia externa si sale del arnés. Todo clickeable para navegar.
  - segmento seleccionado → cables que pasan, largo, diámetro estimado (etapa 4).
- **Chequeos**: lista de errores/advertencias; click lleva al elemento. Las filas con problemas se marcan en su tabla.

### 7.4 Etiquetas
- **Conector**: su nombre descriptivo (ej. "Optica Derecha", "Sensor presión freno").
- **Arnés**: en el conector principal, nombre + código del arnés.
- **Cable**: opcional.
- El programa genera la lista de etiquetas para imprimir.
- Se imprimen con una impresora de etiquetas termocontraíbles. **No es crucial**: alcanza con exportar la lista (CSV/texto) para cargarla en el software de la impresora. Sin integración directa con la impresora.

---

## 8. Etapa 3 — Lista de corte, BOM y costos

### 8.1 Lista de corte (para el taller)
- Un renglón por cable: ID, función, WireDef (calibre, tipo, color), desde → hasta (ej. "X4:2 → X9:47"), largo de segmentos, margen aplicado, **largo de corte final**, grupo de trenzado.
- Sin largo de pelado (es conocimiento del taller).
- Ordenamientos: por tipo de cable (cortar de corrido del mismo rollo), por largo, por conector. Los grupos de trenzado aparecen juntos.
- **Totales por tipo de cable**: metros necesarios de cada WireDef.
- **Lista de corte de coberturas**: tramos de termocontraíble/sleeving por segmento con su largo, y boots por conector.

### 8.2 BOM (lista de materiales)
- Agrupado por categoría: conectores, contactos, tapones, splices, componentes, cables (m), coberturas (m), accesorios, etiquetas.
- Por parte: cantidad necesaria, repuesto (% configurable), **cantidad a comprar redondeada al pack** (sirve para el pedido aunque no se cobre así), precio unitario, subtotal, fecha del precio.
- Sin umbral automático de desactualización: la fecha del precio se muestra siempre, y Martin decide cuándo recotizar una parte (ver sección 13).

### 8.3 Costos y presupuesto
- Materiales (sobre lo usado, u opcionalmente sobre lo comprado) + mano de obra (horas × valor hora) + markup opcional (0% por defecto).
- Total en USD, con desglose por categoría.
- **Presupuesto con BOM completo** por ahora (a revisar con quien hace las ventas).

---

## 9. Etapa 4 — Diámetros, termocontraíble y moldes

### 9.1 Forma de armado (supuesto del cálculo)
El arnés se arma tramo por tramo: se insertan los cables, se trenza, se coloca el termo de ese tramo y se sigue. Por eso el termocontraíble **nunca tiene que pasar por una parte más gruesa** para llegar a su lugar.

### 9.2 Termocontraíble del segmento
Sirve si:
1. **Contraído ≤ D_bundle** del segmento (para que apriete).
2. **Suministrado ≥ D_bundle del segmento** + margen.

El programa sugiere el tamaño más chico que cumple, muestra alternativas y avisa si ninguno de la biblioteca sirve.

**Largo a cortar** = largo del segmento − largo de las patas de boots/moldes en sus puntas + solape.

**Solape** (configurable):
- Termo con adhesivo: **20 a 40 mm** (valor por defecto: 30 mm).
- Moldes (boots, T): mayor; se define por parte en el AccessoryDef (valor a completar al cargar cada molde).

### 9.3 Terminación en conectores
- **Boot** (recto / 90°), típico en conectores principales (motor, interconexión): se chequea que calce con la serie/carcasa del conector y que el lado cable cumpla el mismo criterio que el termo contra el diámetro del bundle a la salida del conector.
- **Termo con adhesivo**, típico en conectores chicos: pieza corta aparte que tiene que **pasar por la parte trasera del conector** (diámetro trasero del ConnectorDef) y **contraer hasta el diámetro del bundle**.
- **Nada**.

### 9.4 Terminación en breakouts
- **Molde en T**: cada pata se chequea contra el diámetro del segmento que sale por ella.
- **Termo con adhesivo** sobre la unión: dimensionado según la rama más gruesa que cubre.
- **Nada**.

### 9.5 Salida
- Por segmento: D_bundle, diámetro final con coberturas, termo sugerido y alternativas.
- Por conector y por breakout: terminación y parte sugerida.
- Advertencias si nada de la biblioteca sirve.
- Alimenta el BOM y la lista de corte de coberturas (etapa 3).

---

## 10. Etapa 5 — Editor visual

### 10.1 Principio
El gráfico es **otra vista de los mismos datos**. Editar en el gráfico actualiza las tablas y viceversa; nunca se desincronizan.

### 10.2 Diagrama de armado (vista física)
El arnés se arma sobre una mesa a partir de un diagrama con medidas (hoy hecho a mano). Este diagrama lo reemplaza.
- **No escalado por defecto**: esquema libre, acomodado a gusto (estilo el croquis de la hoja WRC).
- **Opción "a escala"**: cada segmento se dibuja proporcional a su largo real; al mover un nodo gira alrededor del nodo del que cuelga sin cambiar la distancia, y su rama lo acompaña.
- Conectores como bloques con ID, nombre y **símbolo según género**.
- Breakouts como nodos chicos, con indicador de molde en T / termo con adhesivo.
- Segmentos como líneas con **largo** y diámetro estimado.
- Splices (en su posición sobre el segmento), masas y componentes con símbolo propio.
- **Distancia acumulada opcional** desde el conector principal hasta cada breakout, conector y masa (ej. "a 450 mm de X1"), para marcar en la mesa desde un único punto de referencia.
- Conectores pendientes y elementos con errores, resaltados.
- Imprimible en A4/A3 ajustado a la hoja (hoja de armado, etapa 6).

### 10.3 Vista esquemática pin a pin
- **Generada automáticamente** desde los datos (no se dibuja a mano): conectores como bloques con su lista de pines, líneas pin a pin, splices como puntos de unión.
- Colores según el tipo de señal.
- Crear un cable arrastrando de un pin a otro (crea el mismo registro que la tabla de cables).
- Muestra solo los pines usados por defecto (opción para ver todos). Las posiciones no se guardan: siempre se regenera desde los datos (principal a la izquierda, uniones en el medio, resto a la derecha, ordenado para minimizar cruces).

### 10.4 Interacción (ambas vistas)
- Crear: arrastrar el "+" de un nodo a un lugar vacío (rama nueva) o a otro nodo (segmento, si no cierra un lazo); partir un segmento para insertar un breakout; doble click en la etiqueta de un segmento para editar su largo; Supr para borrar (lo que tiene conector/masa/splice se borra desde su tabla).
- Doble click en un extremo sin conector: se le asigna una parte de la biblioteca y un nombre.
- Clic en un pin → **se resalta en el dibujo el recorrido del cable y toda la net**; el inspector muestra el detalle.
- Clic en un segmento → cables que pasan y diámetro.
- Doble clic en un conector → vista frontal (imagen de la biblioteca) + tabla de pinout. La vista frontal no se muestra en el dibujo general.
- **Layout automático** del árbol cuando el arnés se cargó por tablas; después se acomoda a mano.
- La posición de cada elemento se guarda en su `Node` (`diagram_x`/`diagram_y`); sin posición, se ubica con el layout automático. Al primer arrastre se fijan todas.

### 10.5 Tecnología
- **React Flow** para el editor de nodos/conexiones (arrastrar, conectar, zoom, selección; renderiza en SVG, facilita exportar/imprimir).
- Layout automático propio de árbol (una columna por nivel, una fila por rama final), sin librería: elkjs se probó y se descartó (ver bitácora).
- Segmentos como líneas rectas o quebradas; curvas a mano quedan para después.

---

## 11. Consultas

- **Consulta de pin**: función, dónde termina el cable, por qué segmentos pasa y, si forma parte de una unión, todos los pines unidos (net). En conectores de interconexión o destinos externos se detiene y muestra la referencia externa.
- **Consulta inversa por segmento**: todos los cables que pasan por él.

---

## 12. Chequeos automáticos (DRC)

**Errores**
- Calibre fuera del rango del contacto; sección total fuera de rango cuando hay varios cables en una cavidad.
- Splice con más cables o calibre fuera de lo que admite su SpliceDef.
- Cables sin extremo o sin recorrido posible.
- Pines duplicados.
- Intento de crear un lazo en la topología (se rechaza).

**Advertencias**
- Cavidades sin usar sin tapón.
- Cables de una misma net con distinta función.
- Margen de corte menor al mínimo por trenzado.
- Pin con varios destinos → **sugerir splice** (o validar que entren en el contacto).
- Conectores o dispositivos en estado **pendiente**.
- Ningún termo, boot o molde de la biblioteca sirve para un segmento, conector o breakout.
- Conector con termo con adhesivo sin diámetro trasero cargado en el ConnectorDef.

---

## 13. Decisiones cerradas

| Pregunta | Decisión |
|---|---|
| Alcance del proyecto | Un arnés por proyecto. Conectores de interconexión (entre arneses) como conectores con referencia externa y campo "enchufa con". No se les dice "interco": en TC2000 esa palabra ya significa intercomunicador. |
| Topología | Solo árbol en la primera versión. Se valida al conectar segmentos. El modelo de nodos/segmentos es general, así que se podrían admitir lazos a futuro. |
| Función del cable | Tipo de señal (con color sugerido configurable) + nombre específico. Por cable, con aviso si cables de la misma net difieren. |
| Colores | Configurables por tipo de señal; sin norma. Modificables cable por cable. |
| Splices | En un nodo o sobre un segmento a X mm de un extremo. |
| Varios cables por cavidad | Permitido, validando sección total contra el contacto. |
| Nomenclatura | ID corto automático (X, W, SP, G, R/D, S) + nombre descriptivo; prefijos configurables. |
| Género del conector | Dato del ConnectorDef, fuera del ID, siempre visible; en el editor gráfico se dibuja distinto. |
| Dispositivos | DeviceDef en la biblioteca con pines nombrados y pines en paralelo. |
| Trenzados del taller | Entidad TwistGroup (con blindaje opcional). |
| Margen de corte | Porcentaje en tres niveles (proyecto / tipo de cable / cable) + mínimo por trenzado. |
| Mano de obra | Horas × valor hora, a nivel proyecto. |
| Costo de materiales | Sobre lo usado; opción sobre lo comprado. El BOM igual muestra cantidad a comprar por pack. |
| Markup | Opcional, 0% por defecto. |
| Moneda | Siempre USD. |
| Presupuesto | BOM completo por ahora. |
| Largo de pelado | No se incluye. |
| Inventario/stock | Fuera de alcance por ahora; a futuro. |
| Coberturas | Termocontraíble Raychem, con o sin adhesivo. |
| Terminación en conectores | Boot (recto/90°), termo con adhesivo o nada; elegible por conector, con sugerencia desde la biblioteca. |
| Terminación en breakouts | Molde en T, termo con adhesivo o nada; elegible por nodo. |
| Colocación del termo | Tramo por tramo; el suministrado solo contempla el diámetro de su propio segmento. |
| Factor de llenado | 0,75 inicial, a calibrar. |
| Diagrama de armado | No escalado, con medidas; reemplaza el diagrama a mano. Distancia acumulada opcional. |
| Vista pin a pin | Sí, generada automáticamente. |
| Vista realista/3D | A futuro. |
| Etiquetas | Impresora de etiquetas termocontraíbles; solo exportar lista (CSV/texto). No crucial. |
| Solape | Termo con adhesivo 20–40 mm (defecto 30 mm); moldes, por parte. |
| Paso de trenzado | A ojo en el taller; por defecto 8 × D_bundle (conservador), configurable. |
| Concéntrico | Opcional, con y sin fillers. |
| Precios desactualizados | Sin umbral automático por días: se muestra la fecha del precio y Martin decide cuándo recotizar. |
| Calibre mínimo de salida de un splice | Suma de la sección (mm²) de los cables que entran, redondeada al calibre más fino del catálogo de cables que la cubre (no una fórmula AWG abstracta: solo calibres que existen en la biblioteca). |

---

## 14. Pendientes

**Se definen con el uso (arrancan con valor por defecto):**
- Calibrar el factor de llenado midiendo bundles reales (inicial 0,75).
- Margen del suministrado del termo sobre el diámetro del bundle.
- Porcentaje de repuesto por categoría (contactos, etc.).
- Solape de cada molde (se carga por parte).

**Se resuelven durante la implementación:**
- Heurística de acomodamiento sin fillers (etapa 7).
- Extensión y estructura interna del archivo de proyecto.
