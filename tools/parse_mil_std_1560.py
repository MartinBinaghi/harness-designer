"""Extrae los arreglos de inserto de MIL-STD-1560C con posiciones de palabra (PyMuPDF).

Uso (desde la raíz del proyecto, con pymupdf instalado):
    curl -L -o std1560.pdf "https://everyspec.com/MIL-STD/MIL-STD-1500-1599/download.php?spec=MIL-STD-1560C_CHG-2.056319.pdf"
    python tools/parse_mil_std_1560.py std1560.pdf
Escribe src/data/mil-std-1560.json e imprime los arreglos descartados.

Por arreglo: IDs de contacto con su posición X/Y en pulgadas (de la tabla de
coordenadas: una palabra con forma de ID seguida, en la misma fila, por sus
coordenadas; la norma las da vistas desde la cara frontal del inserto de
pines) y tamaño de cada uno (del resumen, leído por columnas). Un arreglo se acepta solo si la cantidad de IDs
coincide con la suma declarada por la norma y todos quedan con tamaño.
"""
import json
import re
import sys
from collections import defaultdict

import pymupdf

doc = pymupdf.open(sys.argv[1] if len(sys.argv) > 1 else "std1560.pdf")
HEADER = re.compile(r"\(Insert arrangement (\d+-\d+)\)")
COORD = re.compile(r"^[+-]?\s*\d*\.\d+$|^[+-]$")
ID_TOKEN = re.compile(r"^(?:[A-Z]{1,2}|[a-z]{1,2}|\d{1,3})$")
SIZES = {"22D", "22M", "22", "20", "16", "12", "10", "8", "4", "0", "23-22"}

# Erratas de la norma: estos contactos repiten la coordenada de otro (25-37 H = C,
# 16-35 53 = 1). Se corrigen por la simetría del arreglo (H espeja a C como G a D;
# 53 espeja a 1 como 54 a 2).
COORD_FIXES = {("25-37", "H"): [0.333, -0.382], ("16-35", "53"): [0.312, 0.086]}

pages_by_arr = defaultdict(list)
for pno in range(len(doc)):
    t = doc[pno].get_text()
    for m in set(HEADER.findall(t)):
        pages_by_arr[m].append(pno)


def rows_of(words, tol=3.0):
    rows = []
    for w in sorted(words, key=lambda w: (w[1], w[0])):
        if rows and abs(rows[-1][0][1] - w[1]) <= tol:
            rows[-1].append(w)
        else:
            rows.append([w])
    return [sorted(r, key=lambda w: w[0]) for r in rows]


def first_y(words, text):
    ys = [w[1] for w in words if w[4] == text]
    return min(ys) if ys else None


def ids_on_page(words):
    shell_y = first_y(words, "Shell")
    fig_y = first_y(words, "FIGURE")
    limit = min(y for y in [shell_y, fig_y, 1e9] if y is not None)
    # Algunas tablas (ej. 9-7) dan primero los mm y entre paréntesis las pulgadas.
    texts = [w[4] for w in words]
    mm_first = any(texts[k] == "mm" and texts[k + 1] == "(inches)" for k in range(len(texts) - 1))
    ids = []
    for row in rows_of([w for w in words if w[1] < limit]):
        for i, w in enumerate(row[:-1]):
            nxt = row[i + 1]
            if ID_TOKEN.match(w[4]) and COORD.match(nxt[4]) and nxt[0] - w[2] < 90:
                xy = inch_pair(row[i + 1 :])
                if xy and mm_first:
                    xy = [round(v / 25.4, 4) for v in xy]
                ids.append((w[4], xy))
    return ids


def inch_pair(tokens):
    """X e Y: los dos primeros valores después del ID (cada uno va seguido de
    su equivalente en la otra unidad entre paréntesis, que se salta)."""
    vals, sign = [], ""
    for t in tokens:
        x = t[4].replace(" ", "")
        if x in ("+", "-"):
            sign = x
        elif re.fullmatch(r"[+-]?\d*\.\d+", x):
            vals.append(float(sign + x if x[0] not in "+-" else x))
            sign = ""
            if len(vals) == 2:
                return vals
        elif "(" in x or ")" in x:
            continue
        else:
            break
    return None


def summary(words):
    shell_y = first_y(words, "Shell")
    if shell_y is None:
        return None
    fig_y = first_y(words, "FIGURE") or 1e9
    head = [w for w in words if abs(w[1] - shell_y) < 20]
    def col_x(name):
        xs = [ (w[0] + w[2]) / 2 for w in head if w[4] == name]
        return xs[0] if xs else None
    cols = {
        "shell": col_x("Shell"),
        "arrangement": col_x("Arrangement"),
        "number": col_x("Number"),
        "size": col_x("Size"),
        "rating": col_x("rating") or col_x("Service"),
        "location": col_x("location"),
    }
    if None in (cols["number"], cols["size"], cols["location"]):
        return None
    # Bordes: lo que está a la derecha de "location" hasta la próxima columna de encabezado.
    right_cols = [(w[0] + w[2]) / 2 for w in head if (w[0] + w[2]) / 2 > cols["location"] + 30]
    loc_right = min(right_cols) - 15 if right_cols else 1e9
    body = [w for w in words if shell_y + 20 < w[1] < fig_y]

    def nearest_col(w):
        cx = (w[0] + w[2]) / 2
        if cx > loc_right:
            return "extra"
        cands = {k: v for k, v in cols.items() if v is not None}
        # La ubicación puede ser texto largo que empieza cerca de "location".
        if w[0] >= cols["location"] - 25:
            return "location"
        return min(cands, key=lambda k: abs(cands[k] - cx))

    out = []
    counts = [w for w in body if nearest_col(w) == "number" and w[4].isdigit()]
    sizes_w = [w for w in body if nearest_col(w) == "size"]
    locs_w = [w for w in body if nearest_col(w) == "location"]
    for c in counts:
        y = c[1]
        size = [w for w in sizes_w if abs(w[1] - y) < 6]
        size = " ".join(w[4] for w in sorted(size, key=lambda w: w[0]))
        loc = [w for w in locs_w if abs(w[1] - y) < 6]
        loc = " ".join(w[4] for w in sorted(loc, key=lambda w: (round(w[1]), w[0])))
        out.append((int(c[4]), size, loc))
    return out


def id_order(x):
    if x.isdigit():
        return (0, int(x), "")
    return (1 if x.isupper() else 2, len(x), x.lower(), x)


def expand_location(loc, all_ids):
    loc = loc.strip().rstrip(",")
    if re.fullmatch(r"(?i)all", loc):
        return list(all_ids)
    out = []
    for p in [p.strip() for p in loc.split(",") if p.strip()]:
        m = re.fullmatch(r"(\S+)\s*(?:-|thru|through)\s*(\S+)", p)
        if m and m.group(1) in all_ids and m.group(2) in all_ids:
            a, b = all_ids.index(m.group(1)), all_ids.index(m.group(2))
            out.extend(all_ids[a : b + 1])
            continue
        for q in p.split():
            if q in all_ids:
                out.append(q)
            else:
                return None
    return out


results, rejected = {}, {}
for arr, pnos in pages_by_arr.items():
    ids, rows = [], None
    for pno in pnos:
        words = doc[pno].get_text("words")
        ids += ids_on_page(words)
        s = summary(words)
        if s:
            rows = s
    pos = {i: COORD_FIXES.get((arr, i), xy) for i, xy in ids if xy}
    ids = sorted({i for i, _ in ids}, key=id_order)
    if not rows:
        rejected[arr] = f"no summary (ids={len(ids)})"
        continue
    declared = sum(r[0] for r in rows)
    if declared != len(ids):
        rejected[arr] = f"declared {declared} vs found {len(ids)}: {rows}"
        continue
    sizes, other, problem = {}, None, None
    for count, size, loc in rows:
        size_main = size.split()[0] if size else ""
        if size_main not in SIZES:
            problem = f"unknown size '{size}'"
            break
        label = size if size_main == size else size  # p.ej. "8 Twinax"
        if re.fullmatch(r"(?i)all others?|others|remainder|remaining", loc):
            other = (count, label)
            continue
        if loc == "" and len(rows) == 1:
            loc = "All"
        exp = expand_location(loc, ids)
        if exp is None or len(exp) != count:
            problem = f"location '{loc}' -> {exp} (expected {count})"
            break
        for i in exp:
            sizes[i] = label
    if problem:
        rejected[arr] = problem
        continue
    if other:
        rest = [i for i in ids if i not in sizes]
        if len(rest) != other[0]:
            rejected[arr] = f"'all other' {other[0]} vs {len(rest)}"
            continue
        for i in rest:
            sizes[i] = other[1]
    if set(sizes) != set(ids):
        rejected[arr] = "unassigned ids"
        continue
    if set(pos) != set(ids):
        rejected[arr] = "missing coordinates"
        continue
    # [id, tamaño, x, y]: x/y en pulgadas desde el centro, cara frontal del inserto de pines.
    results[arr] = [[i, sizes[i], *pos[i]] for i in ids]

key = lambda a: [int(x) for x in a.split("-")]
out = {
    "source": "MIL-STD-1560C w/CHANGE 2 (6 Dec 2018), extracted with tools/parse_mil_std_1560.py; "
    "only arrangements whose contact count matches the standard's declared total are included. "
    "Each contact: [id, size, x, y], x/y in inches from the insert center, front face of the pin insert.",
    "arrangements": {k: results[k] for k in sorted(results, key=key)},
}
json.dump(out, open("src/data/mil-std-1560.json", "w"), separators=(",", ":"))
print("accepted", len(results), "rejected", len(rejected), "total", len(pages_by_arr))
for k in sorted(rejected, key=key):
    print(" ", k, "->", rejected[k][:170])
