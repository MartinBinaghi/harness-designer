---
name: Harness Designer
description: Herramienta de escritorio para diseñar arneses de cableado de competición
colors:
  bg: "#f4f5f7"
  surface: "#ffffff"
  surface-2: "#eceef1"
  border: "#d7dbe0"
  text: "#1b1f24"
  text-muted: "#5b6470"
  accent: "#1868db"
  error: "#c0392b"
  warning: "#92400e"
typography:
  ui:
    fontFamily: "Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.4
  mono:
    fontFamily: "JetBrains Mono, Cascadia Code, Consolas, monospace"
    fontSize: "0.86rem"
rounded:
  sm: "2px"
  md: "3px"
spacing:
  xs: "0.35rem"
  sm: "0.5rem"
  md: "1rem"
  lg: "1.5rem"
---

# Design System: Harness Designer

## Overview

**Creative North Star: "The Engineering Workbench"**

Harness Designer es una herramienta de escritorio de uso interno de taller, no un producto que busca persuadir a nadie: alguien la abre para armar una lista de corte y un BOM con datos reales de conectores y cables, la misma persona que usa SolidWorks o Fusion 360 durante el resto del día. El mundo visual elegido es el de esas herramientas: gris neutro profesional, un solo azul funcional, tablas densas con números alineados, paneles con borde fino en vez de tarjetas con sombra. Nada compite por atención; todo existe para que un dato se lea rápido y sin ambigüedad.

Rechazo confirmado: la dirección anterior del proyecto ("Cabina", ámbar sobre carbón) se descarta por completo, no se refina. El usuario pidió explícitamente alejarse de cualquier cosa que se sienta "cálida" o de app web, y acercarse a SolidWorks / Fusion 360 / Arduino IDE.

**Key Characteristics:**
- Tema claro, gris neutro, un único acento azul funcional (nunca decorativo).
- Tablas como superficie principal: bordes finos de 1px, encabezado con banda de fondo sutil, números en monoespaciada alineados a la derecha.
- Pestañas planas con indicador inferior (nunca un segmented control con pastillas).
- Sin sombras, sin gradientes, sin bordes de color a un costado en tarjetas o alertas — los estados (error/warning) se marcan con un punto de color + texto, como una barra de estado de herramienta de ingeniería.

## Colors

Paleta restringida: neutros + un solo azul de acento, como corresponde a una superficie de "Operar" (no de persuadir).

### Primary
- **Workbench Blue** (`#1868db`): único acento del sistema. Foco de campos, indicador de pestaña activa, bordes al pasar el mouse sobre un botón, valores destacados (ej. largo de corte calculado). Nunca decorativo: si no hay una acción o un dato que resaltar, no aparece.

### Neutral
- **Canvas** (`#f4f5f7`): fondo general de la ventana, debajo de los paneles.
- **Surface** (`#ffffff`): tablas, árboles, paneles de resultado — todo lo que es "contenido".
- **Surface muted** (`#eceef1`): campos de formulario y controles sueltos (fuera de una tabla), para distinguirlos visualmente del contenido.
- **Border** (`#d7dbe0`): todo borde de panel, tabla y control.
- **Text** (`#1b1f24`): texto principal.
- **Text muted** (`#5b6470`): headers de columna, hints, metadatos.

### Estado (no decorativos)
- **Error** (`#c0392b`): solo en el punto indicador de un hallazgo tipo error.
- **Warning** (`#92400e`): punto indicador de warning, y texto de celda cuando un valor calculado queda fuera de rango (ej. margen de corte bajo el mínimo, boot/covering/molde que no calza). Elegido con contraste ≥4.5:1 sobre blanco, porque también se usa como color de texto, no solo de acento.

### Named Rules
**The One Accent Rule.** Un solo azul en todo el sistema. Ningún otro color decorativo; el error y el warning son semánticos, no decorativos, y solo aparecen cuando hay algo real que señalar.

## Typography

**UI Font:** Inter (400–700, variable)
**Mono Font:** JetBrains Mono (400–700, variable)

**Character:** Inter es el workhorse neutro de cualquier herramienta profesional moderna — no tiene personalidad propia que compita con los datos. JetBrains Mono entra solo donde hay números o identificadores que necesitan alinearse (tablas, árbol, IDs de cable/conector): nunca como "disfraz técnico" en texto que no es dato.

### Hierarchy
- **Headings** (600, tamaño de contexto, -0.005em tracking): títulos de sección.
- **Body / UI** (400–500, 15px, 1.4 line-height): texto de interfaz, labels, botones.
- **Table / data** (400–500, 0.86rem, tabular-nums): toda celda numérica y todo ID.
- **Label** (600, 0.7rem, 0.07em tracking, uppercase, `text-muted`): encabezados de columna de tabla.

### Named Rules
**The Mono-Is-Data Rule.** JetBrains Mono aparece únicamente sobre datos tabulares o identificadores (S1, W004, 531.8mm). Nunca se usa mono para darle aire "técnico" a una oración normal.

## Layout

Densidad de taller, no de sitio web: tablas con fila de ~30px, padding de celda 0.35–0.4rem, sin espacios grandes de aire entre secciones salvo el margen habitual entre bloques (`section { margin-bottom: 2rem }`). El ancho de la ventana se usa completo (sin `max-width` centrado — decisión ya tomada antes en el proyecto). Las pestañas de navegación (principal y las de Biblioteca) usan el mismo patrón visual: fila plana con borde inferior, pestaña activa marcada con un guión de 2px en el acento.

## Elevation & Depth

Sin sombras en ningún lugar del sistema. La separación entre superficies se resuelve con borde de 1px (`--border`) y diferencia de fondo (`--surface` vs `--surface-2` vs `--bg`), nunca con `box-shadow`. Esto es intencional: una herramienta CAD/EDA real no flota nada sobre nada, todo está "en el plano".

### Named Rules
**The Flat Plane Rule.** Ninguna superficie tiene `box-shadow`. La jerarquía se lee por borde y por fondo, no por elevación.

## Shapes

Radios mínimos: 2px en controles sueltos (input/select/button), 3px en paneles/tablas/árbol. Nunca "rounded-lg" ni esquinas pronunciadas — el radio existe solo para suavizar el borde de 1px, no como gesto de marca.

## Components

### Buttons
- **Shape:** 2px de radio, borde 1px `--border`, fondo `--surface-2`.
- **Default:** texto `--text`, sin relleno de color — es un botón de herramienta, no un CTA de marketing.
- **Hover:** borde y texto pasan a `--accent` (sin fondo de color).
- **Disabled:** opacidad 0.5, cursor `not-allowed`.
- **Focus:** contorno de 2px `--accent`, offset -1px (contorno "hacia adentro", como un control nativo, no un halo).

### Tabs
- **Style:** fila plana, sin fondo, separadas por `gap`; borde inferior de 1px `--border` en toda la fila.
- **Active:** borde inferior de 2px `--accent`, texto en peso 600.
- **Inactive:** texto `--text-muted`, sin borde.

### Tables
- **Corner style:** contenedor con borde 1px `--border`, radio 0 (la tabla en sí no lleva radio, solo los paneles que la envuelven cuando aplica).
- **Header:** fondo `--surface-2`, texto `--text-muted` en mayúsculas pequeñas trackeadas.
- **Rows:** borde inferior 1px al 70% de opacidad; sin hover de fila (las celdas editables ya marcan su propio estado).
- **Numeric columns:** alineadas a la derecha, `font-variant-numeric: tabular-nums`.

### Section headings (`h3`)
- **Style:** mismo tratamiento que un encabezado de columna de tabla — mayúsculas, 0.72rem, 700, 0.07em de tracking, `--text-muted`, con una línea inferior de 1px `--border`. El título queda atado a la tabla/lista que sigue (misma línea, mismo lenguaje) en vez de flotar como un heading suelto.

### Findings / alerts (chequeos DRC)
- **Style:** lista dentro de un panel con borde 1px `--border`, cada ítem separado por una línea de 1px (no tarjetas individuales).
- **Indicator:** punto circular de 7px (`--error` o `--warning`) antes del texto — nunca un borde de color a un costado del ítem.

### Inputs / Fields
- **Style:** borde 1px `--border`, fondo `--surface-2`, radio 2px.
- **Dentro de una tabla:** sin borde ni fondo propio (se leen como la celda); al enfocar, una línea de 1.5px `--accent` debajo, no un contorno alrededor de toda la celda.

## Do's and Don'ts

### Do:
- **Do** usar `--accent` únicamente para foco, hover de botón, indicador de pestaña activa y el valor calculado que más importa en un panel (ej. largo de corte).
- **Do** alinear a la derecha y en monoespaciada cualquier columna numérica.
- **Do** marcar error/warning con un punto de color + texto, nunca con un borde lateral de color.
- **Do** usar bordes de 1px y diferencia de fondo para separar superficies.

### Don't:
- **Don't** usar `box-shadow` en ningún componente.
- **Don't** usar un segmented control tipo pastilla para las pestañas — es una barra plana con indicador inferior.
- **Don't** introducir un segundo color de acento. Un azul, y los dos semánticos (error/warning), nada más.
- **Don't** usar mono para texto que no sea dato tabular o identificador.
