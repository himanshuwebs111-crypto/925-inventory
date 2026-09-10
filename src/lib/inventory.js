// src/lib/inventory.js

import { supabase } from "./supabaseClient";

const TABLE_NAME = "inventory_items";

function mapDatabaseItem(item) {
  return {
    id: item.id,
    name: item.name ?? "",
    sku: item.sku ?? "",
    category: item.category ?? "Ring",
    material: item.material ?? "925 Silver",
    quantity: Number(item.quantity) || 1,
    weight:
      item.weight === null || item.weight === undefined
        ? ""
        : String(item.weight),
    costPrice:
      item.cost_price === null ||
      item.cost_price === undefined
        ? ""
        : String(item.cost_price),
    sellingPrice:
      item.selling_price === null ||
      item.selling_price === undefined
        ? ""
        : String(item.selling_price),
    notes: item.notes ?? "",
  };
}

function mapFormToDatabase(form) {
  return {
    name: form.name.trim(),
    sku: form.sku.trim() || null,
    category: form.category,
    material: form.material,
    quantity: Number(form.quantity),
    weight:
      form.weight === ""
        ? null
        : Number(form.weight),
    cost_price:
      form.costPrice === ""
        ? null
        : Number(form.costPrice),
    selling_price:
      form.sellingPrice === ""
        ? null
        : Number(form.sellingPrice),
    notes: form.notes.trim() || null,
    updated_at: new Date().toISOString(),
  };
}

function getErrorMessage(error) {
  if (error?.code === "23505") {
    return "This SKU is already in use. Please enter a different SKU.";
  }

  return error?.message || "Supabase request failed.";
}

const ITEM_COLUMNS =
  "id, name, sku, category, material, quantity, weight, cost_price, selling_price, notes";

export async function fetchInventoryItems() {
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select(ITEM_COLUMNS)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(getErrorMessage(error));
  }

  return (data ?? []).map(mapDatabaseItem);
}

export async function createInventoryItem(form) {
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .insert(mapFormToDatabase(form))
    .select(ITEM_COLUMNS)
    .single();

  if (error) {
    throw new Error(getErrorMessage(error));
  }

  return mapDatabaseItem(data);
}

export async function createInventoryItems(items) {
  const rows = items.map(mapFormToDatabase);

  if (rows.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .insert(rows)
    .select(ITEM_COLUMNS);

  if (error) {
    throw new Error(getErrorMessage(error));
  }

  return (data ?? []).map(mapDatabaseItem);
}

export async function updateInventoryItem(id, form) {
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .update(mapFormToDatabase(form))
    .eq("id", id)
    .select(ITEM_COLUMNS)
    .single();

  if (error) {
    throw new Error(getErrorMessage(error));
  }

  return mapDatabaseItem(data);
}

export async function deleteInventoryItem(id) {
  const { error } = await supabase
    .from(TABLE_NAME)
    .delete()
    .eq("id", id);

  if (error) {
    throw new Error(getErrorMessage(error));
  }
}