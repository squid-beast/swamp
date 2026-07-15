import "server-only";
import { createClient } from "@/shared/supabase/server";
import type { Field, QueryResult, Record_, View } from "./types";

// ════════════════════════════════════════════════════════════════════════════
// Public shared views.
//
// Everything on this page goes through the SECURITY DEFINER functions in
// 20260714070000_sharing.sql. There is no other route from an anonymous visitor
// to a record, and there must never be one: the functions take a share_id, derive
// the table from it, check the password, apply the view's filter, and scope the
// query engine to the view's visible fields.
//
// Note what is NOT here: any function that takes a table id from the caller.
// ════════════════════════════════════════════════════════════════════════════

export interface SharedField extends Field {
  formConfig: FormFieldConfig;
}

export interface FormFieldConfig {
  label?: string;
  help?: string;
  required?: boolean;
  /** Show this field only when another answer matches. */
  visibleWhen?: { fieldId: string; equals: string };
  /** Offer a subset of the field's real options. */
  limitedOptions?: string[];
}

export interface SharedMeta {
  view: Pick<View, "id" | "type" | "name" | "config"> & {
    shareOptions: { allowDownload?: boolean; embed?: boolean };
  };
  table: { id: string; name: string };
  fields: SharedField[];
}

/** Thrown when a share link needs a password, or the one given is wrong. */
export class PasswordRequired extends Error {
  constructor() {
    super("password required");
    this.name = "PasswordRequired";
  }
}

function isPasswordError(message: string): boolean {
  return /password required/i.test(message);
}

export async function getSharedMeta(
  shareId: string,
  password?: string
): Promise<SharedMeta | null> {
  const { data, error } = await createClient().rpc("swamp_shared_meta", {
    p_share_id: shareId,
    p_password: password ?? null,
  });

  if (error) {
    if (isPasswordError(error.message)) throw new PasswordRequired();
    return null; // no such link — a 404, deliberately indistinguishable from "revoked"
  }

  return data as SharedMeta;
}

export async function getSharedRecords(
  shareId: string,
  password: string | undefined,
  spec: object = {}
): Promise<QueryResult> {
  const { data, error } = await createClient().rpc("swamp_shared_records", {
    p_share_id: shareId,
    p_password: password ?? null,
    p_spec: spec,
  });

  if (error) {
    if (isPasswordError(error.message)) throw new PasswordRequired();
    throw new Error(error.message);
  }

  const result = data as { records: Record<string, unknown>[]; next: QueryResult["next"] };

  return {
    records: (result.records ?? []).map(
      (r): Record_ => ({
        id: r.id as string,
        data: (r.data as Record<string, unknown>) ?? {},
        sortOrder: Number(r.sortOrder),
        createdAt: r.createdAt as string,
        updatedAt: r.updatedAt as string,
        createdBy: null,   // never exposed publicly
        updatedBy: null,
      })
    ),
    next: result.next ?? null,
  };
}

export async function submitForm(
  shareId: string,
  password: string | undefined,
  values: Record<string, unknown>
): Promise<string> {
  const { data, error } = await createClient().rpc("swamp_submit_form", {
    p_share_id: shareId,
    p_password: password ?? null,
    p_values: values,
  });

  if (error) {
    if (isPasswordError(error.message)) throw new PasswordRequired();
    throw new Error(error.message);
  }

  return data as string;
}

// ─── Owner side ─────────────────────────────────────────────────────────────

export async function shareView(viewId: string, password?: string): Promise<string> {
  const { data, error } = await createClient().rpc("swamp_share_view", {
    p_view_id: viewId,
    p_password: password && password.length ? password : null,
  });

  if (error) throw new Error(error.message);
  return data as string;
}

export async function unshareView(viewId: string): Promise<void> {
  const { error } = await createClient().rpc("swamp_unshare_view", {
    p_view_id: viewId,
  });
  if (error) throw new Error(error.message);
}
