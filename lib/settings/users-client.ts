"use client";

import { useEffect, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  type Firestore,
} from "firebase/firestore";
import { getFirebaseServices } from "@/lib/firebase";
import { errorMessage } from "@/lib/finance/formatters";
import {
  validateManagedUserUpdate,
  type ManagedUser,
  type ManagedUserUpdate,
} from "./users";

export function useManagedUsers() {
  const [state, setState] = useState<{
    data: ManagedUser[];
    loading: boolean;
    error: string;
  }>({ data: [], loading: true, error: "" });
  useEffect(
    () =>
      onSnapshot(
        query(
          collection(getFirebaseServices().db, "users"),
          orderBy("displayName"),
        ),
        (snapshot) =>
          setState({
            data: snapshot.docs.map(
              (item) => ({ id: item.id, ...item.data() }) as ManagedUser,
            ),
            loading: false,
            error: "",
          }),
        (error) =>
          setState({ data: [], loading: false, error: errorMessage(error) }),
      ),
    [],
  );
  return state;
}

export async function updateManagedUser(
  db: Firestore,
  currentUid: string,
  targetUid: string,
  update: ManagedUserUpdate,
) {
  const valid = validateManagedUserUpdate(currentUid, targetUid, update);
  await updateDoc(doc(db, "users", targetUid), valid);
}
