"use client";

// Cliente de `areas/{areaId}` (18a §C.2/§D.3). El id es el slug, generado al
// crear (con sufijo -2, -3… si ya existe) e inmutable. Toda escritura lleva la
// auditoría que exigen las reglas: createdBy/At al crear, updatedBy/At siempre.

import { useEffect, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  updateDoc,
  type DocumentData,
  type Firestore,
} from "firebase/firestore";
import { getFirebaseServices } from "@/lib/firebase";
import { settingsLoadError } from "@/lib/settings/errors";
import type { Area } from "@/lib/shared/types";
import {
  AREA_ERRORS,
  FALLBACK_AREA_COLOR,
  isAreaColor,
  normalizeAreaName,
  sortAreas,
  uniqueAreaSlug,
  validateArea,
  type AreaColor,
  type AreaErrors,
} from "./areas";

/** Área tal como la lee el cliente (tolerante con datos incompletos). */
export function areaFromDoc(id: string, data: DocumentData | undefined): Area {
  const d = data ?? {};
  return {
    id,
    name: typeof d.name === "string" ? d.name : id,
    slug: typeof d.slug === "string" ? d.slug : id,
    color: isAreaColor(d.color) ? d.color : FALLBACK_AREA_COLOR,
    description: typeof d.description === "string" ? d.description : "",
    active: d.active === true,
  };
}

/**
 * Todas las áreas (activas e inactivas), ordenadas por nombre, en tiempo real.
 * Contrato compartido con Calendario y Reportes.
 */
export function useAreas(): { areas: Area[]; loading: boolean; error: string } {
  const [state, setState] = useState<{ areas: Area[]; loading: boolean; error: string }>({
    areas: [],
    loading: true,
    error: "",
  });

  useEffect(() => {
    let services: ReturnType<typeof getFirebaseServices>;
    try {
      services = getFirebaseServices();
    } catch (error) {
      queueMicrotask(() => setState({ areas: [], loading: false, error: settingsLoadError(error, "las áreas") }));
      return;
    }
    return onSnapshot(
      collection(services.db, "areas"),
      (snapshot) =>
        setState({
          areas: sortAreas(snapshot.docs.map((item) => areaFromDoc(item.id, item.data()))),
          loading: false,
          error: "",
        }),
      (error) => setState({ areas: [], loading: false, error: settingsLoadError(error, "las áreas") }),
    );
  }, []);

  return state;
}

export interface AreaFormInput {
  name: string;
  description: string;
  color: AreaColor;
}

export class AreaValidationError extends Error {
  constructor(public readonly errors: AreaErrors) {
    super(errors.name ?? errors.color ?? errors.description ?? AREA_ERRORS.nameRequired);
    this.name = "AreaValidationError";
  }
}

function assertValid(errors: AreaErrors) {
  if (Object.keys(errors).length) throw new AreaValidationError(errors);
}

function cleanInput(input: AreaFormInput) {
  return { name: normalizeAreaName(input.name), description: input.description.trim(), color: input.color };
}

const MAX_SLUG_ATTEMPTS = 20;

/**
 * Crea un área activa. `areas` = lista cargada (para unicidad y slug).
 * Si el slug calculado ya existe en el servidor, prueba con el siguiente sufijo.
 * Devuelve el id (slug) creado.
 */
export async function createArea(
  db: Firestore,
  actorUid: string,
  input: AreaFormInput,
  areas: readonly Area[],
): Promise<string> {
  const clean = cleanInput(input);
  assertValid(validateArea({ ...clean, active: true }, areas));
  const taken = new Set(areas.map((a) => a.id));
  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt += 1) {
    const slug = uniqueAreaSlug(clean.name, taken);
    const ref = doc(db, "areas", slug);
    const created = await runTransaction(db, async (tx) => {
      const existing = await tx.get(ref);
      if (existing.exists()) return false;
      tx.set(ref, {
        name: clean.name,
        slug,
        color: clean.color,
        description: clean.description,
        active: true,
        createdAt: serverTimestamp(),
        createdBy: actorUid,
        updatedAt: serverTimestamp(),
        updatedBy: actorUid,
      });
      return true;
    });
    if (created) return slug;
    taken.add(slug);
  }
  throw new Error("No pudimos crear el área. Prueba con otro nombre.");
}

/** Edita nombre, descripción, color y (opcional) estado. El slug no cambia nunca. */
export async function updateArea(
  db: Firestore,
  actorUid: string,
  areaId: string,
  input: AreaFormInput & { active?: boolean },
  areas: readonly Area[],
): Promise<void> {
  const current = areas.find((a) => a.id === areaId);
  const active = input.active ?? current?.active ?? true;
  const clean = cleanInput(input);
  assertValid(validateArea({ id: areaId, ...clean, active }, areas));
  await updateDoc(doc(db, "areas", areaId), {
    name: clean.name,
    description: clean.description,
    color: clean.color,
    active,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });
}

/** Activa o desactiva. Al activar, su nombre y color no pueden chocar con otra área activa. */
export async function setAreaActive(
  db: Firestore,
  actorUid: string,
  area: Area,
  active: boolean,
  areas: readonly Area[],
): Promise<void> {
  if (active) {
    assertValid(
      validateArea(
        { id: area.id, name: area.name, description: area.description ?? "", color: area.color, active: true },
        areas,
      ),
    );
  }
  await updateDoc(doc(db, "areas", area.id), {
    active,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });
}
