import { describe, expect, it } from "vitest";
import { detectDelimiter, parseCsvRecords, parseSiteCsv } from "@/lib/outreach/csv-import";

// Fixture 100 % FICTICIA (nombres inventados, teléfonos 9000000xx, dominio .test).
const HEADER = "id,solicitud,nombre,menor,correo,telefono,estado,destino_entrada,codigo_final,usada,ninos_acompanantes";
const ASISTENTES = [
  "﻿" + HEADER,
  `101,10,Ana Prueba,no,ana@ficticio.test,'+56900000101,aprobado,correo,,no,0`,
  `102,10,"Beto, el Ficticio",no,,'+56900000102,aprobado,correo,,sí,0`,
  `103,11,Carla Anulada,no,carla@ficticio.test,,anulado,,,no,0`,
  `104,11,Menor Ficticio,sí,,,aprobado,,,no,0`,
  `105,12,Pendiente Ficticio,no,,,pendiente,,,no,0`,
  `106,12,"Doña ""Dos Líneas""\nFicticia",no,,,retirado,,,no,0`,
  `101,12,Repetida Ficticia,no,,,aprobado,,,no,0`,
  `,12,Sin Id,no,,,aprobado,,,no,0`,
  `108,12,,no,,,aprobado,,,no,0`,
  `109,12,Estado Raro,no,,,quizas,,,no,0`,
].join("\r\n");

describe("CSV del sitio · lector", () => {
  it("detecta separador y descarta el BOM; respeta comillas y saltos de línea", () => {
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter('"a,b";c;d')).toBe(";");
    expect(detectDelimiter("a,b,c")).toBe(",");
    expect(parseCsvRecords('﻿a;b\r\n"x;1";"y ""q"""\r\n\r\n')).toEqual([
      ["a", "b"],
      ["x;1", 'y "q"'],
    ]);
    expect(parseCsvRecords('a,b\n"l1\nl2",z')[1]).toEqual(["l1\nl2", "z"]);
  });

  it("asistentes: mapea a InboundRegistration, omite menores y no aprobados, y numera los errores", () => {
    const r = parseSiteCsv(ASISTENTES, { editionYear: 2026, now: Date.UTC(2026, 10, 28, 23, 0) });
    expect(r.kind).toBe("asistentes");
    expect(r.revisionSource).toBe("estado");
    expect(r.minors).toBe(1);
    expect(r.skipped).toBe(1);
    expect(r.rows.map((x) => x.externalId)).toEqual(["101", "102", "103", "106"]);

    const [ana, beto, carla, dona] = r.rows;
    // El «'» anti-fórmula del sitio se deshace en el teléfono.
    expect(ana).toMatchObject({ phone: "+56900000101", email: "ana@ficticio.test", editionYear: 2026, adultConfirmed: true, cancelled: false, attendedAt: null, sourceRevision: 1 });
    expect(beto.fullName).toBe("Beto, el Ficticio");
    expect(beto.attendedAt).toMatch(/^2026-11-28T\d{2}:\d{2}$/);
    expect(beto.sourceRevision).toBe(2);
    expect(carla).toMatchObject({ cancelled: true, sourceRevision: 3, attendedAt: null });
    expect(dona.fullName).toBe('Doña "Dos Líneas" Ficticia');
    // Sin columnas de autorización no hay consentimiento: la persona no es contactable.
    expect(r.rows.every((x) => x.consents.length === 0)).toBe(true);

    expect(r.errors.map((e) => e.row)).toEqual([8, 9, 10, 11]);
    expect(r.errors[0].message).toMatch(/^Fila 8: el identificador está repetido/);
  });

  it("los mensajes de error no contienen datos de las celdas", () => {
    const r = parseSiteCsv(ASISTENTES, { editionYear: 2026 });
    const all = r.errors.map((e) => e.message).join("\n");
    for (const pii of ["Ficticia", "Ficticio", "ficticio.test", "56900000", "Sin Id", "quizas"]) expect(all).not.toContain(pii);
  });

  it("usa updatedAt como sourceRevision si la columna existe", () => {
    const csv = "id;nombre;menor;estado;usada;updated_at\n7;Ana Prueba;no;aprobado;no;2026-11-20T10:00:00Z\n";
    const r = parseSiteCsv(csv, { editionYear: 2026 });
    expect(r.revisionSource).toBe("updatedAt");
    expect(r.rows[0].sourceRevision).toBe(Date.parse("2026-11-20T10:00:00Z"));
    expect(parseSiteCsv("id;nombre;menor;estado;updated_at\n7;Ana;no;aprobado;ayer\n", { editionYear: 2026 }).errors[0].row).toBe(2);
  });

  it("consentimientos: solo si el CSV trae versión y casillas marcadas", () => {
    const csv = "id,nombre,menor,estado,autoriza_seguimiento,autoriza_whatsapp,version_consentimiento\n7,Ana,no,aprobado,sí,no,web-2026-2\n8,Beto,no,aprobado,no,no,web-2026-2\n";
    const r = parseSiteCsv(csv, { editionYear: 2026, now: Date.UTC(2026, 10, 1, 15, 0) });
    expect(r.rows[0].consents).toEqual([{ purpose: "seguimiento_evento", textVersion: "web-2026-2", grantedAt: expect.stringMatching(/^2026-11-01T/) }]);
    expect(r.rows[1].consents).toEqual([]);
  });

  it("solicitudes: la persona solicitante, con id propio y cancelación por retiro", () => {
    const csv = [
      "id,fecha_solicitud,solicitante,correo,telefono,personas,estado_revision,estado_contacto,resultado",
      "5,2026-10-01,Ana Prueba,,'+56900000105,2,finalizada,contactado,aprobada",
      "6,2026-10-02,Beto Prueba,,,1,finalizada,pendiente,no-aprobada",
      "7,2026-10-03,Carla Prueba,,,1,retirada,pendiente,",
    ].join("\n");
    const r = parseSiteCsv(csv, { editionYear: 2026 });
    expect(r.kind).toBe("solicitudes");
    expect(r.rows.map((x) => [x.externalId, x.cancelled])).toEqual([
      ["sol-5", false],
      ["sol-7", true],
    ]);
    expect(r.skipped).toBe(1);
  });

  it("archivo vacío, cabecera desconocida y columnas faltantes", () => {
    expect(parseSiteCsv("", { editionYear: 2026 }).errors[0].message).toMatch(/vacío/);
    expect(parseSiteCsv("a,b\n1,2", { editionYear: 2026 }).errors[0].message).toMatch(/No reconocemos/);
    expect(parseSiteCsv("id,nombre,menor\n1,Ana,no", { editionYear: 2026 }).errors[0].message).toMatch(/Faltan columnas obligatorias: estado/);
    expect(parseSiteCsv(ASISTENTES, { editionYear: 1800 }).errors.length).toBeGreaterThan(3);
  });
});
